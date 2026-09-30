import { planMerge, type FieldBatch, type MuseumSnapshot } from './src/utils/merge'
import type { Specimen, Determination, Storage } from './src/types'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${msg}`)
  } else {
    fail += 1
    console.error(`  ✗ ${msg}`)
  }
}

function sp(over: Partial<Specimen> & { id: string; code: string }): Specimen {
  return {
    order: '鞘翅目',
    family: '步甲科',
    genus: 'Carabus',
    species: 'sp.',
    tempName: '大黑步甲',
    collectDate: '2026-06-01',
    collector: '陆昀',
    sex: '雄',
    stage: '成虫',
    bodyLength: 28.4,
    method: '徒手',
    quantity: 1,
    status: '待鉴定',
    determiner: '',
    siteId: 'site_qlb',
    note: '',
    ...over
  }
}

const museum: MuseumSnapshot = {
  specimens: [
    sp({ id: 'sp_001', code: 'QLB-2026-0001', status: '已鉴定', determiner: '覃羽' }),
    sp({ id: 'sp_002', code: 'QLB-2026-0002', status: '初鉴' }),
    sp({ id: 'sp_003', code: 'SHR-2026-0001', status: '待复核', tempName: '赤蜻（待复核）' }),
    sp({ id: 'sp_004', code: 'SHR-2026-0002', status: '待鉴定' })
  ],
  determinations: [
    { id: 'det_001', specimenId: 'sp_001', determiner: '覃羽', date: '2026-06-02', conclusion: 'Carabus smaragdinus', reference: '志', confidence: '高', needReview: false } as Determination,
    { id: 'det_002', specimenId: 'sp_002', determiner: '覃羽', date: '2026-06-02', conclusion: 'Noctuidae sp.', reference: '图鉴', confidence: '中', needReview: true } as Determination
  ],
  storages: [
    { id: 'stg_001', specimenId: 'sp_001', method: '针插', cabinet: 'C01', drawer: 1, box: 2, slot: 3, storedDate: '2026-06-03', handler: '覃羽' } as Storage
  ]
}

function batch(specimens: Specimen[], determinations: Determination[] = [], storages: Storage[] = []): FieldBatch {
  return { batchId: 'batch_test', team: '二队', exportedAt: '2026-06-10T00:00:00.000Z', specimens, determinations, storages }
}

console.log('场景1: 编号冲突（不同标本撞号）→ 重新取号')
{
  const f = sp({ id: 'sp_off_1', code: 'QLB-2026-0001', tempName: '外业新种' })
  const items = planMerge(batch([f]), museum)
  assert(items.length === 1, '返回 1 条结果')
  assert(items[0].outcome === 'renumbered', `outcome=renumbered（实际 ${items[0].outcome}）`)
  assert(items[0].newCode === 'QLB-2026-0003', `新编号 QLB-2026-0003（实际 ${items[0].newCode}）`)
  assert(items[0].museumProtected === true, '馆内原标本受保护（已有鉴定+入柜）')
}

console.log('场景2: 编号冲突但馆内未鉴定/入柜 → 仍重新取号，馆方不保护')
{
  const f = sp({ id: 'sp_off_2', code: 'SHR-2026-0001', tempName: '外业新种2' })
  const items = planMerge(batch([f]), museum)
  assert(items[0].outcome === 'renumbered', `outcome=renumbered（实际 ${items[0].outcome}）`)
  assert(items[0].newCode === 'SHR-2026-0003', `新编号 SHR-2026-0003（实际 ${items[0].newCode}）`)
  assert(items[0].museumProtected === false, '馆内原标本未保护（无鉴定/入柜）')
}

console.log('场景3: id 命中且馆内已鉴定 → 受保护，外业版本不盖掉')
{
  const f = sp({ id: 'sp_001', code: 'QLB-2026-0001', tempName: '外业改过的名字' })
  const items = planMerge(batch([f]), museum)
  assert(items[0].outcome === 'protected', `outcome=protected（实际 ${items[0].outcome}）`)
  assert(items[0].museumProtected === true, '标记为馆方保护')
}

console.log('场景4: id 命中、馆内未鉴定/入柜、字段不一致 → 字段冲突')
{
  const f = sp({ id: 'sp_003', code: 'SHR-2026-0001', tempName: '外业改的赤蜻', bodyLength: 40.2 })
  const items = planMerge(batch([f]), museum)
  assert(items[0].outcome === 'conflict', `outcome=conflict（实际 ${items[0].outcome}）`)
  assert((items[0].conflicts ?? []).length === 2, `2 个字段冲突（实际 ${(items[0].conflicts ?? []).length}）`)
  const fields = (items[0].conflicts ?? []).map((c) => c.field)
  assert(fields.includes('tempName'), 'tempName 冲突')
  assert(fields.includes('bodyLength'), 'bodyLength 冲突')
  const tempConflict = (items[0].conflicts ?? []).find((c) => c.field === 'tempName')
  assert(tempConflict?.museumValue === '赤蜻（待复核）', `馆方值保留（实际 ${tempConflict?.museumValue}）`)
  assert(tempConflict?.fieldValue === '外业改的赤蜻', `外业值保留（实际 ${tempConflict?.fieldValue}）`)
}

console.log('场景5: id 命中且字段完全一致 → identical')
{
  const f = sp({ id: 'sp_003', code: 'SHR-2026-0001', tempName: '赤蜻（待复核）' })
  const items = planMerge(batch([f]), museum)
  assert(items[0].outcome === 'identical', `outcome=identical（实际 ${items[0].outcome}）`)
}

console.log('场景6: id 与编号都未命中 → 新标本入库')
{
  const f = sp({ id: 'sp_off_3', code: 'GX-2026-0001', tempName: '广西新种' })
  const items = planMerge(batch([f]), museum)
  assert(items[0].outcome === 'inserted', `outcome=inserted（实际 ${items[0].outcome}）`)
  assert(items[0].newCode === undefined, '新标本不取号')
}

console.log('场景7: 新标本附带鉴定记录/保藏位置 → 随标本迁入')
{
  const f = sp({ id: 'sp_off_4', code: 'GX-2026-0002', tempName: '带鉴定的新种' })
  const det: Determination = { id: 'det_off_1', specimenId: 'sp_off_4', determiner: '外业鉴定人', date: '2026-06-09', conclusion: 'sp. nov.', reference: '', confidence: '低', needReview: true }
  const stg: Storage = { id: 'stg_off_1', specimenId: 'sp_off_4', method: '浸液', cabinet: 'C02', drawer: 1, box: 1, slot: 1, storedDate: '2026-06-09', handler: '外业经手人' }
  const items = planMerge(batch([f], [det], [stg]), museum)
  assert(items[0].outcome === 'inserted', '新标本入库')
  assert(items[0].attachedDet === 1, `附带 1 条鉴定（实际 ${items[0].attachedDet}）`)
  assert(items[0].attachedStorage === 1, `附带 1 个柜位（实际 ${items[0].attachedStorage}）`)
}

console.log('场景8: 同批次多条撞号 → 流水号连续分配，不与馆内/批次内冲突')
{
  const f1 = sp({ id: 'sp_off_5', code: 'QLB-2026-0001' })
  const f2 = sp({ id: 'sp_off_6', code: 'QLB-2026-0001' })
  const items = planMerge(batch([f1, f2]), museum)
  assert(items[0].newCode === 'QLB-2026-0003', `第1条新编号 QLB-2026-0003（实际 ${items[0].newCode}）`)
  assert(items[1].newCode === 'QLB-2026-0004', `第2条新编号 QLB-2026-0004（实际 ${items[1].newCode}）`)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
