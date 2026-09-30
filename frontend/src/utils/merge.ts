import type { Determination, Specimen, Storage } from '@/types'
import { db } from '@/hooks/usePersistentStore'
import { uid } from '@/utils/id'
import { allocateSpecimenCode, parseSpecimenCode } from '@/utils/codec'

/** 外业批次：一次离线登记的整批数据（含标本、鉴定记录、保藏位置） */
export interface FieldBatch {
  batchId: string
  team: string
  exportedAt: string
  note?: string
  specimens: Specimen[]
  determinations: Determination[]
  storages: Storage[]
}

/** 字段级冲突：馆方值 vs 外业值，编目员挑一版 */
export interface FieldConflict {
  field: string
  label: string
  museumValue: string
  fieldValue: string
  chosen: 'museum' | 'field'
}

export type MergeOutcome = 'inserted' | 'renumbered' | 'protected' | 'conflict' | 'identical'

export interface MergeItemResult {
  key: string
  fieldSpecimen: Specimen
  outcome: MergeOutcome
  /** 重新取号后的新编号（renumbered） */
  newCode?: string
  /** 馆内原标本（冲突 / 保护 / 相同） */
  museumSpecimen?: Specimen
  /** 馆内原标本是否已鉴定/入柜（受保护，不被外业版本盖掉） */
  museumProtected?: boolean
  /** 字段级冲突（conflict） */
  conflicts?: FieldConflict[]
  /** 外业附带的鉴定记录数（随标本迁入或备注未合并） */
  attachedDet: number
  attachedStorage: number
}

export interface MergeReport {
  batchId: string
  team: string
  exportedAt: string
  mergedAt: string
  items: MergeItemResult[]
  inserted: number
  renumbered: number
  protectedCount: number
  conflictCount: number
  identicalCount: number
  /** 随新标本迁入的鉴定记录 / 保藏位置数 */
  carriedDet: number
  carriedStorage: number
}

export interface MuseumSnapshot {
  specimens: Specimen[]
  determinations: Determination[]
  storages: Storage[]
}

/** 参与字段级冲突比对的采集信息字段（馆内工作流字段 status/determiner 不参与） */
const COMPARE_FIELDS: { field: keyof Specimen; label: string }[] = [
  { field: 'order', label: '目' },
  { field: 'family', label: '科' },
  { field: 'genus', label: '属' },
  { field: 'species', label: '种' },
  { field: 'tempName', label: '暂定名' },
  { field: 'collectDate', label: '采集日期' },
  { field: 'collector', label: '采集人' },
  { field: 'sex', label: '性别' },
  { field: 'stage', label: '虫态' },
  { field: 'bodyLength', label: '体长(mm)' },
  { field: 'method', label: '采集方式' },
  { field: 'quantity', label: '数量' },
  { field: 'siteId', label: '采集地' },
  { field: 'note', label: '备注' }
]

const NUMERIC_FIELDS = new Set<string>(['bodyLength', 'quantity'])

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

/**
 * 规划合并（纯计算，不写库）。
 *
 * 判定规则：
 * 1. 外业标本 id 命中馆内标本 → 同一条标本的外业编辑版：
 *    - 馆内已鉴定或入柜 → 受保护，外业版本不盖掉（protected）
 *    - 否则逐字段比对，不一致 → 字段冲突（conflict），由编目员挑一版
 *    - 完全一致 → 无变化（identical）
 * 2. id 未命中但编号（code）命中馆内标本 → 编号冲突（两只不同标本撞号）：
 *    - 重新取号，作为新标本入库；馆内原标本已鉴定/入柜则受保护保留
 * 3. id 与编号都未命中 → 新标本入库（inserted）
 *
 * 新入库标本（inserted/renumbered）会换发新 id，外业附带的鉴定记录与保藏位置
 * 随新 id 一并迁入，避免柜位/鉴定记录指不到标本。
 */
