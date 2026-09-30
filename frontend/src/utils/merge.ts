import type {
  CollectSite,
  Determination,
  FieldBatch,
  FieldConflict,
  FieldSpecimen,
  MergeLedger,
  MergeResult,
  MergeableFieldKey,
  Renumbering,
  Specimen,
  Storage
} from '@/types'
import { MERGE_FIELDS, fieldLabelOf } from '@/types'
import { db } from '@/hooks/usePersistentStore'
import { allocateSpecimenCode, parseSpecimenCode } from '@/utils/codec'
import { uid } from '@/utils/id'

/** 合并预检阶段的结构化错误：整批不合法，一条都不会写入 */
export class MergeValidationError extends Error {
  issues: string[]
  constructor(issues: string[]) {
    super(`外业批次校验失败：\n${issues.map((item) => `· ${item}`).join('\n')}`)
    this.name = 'MergeValidationError'
    this.issues = issues
  }
}

/** 合并读侧上下文：来自馆内当前四张表的快照 */
export interface MergeContext {
  specimens: Specimen[]
  sites: CollectSite[]
  storages: Storage[]
  determinations: Determination[]
}

/** 单条标本的合并预案，供页面预检展示 */
export interface SpecimenPlan {
  specimenId: string
  mode: '新增' | '更新'
  finalCode: string
  oldCode: string
  renumbered: boolean
  /** 自动采纳外业版本的字段 */
  acceptedFields: MergeableFieldKey[]
  /** 升级为字段分歧、交编目员裁定的字段 */
  conflictFields: MergeableFieldKey[]
  /** 受馆内保护、直接保留馆内版本的字段 */
  protectedSkips: { field: string; reason: string }[]
  warnings: string[]
}

export interface MergePlan {
  batch: FieldBatch
  payloadHash: string
  sitePuts: CollectSite[]
  /** 外业记录 id → 馆内最终 id（采集地按 code 匹配，或新记录 id 与馆内撞车时重取） */
  siteIdRemap: Map<string, string>
  /** 外业标本 id → 馆内最终 id（新标本 id 撞车时重取；同一份标本沿用原 id） */
  specimenIdRemap: Map<string, string>
  siteSkipped: CollectSite[]
  specimenPuts: Specimen[]
  determinationPuts: Determination[]
  storagePuts: Storage[]
  conflicts: FieldConflict[]
  renumberings: Renumbering[]
  warnings: string[]
  specimenPlans: SpecimenPlan[]
  insertedIds: string[]
  updatedIds: string[]
}

