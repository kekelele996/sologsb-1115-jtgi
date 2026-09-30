import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/hooks/usePersistentStore'
import type { CollectSite, Determination, FieldBatch, FieldSpecimen, Specimen, Storage } from '@/types'
import { MergeValidationError, applyFieldBatch, computeBatchHash, planMerge } from '@/utils/merge'
import type { MergeContext } from '@/utils/merge'

/** 构造一份馆内基线数据：QLB 有 2 份标本（0001 已鉴定+入柜，0002 初鉴有鉴定记录） */
async function seedBase(): Promise<{
  ctx: MergeContext
  sp1: Specimen
  sp2: Specimen
  site: CollectSite
  det1: Determination
  stg1: Storage
}> {
  await db.delete()
  await db.open()

  const site: CollectSite = {
    id: 'site_qlb',
    code: 'QLB',
    name: '青龙背',
    region: '贵州',
    longitude: 107.2136,
    latitude: 25.8123,
    altitude: 986,
    habitat: '阔叶林',
    microHabitat: '',
    microClimate: '',
    dateStart: '2026-05-01',
    dateEnd: '2026-05-01'
  }
  const make = (over: Partial<Specimen>): Specimen => ({
    id: '',
    code: '',
    order: '鞘翅目',
    family: '步甲科',
    genus: 'Carabus',
    species: 'sp.',
    tempName: '大黑步甲',
    collectDate: '2026-05-01',
    collector: '陆昀',
    sex: '未知',
    stage: '成虫',
    bodyLength: 20,
    method: '扫网',
    quantity: 1,
    status: '待鉴定',
    determiner: '',
    siteId: site.id,
    note: '',
    ...over
  })
  const sp1 = make({ id: 'sp_001', code: 'QLB-2026-0001', status: '已鉴定', determiner: '覃羽' })
  const sp2 = make({ id: 'sp_002', code: 'QLB-2026-0002', family: '夜蛾科', order: '鳞翅目', tempName: '灰褐夜蛾' })
  const det1: Determination = {
    id: 'det_001',
    specimenId: 'sp_001',
    determiner: '覃羽',
    date: '2026-05-02',
    conclusion: 'Carabus smaragdinus',
    reference: '步甲志',
    confidence: '高',
    needReview: false
  }
  const stg1: Storage = {
    id: 'stg_001',
    specimenId: 'sp_001',
    method: '针插',
    cabinet: 'C01',
    drawer: 1,
    box: 2,
    slot: 3,
    storedDate: '2026-05-02',
    handler: '覃羽'
  }
  await db.sites.put(site)
  await db.specimens.bulkPut([sp1, sp2])
  await db.determinations.put(det1)
  await db.storages.put(stg1)

  const ctx: MergeContext = {
    specimens: [sp1, sp2],
    sites: [site],
    storages: [stg1],
    determinations: [det1]
  }
  return { ctx, sp1, sp2, site, det1, stg1 }
}

const fieldSpec = (over: Partial<FieldSpecimen>): FieldSpecimen => ({
  id: '',
  code: '',
  order: '鞘翅目',
  family: '',
  genus: '',
  species: '',
  tempName: '',
  collectDate: '2026-05-03',
  collector: '外业',
  sex: '未知',
  stage: '成虫',
  bodyLength: 10,
  method: '扫网',
  quantity: 1,
  status: '待鉴定',
  determiner: '',
  siteId: 'site_qlb',
  note: '',
  ...over
})

const batch = (over: Partial<FieldBatch>): FieldBatch => ({
  batchId: 'B-001',
  team: '一队',
  exportedAt: '2026-05-04T00:00:00.000Z',
  specimens: [],
  ...over
})

const ctxOf = async (): Promise<MergeContext> => ({
  specimens: await db.specimens.toArray(),
  sites: await db.sites.toArray(),
  storages: await db.storages.toArray(),
  determinations: await db.determinations.toArray()
})