export function planMerge(batch: FieldBatch, museum: MuseumSnapshot): MergeItemResult[] {
  const mById = new Map<string, Specimen>()
  museum.specimens.forEach((s) => mById.set(s.id, s))

  const mByCode = new Map<string, Specimen>()
  museum.specimens.forEach((s) => {
    const key = s.code.trim().toUpperCase()
    if (!mByCode.has(key)) mByCode.set(key, s)
  })

  const detCount = new Map<string, number>()
  museum.determinations.forEach((d) => detCount.set(d.specimenId, (detCount.get(d.specimenId) ?? 0) + 1))
  const stgCount = new Map<string, number>()
  museum.storages.forEach((s) => stgCount.set(s.specimenId, (stgCount.get(s.specimenId) ?? 0) + 1))

  const attachedDet = (specimenId: string): number =>
    batch.determinations.filter((d) => d.specimenId === specimenId).length
  const attachedStg = (specimenId: string): number =>
    batch.storages.filter((s) => s.specimenId === specimenId).length

  const museumCodes = museum.specimens.map((s) => s.code)
  const reserved: string[] = []

  return batch.specimens.map((f) => {
    const m = mById.get(f.id)
    if (m) {
      const protected_ = (detCount.get(m.id) ?? 0) > 0 || (stgCount.get(m.id) ?? 0) > 0
      if (protected_) {
        return {
          key: f.id,
          fieldSpecimen: f,
          outcome: 'protected',
          museumSpecimen: m,
          museumProtected: true,
          attachedDet: attachedDet(f.id),
          attachedStorage: attachedStg(f.id)
        }
      }
      const conflicts: FieldConflict[] = []
      for (const { field, label } of COMPARE_FIELDS) {
        if (m[field] !== f[field]) {
          conflicts.push({
            field,
            label,
            museumValue: displayValue(m[field]),
            fieldValue: displayValue(f[field]),
            chosen: 'museum'
          })
        }
      }
      if (conflicts.length > 0) {
        return {
          key: f.id,
          fieldSpecimen: f,
          outcome: 'conflict',
          museumSpecimen: m,
          conflicts,
          attachedDet: attachedDet(f.id),
          attachedStorage: attachedStg(f.id)
        }
      }
      return {
        key: f.id,
        fieldSpecimen: f,
        outcome: 'identical',
        museumSpecimen: m,
        attachedDet: attachedDet(f.id),
        attachedStorage: attachedStg(f.id)
      }
    }

    const mCode = mByCode.get(f.code.trim().toUpperCase())
    if (mCode) {
      // 编号冲突：重新取号，作为新标本入库；馆内原标本已鉴定/入柜则受保护保留不动
      const parsed = parseSpecimenCode(f.code)
      const newCode = parsed
        ? allocateSpecimenCode(parsed.siteCode, parsed.year, museumCodes, reserved)
        : f.code
      if (parsed) reserved.push(newCode)
      const protected_ = (detCount.get(mCode.id) ?? 0) > 0 || (stgCount.get(mCode.id) ?? 0) > 0
      return {
        key: f.id,
        fieldSpecimen: f,
        outcome: 'renumbered',
        newCode,
        museumSpecimen: mCode,
        museumProtected: protected_,
        attachedDet: attachedDet(f.id),
        attachedStorage: attachedStg(f.id)
      }
    }

    return {
      key: f.id,
      fieldSpecimen: f,
      outcome: 'inserted',
      attachedDet: attachedDet(f.id),
      attachedStorage: attachedStg(f.id)
    }
  })
}

function buildReport(batch: FieldBatch, items: MergeItemResult[], mergedAt: string): MergeReport {
  const report: MergeReport = {
    batchId: batch.batchId,
    team: batch.team,
    exportedAt: batch.exportedAt,
    mergedAt,
    items,
    inserted: 0,
    renumbered: 0,
    protectedCount: 0,
    conflictCount: 0,
    identicalCount: 0,
    carriedDet: 0,
    carriedStorage: 0
  }
  for (const item of items) {
    if (item.outcome === 'inserted') report.inserted += 1
    else if (item.outcome === 'renumbered') report.renumbered += 1
    else if (item.outcome === 'protected') report.protectedCount += 1
    else if (item.outcome === 'conflict') report.conflictCount += 1
    else if (item.outcome === 'identical') report.identicalCount += 1
    if (item.outcome === 'inserted' || item.outcome === 'renumbered') {
      report.carriedDet += item.attachedDet
      report.carriedStorage += item.attachedStorage
    }
  }
  return report
}

/** meta 表中已合并批次的存档键（幂等：同一批再送不重复入库） */
const batchKey = (batchId: string): string => `batch:${batchId}`

/** 读取已合并批次的存档报告；未合并返回 null */
export async function getMergedBatch(batchId: string): Promise<MergeReport | null> {
  const row = await db.meta.get(batchKey(batchId))
  return (row?.value as MergeReport) ?? null
}