/** 鉴定内容字段：馆内一旦已有鉴定记录，外业版本不得自动覆盖，只能进分歧交编目员 */
const IDENTIFICATION_FIELDS: MergeableFieldKey[] = ['order', 'family', 'genus', 'species', 'tempName']
/** 工作流字段：由馆内鉴定/入柜流程推进，外业版本一律忽略 */
const WORKFLOW_FIELDS = ['status', 'determiner'] as const
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 稳定的内容指纹：同批次号重试时校验内容没有被篡改/重新导出 */
export function computeBatchHash(batch: FieldBatch): string {
  const canonical = JSON.stringify(batch, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (value as Record<string, unknown>)[k]
          return acc
        }, {})
    }
    return value
  })
  let hash = 5381
  for (let i = 0; i < canonical.length; i += 1) {
    hash = ((hash << 5) + hash + canonical.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function isNonEmpty(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
}

/** 整批结构校验：任何一条不合法都抛 MergeValidationError，调用方不会进入写事务 */
export function validateFieldBatch(batch: FieldBatch, ctx: MergeContext): void {
  const issues: string[] = []

  if (!batch || typeof batch !== 'object') {
    throw new MergeValidationError(['批次内容不是有效的 JSON 对象'])
  }
  if (!isNonEmpty(batch.batchId)) issues.push('缺少批次号 batchId（整批重试的幂等键）')
  if (!isNonEmpty(batch.team)) issues.push('缺少分队名称 team（外业版本的来源标记）')
  if (!Array.isArray(batch.specimens) || batch.specimens.length === 0) {
    issues.push('批次里没有任何标本')
    throw new MergeValidationError(issues)
  }

  // 采集地：批内 code 唯一
  const batchSites = batch.sites ?? []
  const batchSiteCodes = new Set<string>()
  batchSites.forEach((site) => {
    if (!isNonEmpty(site.code)) issues.push(`采集地 ${site.id || '?'} 缺少代码`)
    else {
      const code = site.code.trim().toUpperCase()
      if (batchSiteCodes.has(code)) issues.push(`批内采集地代码重复：${code}`)
      batchSiteCodes.add(code)
    }
  })

  // 标本：id / 编号 / 采集地引用
  const batchSpecimenIds = new Set<string>()
  const localSiteIds = new Set(ctx.sites.map((site) => site.id))
  batch.specimens.forEach((specimen) => {
    if (!isNonEmpty(specimen.id)) {
      issues.push('存在缺少 id 的标本')
      return
    }
    if (batchSpecimenIds.has(specimen.id)) issues.push(`批内标本 id 重复：${specimen.id}`)
    batchSpecimenIds.add(specimen.id)

    if (!parseSpecimenCode(specimen.code ?? '')) {
      issues.push(`标本 ${specimen.id} 的编号 ${specimen.code || '（空）'} 不符合「采集地代码-年份-流水号」规则`)
    }
    const resolvableSiteIds = new Set([...batchSites.map((site) => site.id), ...localSiteIds])
    if (!resolvableSiteIds.has(specimen.siteId)) {
      issues.push(`标本 ${specimen.code || specimen.id} 引用的采集地 ${specimen.siteId} 在批内与馆内都不存在`)
    }
  })

  // 挂接记录：批内 id 唯一，且只能挂本批标本（跟着标本一起搬走，不允许悬空）
  const checkChildren = (rows: { id: string; specimenId: string }[] | undefined, label: string): void => {
    if (!rows) return
    const ids = new Set<string>()
    rows.forEach((row) => {
      if (!isNonEmpty(row.id)) {
        issues.push(`${label}存在缺少 id 的记录`)
        return
      }
      if (ids.has(row.id)) issues.push(`批内${label}id 重复：${row.id}`)
      ids.add(row.id)
      if (!batchSpecimenIds.has(row.specimenId)) {
        issues.push(`${label} ${row.id} 挂接的标本 ${row.specimenId} 不在本批标本中（合并后会指不到标本）`)
      }
    })
  }
  checkChildren(batch.determinations, '鉴定记录')
  checkChildren(batch.storages, '保藏柜位')

  if (issues.length > 0) throw new MergeValidationError(issues)
}

/**
 * 纯函数式合并预案：
 * 1. 采集地按 code 匹配，已在馆内的保留馆内版本，新采集地随批入库；
 * 2. 标本按 id 识别同一份：新标本撞号（两个分队排出同一编号）则顺着号段重取新号，
 *    采集信息原样保留，鉴定记录/柜位按 specimenId 跟随（不悬空）；
 * 3. 同一标本的字段做三方比对（离队快照 base / 馆内 / 外业），
 *    仅外业改的自动采纳；两边都改或无快照可判的保留两版进分歧，编目员挑一版；
 * 4. 馆内已鉴定/入柜的工作流与鉴定内容不被外业盖掉。
 */
export function planMerge(batch: FieldBatch, ctx: MergeContext): MergePlan {
  validateFieldBatch(batch, ctx)

  const payloadHash = computeBatchHash(batch)
  const warnings: string[] = []
  const renumberings: Renumbering[] = []
  const conflicts: FieldConflict[] = []
  const specimenPlans: SpecimenPlan[] = []

  // —— 采集地 ——
  const localSiteByCode = new Map(ctx.sites.map((site) => [site.code.trim().toUpperCase(), site]))
  const localSiteIds = new Set(ctx.sites.map((site) => site.id))
  const siteIdRemap = new Map<string, string>()
  const sitePuts: CollectSite[] = []
  const siteSkipped: CollectSite[] = []
  ;(batch.sites ?? []).forEach((site) => {
    const local = localSiteByCode.get(site.code.trim().toUpperCase())
    if (local) {
      // 馆里已有该采集地：馆内信息不被外业版本盖掉，仅做 id 映射
      siteIdRemap.set(site.id, local.id)
      siteSkipped.push(site)
      warnings.push(`采集地 ${site.code} 馆内已存在，保留馆内登记信息`)
    } else {
      // 新采集地：id 与馆内意外撞车（通常是手工编的批次）时重取，避免覆盖
      let finalId = site.id
      if (localSiteIds.has(finalId)) {
        finalId = uid('site')
        siteIdRemap.set(site.id, finalId)
        warnings.push(`采集地 ${site.code} 的外业 id 与馆内撞车，已重取 id`)
      }
      sitePuts.push({ ...site, id: finalId })
    }
  })
  const resolveSiteId = (id: string): string => siteIdRemap.get(id) ?? id

  // —— 标本 ——
  const localById = new Map(ctx.specimens.map((item) => [item.id, item]))
  const localDeterminedIds = new Set(ctx.determinations.map((item) => item.specimenId))
  const localStoredIds = new Set(ctx.storages.map((item) => item.specimenId))

  // 已占用编号池（大写归一）：馆内 + 本批已分配，撞号顺着号段往后取
  const usedCodes = new Set(ctx.specimens.map((item) => item.code.trim().toUpperCase()))
  const specimenPuts: Specimen[] = []
  const insertedIds: string[] = []
  const updatedIds: string[] = []
  /** 外业标本 id → 最终入库 id */
  const specimenIdRemap = new Map<string, string>()

  const fieldSource = `外业·${batch.team}`

  batch.specimens.forEach((incoming: FieldSpecimen) => {
    const existing = localById.get(incoming.id)
    const plan: SpecimenPlan = {
      specimenId: incoming.id,
      mode: existing ? '更新' : '新增',
      finalCode: incoming.code,
      oldCode: incoming.code,
      renumbered: false,
      acceptedFields: [],
      conflictFields: [],
      protectedSkips: [],
      warnings: []
    }

    if (!existing) {
      // —— 新标本：两个分队各自排号可能排出同一个编号，撞号就重取 ——
      const parsed = parseSpecimenCode(incoming.code)
      const siteCode = parsed?.siteCode ?? 'TMP'
      const year = parsed?.year ?? new Date().getFullYear()
      let finalCode = incoming.code
      if (usedCodes.has(incoming.code.trim().toUpperCase())) {
        finalCode = allocateSpecimenCode(siteCode, year, [...usedCodes])
        usedCodes.add(finalCode.trim().toUpperCase())
        renumberings.push({
          specimenId: incoming.id,
          oldCode: incoming.code,
          newCode: finalCode,
          reason: `与馆内/同批已有编号撞号（${batch.team} 离线自行排号），按号段顺延重取`
        })
        plan.renumbered = true
      } else {
        usedCodes.add(incoming.code.trim().toUpperCase())
      }
      plan.finalCode = finalCode

      const { base: _base, ...fields } = incoming
      void _base
      specimenPuts.push({ ...fields, code: finalCode, siteId: resolveSiteId(incoming.siteId) })
      insertedIds.push(incoming.id)
      specimenPlans.push(plan)
      return
    }

    // —— 同一份标本（按 id）的更新：三方比对 ——
    const merged: Specimen = { ...existing }

    // 编号不允许外业改写；编号撞号的重取只发生在新标本入库时
    if (incoming.code.trim().toUpperCase() !== existing.code.trim().toUpperCase()) {
      const msg = `标本 ${existing.code} 的外业编号 ${incoming.code} 与馆内不一致，保留馆内编号`
      plan.warnings.push(msg)
      warnings.push(msg)
    }

    MERGE_FIELDS.forEach(({ key }) => {
      const incomingValue = key === 'siteId' ? resolveSiteId(String(incoming[key] ?? '')) : incoming[key]
      const localValue = existing[key]
      if (sameValue(incomingValue, localValue)) return

      const hasBase = incoming.base !== undefined && Object.prototype.hasOwnProperty.call(incoming.base, key)
      const baseValue = incoming.base?.[key]
      const localChanged = hasBase ? !sameValue(localValue, baseValue) : true
      const fieldChanged = hasBase ? !sameValue(incomingValue, baseValue) : true
      const determined = localDeterminedIds.has(existing.id)

      // 鉴定内容字段：馆内已鉴定过的，外业不得自动覆盖
      const identificationLocked = determined && IDENTIFICATION_FIELDS.includes(key)

      if (!hasBase || identificationLocked) {
        // 无离队快照无法判断是谁改的，或馆内已鉴定：保留两版，交编目员
        addConflict(conflicts, batch, existing, plan, key, localValue, incomingValue, fieldSource)
        return
      }

      if (localChanged && fieldChanged) {
        // 两边都改过：两版都留、标出来源，编目员挑一版；当前值保持馆内版本
        addConflict(conflicts, batch, existing, plan, key, localValue, incomingValue, fieldSource)
        return
      }

      if (fieldChanged && !localChanged) {
        // 仅外业改过：直接采纳外业版本
        merged[key] = incomingValue as never
        plan.acceptedFields.push(key)
        return
      }

      // 仅馆内改过：保留馆内，忽略外业旧值
      plan.protectedSkips.push({ field: key, reason: '仅馆内版本有修改' })
    })

    // 工作流字段：馆内已鉴定或入柜，外业版本一律不盖
    WORKFLOW_FIELDS.forEach((key) => {
      if (!sameValue(incoming[key], existing[key])) {
        const reason = localDeterminedIds.has(existing.id)
          ? '馆内已有鉴定记录'
          : localStoredIds.has(existing.id)
            ? '馆内已入柜'
            : '鉴定状态由馆内工作流推进'
        plan.protectedSkips.push({ field: key, reason })
      }
    })

    specimenPuts.push(merged)
    updatedIds.push(existing.id)
    plan.finalCode = existing.code
    specimenPlans.push(plan)
  })

  // —— 鉴定记录 / 保藏柜位：按 specimenId 挂接，标本 id 不变、编号重取也不悬空 ——
  // 外业正常只会导出新建记录（uid 随机，天然不撞）；若批次带了馆内已有 id 的记录
  // （重发/手工批），按「馆内已鉴定/入柜内容不被覆盖」跳过并提示，绝不覆盖或另造一份重复。
  const finalIdSet = new Set(specimenPuts.map((item) => item.id))
  const resolveSpecimenId = (id: string): string => specimenIdRemap.get(id) ?? id
  const codeById = new Map(specimenPuts.map((item) => [item.id, item.code]))
  const determinationPuts: Determination[] = []
  const localDeterminationById = new Map(ctx.determinations.map((item) => [item.id, item]))
  ;(batch.determinations ?? []).forEach((row) => {
    if (!finalIdSet.has(row.specimenId)) return // 校验阶段已保证，防御性兜底
    if (localDeterminationById.has(row.id)) {
      const targetId = resolveSpecimenId(row.specimenId)
      warnings.push(`鉴定记录 ${row.id}（标本 ${codeById.get(targetId) ?? targetId}）馆内已存在，保留馆内版本`)
      return
    }
    determinationPuts.push({ ...row, specimenId: resolveSpecimenId(row.specimenId) })
  })

  const storagePuts: Storage[] = []
  const localStorageById = new Map(ctx.storages.map((item) => [item.id, item]))
  const occupiedSlots = new Map(
    ctx.storages.map((item) => [
      `${item.cabinet}|${item.drawer}|${item.box}|${item.slot}`.toUpperCase(),
      item.specimenId
    ])
  )
  const batchSlotOwner = new Map<string, string>()
  ;(batch.storages ?? []).forEach((row) => {
    if (!finalIdSet.has(row.specimenId)) return
    const targetId = resolveSpecimenId(row.specimenId)
    if (localStorageById.has(row.id)) {
      warnings.push(`柜位记录 ${row.id}（标本 ${codeById.get(targetId) ?? targetId}）馆内已存在，保留馆内版本`)
      return
    }
    const slotKey = `${row.cabinet}|${row.drawer}|${row.box}|${row.slot}`.toUpperCase()
    const prior = occupiedSlots.get(slotKey) ?? batchSlotOwner.get(slotKey)
    if (prior) {
      // 不阻断整批：记录必须跟随标本入库以免指不到标本，占用问题交编目员在柜位图调整
      const priorCode = codeById.get(prior) ?? prior
      warnings.push(
        `柜位 ${row.cabinet}-D${row.drawer}-B${row.box}-S${row.slot} 与 ${priorCode} 重复占用，待人工调整`
      )
    } else {
      occupiedSlots.set(slotKey, targetId)
      batchSlotOwner.set(slotKey, targetId)
    }
    storagePuts.push({ ...row, specimenId: targetId })
  })

  return {
    batch,
    payloadHash,
    sitePuts,
    siteIdRemap,
    specimenIdRemap,
    siteSkipped,
    specimenPuts,
    determinationPuts,
    storagePuts,
    conflicts,
    renumberings,
    warnings,
    specimenPlans,
    insertedIds,
    updatedIds
  }
}

function addConflict(
  conflicts: FieldConflict[],
  batch: FieldBatch,
  existing: Specimen,
  plan: SpecimenPlan,
  key: MergeableFieldKey,
  localValue: unknown,
  fieldValue: unknown,
  fieldSource: string
): void {
  conflicts.push({
    id: `cf_${sanitize(batch.batchId)}_${sanitize(existing.id)}_${key}`,
    batchId: batch.batchId,
    specimenId: existing.id,
    specimenCode: existing.code,
    field: key,
    fieldLabel: fieldLabelOf(key),
    localValueJson: JSON.stringify(localValue),
    fieldValueJson: JSON.stringify(fieldValue),
    localSource: '馆内编目',
    fieldSource,
    status: '待处理'
  })
  plan.conflictFields.push(key)
}

function sanitize(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * 执行整批合并（单个 Dexie 事务，任何一步失败全部回滚）：
 * - 批次号已合并过且内容一致：直接返回原台账，不产生任何重复标本（幂等重试）；
 * - 批次号相同但内容指纹不同：拒绝，提示换新批次号；
 * - 未合并过：预检 → 写采集地/标本/鉴定/柜位/分歧 → 记台账，全部成功才提交。
 */
export async function applyFieldBatch(batch: FieldBatch): Promise<MergeResult> {
  const hash = computeBatchHash(batch)

  return db.transaction(
    'rw',
    [db.sites, db.specimens, db.determinations, db.storages, db.mergeConflicts, db.mergeLedgers],
    async (tx) => {
      const existingLedger = await tx.table<MergeLedger, string>('mergeLedgers').get(batch.batchId)
      if (existingLedger) {
        if (existingLedger.payloadHash !== hash) {
          throw new MergeValidationError([
            `批次号 ${batch.batchId} 已合并过，但本次内容与上次不同（指纹 ${hash} ≠ ${existingLedger.payloadHash}）。请使用新批次号重新导出`
          ])
        }
        // 同一批再送一次：原样返回，不多写任何标本/记录
        return { duplicate: true, ledger: existingLedger } satisfies MergeResult
      }

      const txCtx: MergeContext = {
        specimens: await tx.table<Specimen, string>('specimens').toArray(),
        sites: await tx.table<CollectSite, string>('sites').toArray(),
        storages: await tx.table<Storage, string>('storages').toArray(),
        determinations: await tx.table<Determination, string>('determinations').toArray()
      }
      // 预检同样在事务内再跑一遍：失败抛错，事务回滚，整批退回
      const plan = planMerge(batch, txCtx)

      await tx.table<CollectSite, string>('sites').bulkPut(plan.sitePuts)
      await tx.table<Specimen, string>('specimens').bulkPut(plan.specimenPuts)
      await tx.table<Determination, string>('determinations').bulkPut(plan.determinationPuts)
      await tx.table<Storage, string>('storages').bulkPut(plan.storagePuts)
      if (plan.conflicts.length > 0) {
        await tx.table<FieldConflict, string>('mergeConflicts').bulkPut(plan.conflicts)
      }

      const ledger: MergeLedger = {
        batchId: batch.batchId,
        team: batch.team,
        exportedAt: batch.exportedAt,
        appliedAt: new Date().toISOString(),
        payloadHash: plan.payloadHash,
        insertedCount: plan.insertedIds.length,
        updatedCount: plan.updatedIds.length,
        renumberedCount: plan.renumberings.length,
        conflictCount: plan.conflicts.length,
        warningCount: plan.warnings.length,
        renumberings: plan.renumberings,
        warnings: plan.warnings
      }
      await tx.table<MergeLedger, string>('mergeLedgers').put(ledger)
      return { duplicate: false, ledger } satisfies MergeResult
    }
  )
}

/** 编目员对一条字段分歧拍板：选定版本写回标本，分歧标记已解决 */
export async function resolveFieldConflict(
  conflictId: string,
  chosenSide: '馆内' | '外业'
): Promise<void> {
  await db.transaction('rw', [db.specimens, db.mergeConflicts], async (tx) => {
    const conflict = await tx.table<FieldConflict, string>('mergeConflicts').get(conflictId)
    if (!conflict || conflict.status === '已解决') return
    if (chosenSide === '外业') {
      const specimen = await tx.table<Specimen, string>('specimens').get(conflict.specimenId)
      if (specimen) {
        const value = JSON.parse(conflict.fieldValueJson)
        ;(specimen as unknown as Record<string, unknown>)[conflict.field] = value
        await tx.table<Specimen, string>('specimens').put(specimen)
      }
    }
    await tx
      .table<FieldConflict, string>('mergeConflicts')
      .put({ ...conflict, status: '已解决', chosenSide, resolvedAt: new Date().toISOString() })
  })
}

/** 生成一条新的挂接记录 id（供页面构造批次外的其他场景使用） */
export function newChildId(prefix: 'det' | 'stg'): string {
  return uid(prefix)
}