describe('外业批次合并', () => {
  beforeEach(async () => {
    await db.delete()
  })

  it('两个分队排出同一编号：撞号新标本顺延重取，鉴定记录与柜位跟随新编号不悬空', async () => {
    const { } = await seedBase()
    // 新标本离线自排 QLB-2026-0001，与馆内撞号；下一号 0002 也被占用，应顺延到 0003
    const incoming = fieldSpec({
      id: 'field_sp_1',
      code: 'QLB-2026-0001',
      tempName: '褐真蝽'
    })
    const det: Determination = {
      id: 'field_det_1',
      specimenId: 'field_sp_1',
      determiner: '外业·覃羽',
      date: '2026-05-03',
      conclusion: 'Pentatomidae sp.',
      reference: '速查',
      confidence: '低',
      needReview: true
    }
    const stg: Storage = {
      id: 'field_stg_1',
      specimenId: 'field_sp_1',
      method: '针插',
      cabinet: 'C09',
      drawer: 1,
      box: 1,
      slot: 1,
      storedDate: '2026-05-03',
      handler: '外业'
    }
    const result = await applyFieldBatch(batch({ specimens: [incoming], determinations: [det], storages: [stg] }))

    expect(result.duplicate).toBe(false)
    expect(result.ledger.renumberedCount).toBe(1)
    expect(result.ledger.renumberings[0].newCode).toBe('QLB-2026-0003')

    const merged = await db.specimens.get('field_sp_1')
    expect(merged?.code).toBe('QLB-2026-0003')
    expect(merged?.tempName).toBe('褐真蝽') // 采集信息保留

    // 挂接记录按 specimenId 跟随，仍指向该标本（不会指不到标本）
    const mergedDet = await db.determinations.get('field_det_1')
    const mergedStg = await db.storages.get('field_stg_1')
    expect(mergedDet?.specimenId).toBe('field_sp_1')
    expect(mergedStg?.specimenId).toBe('field_sp_1')

    // 馆内原标本与原编号未被动
    const local = await db.specimens.get('sp_001')
    expect(local?.code).toBe('QLB-2026-0001')
  })

  it('馆内已鉴定的鉴定内容不被外业覆盖：工作流字段保留馆内版，鉴定字段分歧保留两版', async () => {
    const { sp1 } = await seedBase()
    const incoming: FieldSpecimen = {
      ...sp1,
      family: '虎甲科', // 馆内已鉴定（sp_001 有鉴定记录），不得自动改
      tempName: '外业改名',
      status: '待复核', // 工作流字段，外业不得推进
      determiner: '外业人员',
      note: '外业补记', // 仅外业新增，自动采纳
      base: { family: sp1.family, tempName: sp1.tempName, status: sp1.status, determiner: sp1.determiner, note: '' }
    }
    await applyFieldBatch(batch({ specimens: [incoming] }))

    const merged = await db.specimens.get('sp_001')
    expect(merged?.family).toBe('步甲科') // 馆内版保留
    expect(merged?.tempName).toBe('大黑步甲') // 当前保持馆内版，待编目员选
    expect(merged?.status).toBe('已鉴定') // 外业的待复核被拒绝
    expect(merged?.determiner).toBe('覃羽')
    expect(merged?.note).toBe('外业补记')

    const conflicts = await db.mergeConflicts.toArray()
    const fields = conflicts.map((c) => c.field)
    expect(fields).toContain('family') // 鉴定内容字段：无自动覆盖，进分歧
    expect(fields).toContain('tempName')
    const familyConflict = conflicts.find((c) => c.field === 'family')
    expect(JSON.parse(familyConflict!.localValueJson)).toBe('步甲科')
    expect(JSON.parse(familyConflict!.fieldValueJson)).toBe('虎甲科')
    expect(familyConflict?.localSource).toContain('馆内')
    expect(familyConflict?.fieldSource).toContain('一队')
    // 工作流字段不进分歧（直接保护）
    expect(fields).not.toContain('status')
    expect(fields).not.toContain('determiner')
  })

  it('两边都改过的字段保留两版并标出来源；仅外业改的字段自动采纳', async () => {
    const { sp1 } = await seedBase()
    // sp_001 虽有鉴定记录，但 family/tempName 用「两边都改」场景；note 仅外业改
    // 为测纯三方分歧，另用 sp_002（无鉴定记录）覆盖 family 两边改
    const sp2 = await db.specimens.get('sp_002')
    const incomingSp2: FieldSpecimen = {
      ...sp2!,
      family: '灯蛾科', // 外业改
      tempName: '外业灯蛾', // 仅外业改 → 自动采纳
      note: '外业备注', // 仅外业改
      base: { family: '夜蛾科', tempName: '灰褐夜蛾', note: '' }
    }
    // 馆内已先把 family 改成 瘤蛾科（两边都改 family）
    await db.specimens.put({ ...sp2!, family: '瘤蛾科' })

    const incomingSp1: FieldSpecimen = {
      ...sp1,
      bodyLength: 99,
      note: '外业补记',
      base: { bodyLength: sp1.bodyLength, note: '' }
    }

    await applyFieldBatch(
      batch({ batchId: 'B-002', specimens: [incomingSp1, incomingSp2] })
    )

    const merged2 = await db.specimens.get('sp_002')
    expect(merged2?.family).toBe('瘤蛾科') // 当前保持馆内版，待编目员选
    expect(merged2?.tempName).toBe('外业灯蛾') // 仅外业改，采纳
    expect(merged2?.note).toBe('外业备注')

    const familyConflict = (await db.mergeConflicts.toArray()).find((c) => c.field === 'family')
    expect(familyConflict).toBeTruthy()
    expect(JSON.parse(familyConflict!.localValueJson)).toBe('瘤蛾科')
    expect(JSON.parse(familyConflict!.fieldValueJson)).toBe('灯蛾科')

    // sp_001 仅外业改 bodyLength → 自动采纳（虽然已鉴定，但体长非鉴定内容）
    const merged1 = await db.specimens.get('sp_001')
    expect(merged1?.bodyLength).toBe(99)
    expect(merged1?.note).toBe('外业补记')
  })

  it('整批失败整体回滚：非法批次一条不写', async () => {
    await seedBase()
    const before = await ctxOf()
    const bad = fieldSpec({ id: 'field_bad', code: '不符合编号规则' })
    await expect(applyFieldBatch(batch({ specimens: [bad] }))).rejects.toBeInstanceOf(MergeValidationError)

    const after = await ctxOf()
    expect(after.specimens.length).toBe(before.specimens.length)
    expect(after.sites.length).toBe(before.sites.length)
    expect(await db.mergeLedgers.count()).toBe(0)
  })

  it('同一批再送一次幂等：不多出重复标本，返回既有台账', async () => {
    await seedBase()
    const incoming = fieldSpec({ id: 'field_sp_x', code: 'QLB-2026-0009' })
    const payload = batch({ specimens: [incoming] })
    const first = await applyFieldBatch(payload)
    expect(first.duplicate).toBe(false)

    const second = await applyFieldBatch(payload)
    expect(second.duplicate).toBe(true)
    expect(second.ledger.batchId).toBe('B-001')

    expect(await db.specimens.count()).toBe(3) // 2 基线 + 1，没有重复
    expect(await db.mergeLedgers.count()).toBe(1)
  })

  it('同批次号但内容不同：拒绝合并（指纹校验）', async () => {
    await seedBase()
    await applyFieldBatch(batch({ specimens: [fieldSpec({ id: 'x1', code: 'QLB-2026-0011' })] }))
    const tampered = batch({
      specimens: [fieldSpec({ id: 'x1', code: 'QLB-2026-0011', tempName: '被改过' })]
    })
    await expect(applyFieldBatch(tampered)).rejects.toBeInstanceOf(MergeValidationError)
    expect(await db.specimens.count()).toBe(3)
  })

  it('预检 planMerge：新采集地随批入库、已存在采集地保留馆内版并 remap 引用', async () => {
    const { ctx } = await seedBase()
    const newSite: CollectSite = {
      ...ctx.sites[0],
      id: 'field_site_lyg',
      code: 'LYG',
      name: '老丫沟'
    }
    // 引用 QLB 的新标本：馆内已存在 QLB，外业 id 不同时应通过批内 sites 映射
    const sameCodeSite: CollectSite = { ...ctx.sites[0], id: 'field_qlb_copy', name: '外业青龙背' }
    const usingSite = fieldSpec({ id: 'f1', code: 'QLB-2026-0007', siteId: 'field_qlb_copy' })
    const usingNew = fieldSpec({ id: 'f2', code: 'LYG-2026-0001', siteId: 'field_site_lyg' })

    const plan = planMerge(batch({ sites: [newSite, sameCodeSite], specimens: [usingSite, usingNew] }), ctx)
    expect(plan.sitePuts.map((s) => s.code)).toEqual(['LYG'])
    expect(plan.siteSkipped.map((s) => s.id)).toEqual(['field_qlb_copy'])
    expect(plan.siteIdRemap.get('field_qlb_copy')).toBe('site_qlb')
    const f1 = plan.specimenPuts.find((s) => s.id === 'f1')
    expect(f1?.siteId).toBe('site_qlb') // 引用 remap 到馆内采集地
    const f2 = plan.specimenPuts.find((s) => s.id === 'f2')
    expect(f2?.siteId).toBe('field_site_lyg')
  })

  it('指纹函数对键顺序不敏感', () => {
    const a = batch({ specimens: [fieldSpec({ id: 'z', code: 'QLB-2026-0001' })] })
    const b = JSON.parse(JSON.stringify(a)) as FieldBatch
    // 打乱 b.specimens[0] 的键顺序
    const src = b.specimens[0] as unknown as Record<string, unknown>
    const reordered: Record<string, unknown> = {}
    Object.keys(src)
      .reverse()
      .forEach((k) => {
        reordered[k] = src[k]
      })
    b.specimens[0] = reordered as unknown as FieldSpecimen
    expect(computeBatchHash(a)).toBe(computeBatchHash(b))
  })

  it('批内编号互相撞号也会顺延，且两条新标本都不丢', async () => {
    const { } = await seedBase()
    const a = fieldSpec({ id: 'fa', code: 'QLB-2026-0001' }) // 撞馆内
    const b = fieldSpec({ id: 'fb', code: 'QLB-2026-0001' }) // 撞 a
    await applyFieldBatch(batch({ batchId: 'B-003', specimens: [a, b] }))
    const codes = (await db.specimens.toArray()).filter((s) => ['fa', 'fb'].includes(s.id)).map((s) => s.code)
    expect(codes.sort()).toEqual(['QLB-2026-0003', 'QLB-2026-0004'])
  })

  it('柜位重复占用不阻断合并（记录仍跟随标本），但台账给出提示', async () => {
    await seedBase()
    const incoming = fieldSpec({ id: 'fc', code: 'QLB-2026-0005' })
    const stg: Storage = {
      id: 'stg_c',
      specimenId: 'fc',
      method: '针插',
      cabinet: 'C01',
      drawer: 1,
      box: 2,
      slot: 3, // 与馆内 stg_001 完全相同
      storedDate: '2026-05-03',
      handler: '外业'
    }
    const result = await applyFieldBatch(batch({ batchId: 'B-004', specimens: [incoming], storages: [stg] }))
    expect(result.ledger.warningCount).toBeGreaterThan(0)
    expect(await db.storages.get('stg_c')).toBeTruthy()
    expect((await db.storages.get('stg_c'))?.specimenId).toBe('fc')
  })

  it('批次带了馆内已有 id 的鉴定/柜位记录：保留馆内版并提示，不覆盖也不另造重复', async () => {
    const { det1, stg1 } = await seedBase()
    const incoming = fieldSpec({ id: 'sp_001', code: 'QLB-2026-0001', note: '同 id 标本更新' })
    // 同 id 鉴定记录，内容被外业改写；同 id 柜位记录，柜位也被改
    const detClone: Determination = { ...det1, conclusion: '外业强改的结论', reference: '外业文献' }
    const stgClone: Storage = { ...stg1, cabinet: 'C99', slot: 9 }
    const result = await applyFieldBatch(
      batch({ batchId: 'B-005', specimens: [incoming], determinations: [detClone], storages: [stgClone] })
    )

    // 馆内鉴定与柜位原样保留，没有被覆盖
    expect((await db.determinations.get('det_001'))?.conclusion).toBe(det1.conclusion)
    const keptStg = await db.storages.get('stg_001')
    expect(keptStg?.cabinet).toBe('C01')
    expect(keptStg?.slot).toBe(3)
    // 没有另造重复记录
    expect(await db.determinations.where('specimenId').equals('sp_001').count()).toBe(1)
    expect(await db.storages.where('specimenId').equals('sp_001').count()).toBe(1)
    expect(result.ledger.warnings.join('\n')).toContain('鉴定记录')
    expect(result.ledger.warnings.join('\n')).toContain('柜位记录')
  })
})