/**
 * 应用合并（事务性，整批要么全成要么全回滚）。
 * - 新标本（inserted/renumbered）换发新 id 入库，附带的鉴定记录/保藏位置随新 id 迁入
 * - 字段冲突按编目员选择写入馆内标本
 * - 保护 / 相同项不动馆内数据
 * - 写批次存档（幂等键）
 */
export async function applyMerge(
  batch: FieldBatch,
  items: MergeItemResult[],
  choices: Record<string, Record<string, 'museum' | 'field'>>
): Promise<MergeReport> {
  const mergedAt = new Date().toISOString()
  const report = buildReport(batch, items, mergedAt)

  await db.transaction('rw', db.specimens, db.determinations, db.storages, db.meta, async () => {
    const newSpecimens: Specimen[] = []
    const newDets: Determination[] = []
    const newStgs: Storage[] = []

    for (const item of items) {
      const f = item.fieldSpecimen
      if (item.outcome === 'inserted' || item.outcome === 'renumbered') {
        const newId = uid('sp')
        newSpecimens.push({ ...f, id: newId, code: item.newCode ?? f.code })
        for (const d of batch.determinations.filter((x) => x.specimenId === f.id)) {
          newDets.push({ ...d, id: uid('det'), specimenId: newId })
        }
        for (const s of batch.storages.filter((x) => x.specimenId === f.id)) {
          newStgs.push({ ...s, id: uid('stg'), specimenId: newId })
        }
      } else if (item.outcome === 'conflict' && item.museumSpecimen) {
        const choice = choices[item.key] ?? {}
        const updated: Specimen = { ...item.museumSpecimen }
        for (const c of item.conflicts ?? []) {
          if (choice[c.field] === 'field') {
            const raw = c.fieldValue === '—' ? '' : c.fieldValue
            const value = NUMERIC_FIELDS.has(c.field) ? Number(raw) || 0 : raw
            ;(updated as unknown as Record<string, unknown>)[c.field] = value
          }
        }
        await db.specimens.put(updated)
      }
    }

    if (newSpecimens.length > 0) await db.specimens.bulkPut(newSpecimens)
    if (newDets.length > 0) await db.determinations.bulkPut(newDets)
    if (newStgs.length > 0) await db.storages.bulkPut(newStgs)

    await db.meta.put({ key: batchKey(batch.batchId), value: report })
  })

  return report
}

/** 从当前馆内数据生成外业批次快照（含标本、鉴定记录、保藏位置） */
export function buildFieldBatch(
  team: string,
  museum: MuseumSnapshot,
  note?: string
): FieldBatch {
  return {
    batchId: uid('batch'),
    team: team.trim() || '未命名分队',
    exportedAt: new Date().toISOString(),
    note,
    specimens: museum.specimens.map((s) => ({ ...s })),
    determinations: museum.determinations.map((d) => ({ ...d })),
    storages: museum.storages.map((s) => ({ ...s }))
  }
}

/** 校验导入的 JSON 是否为合法外业批次 */
export function parseFieldBatch(raw: unknown): { ok: true; batch: FieldBatch } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '文件内容不是 JSON 对象' }
  const obj = raw as Record<string, unknown>
  if (typeof obj.batchId !== 'string' || !obj.batchId) return { ok: false, error: '缺少 batchId' }
  if (typeof obj.team !== 'string') return { ok: false, error: '缺少 team' }
  if (!Array.isArray(obj.specimens)) return { ok: false, error: 'specimens 必须是数组' }
  const specimens = obj.specimens as Specimen[]
  for (const s of specimens) {
    if (typeof s !== 'object' || s === null) return { ok: false, error: 'specimens 中存在非法记录' }
    if (typeof s.id !== 'string' || typeof s.code !== 'string')
      return { ok: false, error: '标本记录缺少 id 或 code' }
  }
  const determinations = Array.isArray(obj.determinations) ? (obj.determinations as Determination[]) : []
  const storages = Array.isArray(obj.storages) ? (obj.storages as Storage[]) : []
  return {
    ok: true,
    batch: {
      batchId: obj.batchId,
      team: obj.team,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
      note: typeof obj.note === 'string' ? obj.note : undefined,
      specimens,
      determinations,
      storages
    }
  }
}
