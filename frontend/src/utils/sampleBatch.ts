import type { CollectSite, Determination, FieldBatch, FieldSpecimen, Specimen, Storage } from '@/types'
import { nextSerial, buildSpecimenCode } from '@/utils/codec'

/**
 * 构造一份「外业分队离线登记」示例批次，供合并页一键载入演示：
 * 覆盖五种典型情形——
 * 1) 新采集地随批登记；
 * 2) 新标本编号与馆内撞号（两个分队各自排出同一编号），需要顺延重取；
 * 3) 同一份标本的字段两边都改过 → 字段分歧，编目员挑版；
 * 4) 仅外业改过的字段自动采纳；馆内已鉴定的鉴定内容被保护；
 * 5) 鉴定记录 / 柜位跟随新编号搬迁；柜位重复占用给出提示。
 * 数据取自馆内当前标本，保证每次载入的编号与现状对齐。
 */
export function buildSampleBatch(input: {
  specimens: Specimen[]
  sites: CollectSite[]
  team?: string
}): FieldBatch {
  const { specimens, sites } = input
  const team = input.team ?? '一队（演示）'
  const today = new Date().toISOString().slice(0, 10)
  const batchId = `DEMO-${today.replace(/-/g, '')}`

  const sp1 = specimens.find((item) => item.code.startsWith('QLB-'))
  const sp2 = specimens.find((item) => item.id !== sp1?.id && item.code.startsWith('QLB-'))
  const qlb = sites.find((site) => site.code === 'QLB')

  const batchSites: CollectSite[] = [
    {
      id: 'field_site_lyg',
      code: 'LYG',
      name: '老丫沟针阔混交林样地',
      region: '黔南州 · 平塘县',
      longitude: 107.182,
      latitude: 25.8014,
      altitude: 1042,
      habitat: '针阔混交林',
      microHabitat: '林缘灌丛与枯竹混杂',
      microClimate: '上午多云，地表湿润',
      dateStart: today,
      dateEnd: today
    }
  ]

  const batchSpecimens: FieldSpecimen[] = []

  // —— 情形 3：sp_001 同一份标本，科被两边各改一版（需裁定）；备注仅外业改（自动采纳）——
  if (sp1 && qlb) {
    const updated1: FieldSpecimen = {
      ...sp1,
      family: sp1.family === '步甲科' ? '虎甲科（外业复核）' : '外业修订科',
      note: `${sp1.note || '原备注'}｜外业补记：当晚灯诱同步见同种 2 只`,
      // 离队前快照：科是原值、备注是原值，馆内外业此后各自改了科
      base: { family: sp1.family, note: sp1.note, tempName: sp1.tempName }
    }
    batchSpecimens.push(updated1)
  }

  // —— 情形 4：sp_002 馆内已有鉴定记录，属/种外业试图补全被保护；采集方式仅外业改自动采纳 ——
  if (sp2) {
    const updated2: FieldSpecimen = {
      ...sp2,
      genus: 'Agrotis',
      species: 'ypsilon',
      method: '马氏网',
      note: `${sp2.note || ''}｜外业加记：马氏网连续 3 日`.trim(),
      base: { genus: sp2.genus, species: sp2.species, method: sp2.method, note: sp2.note }
    }
    batchSpecimens.push(updated2)
  }

  // —— 情形 1+2：老丫沟新标本，编号按离线流水自排，恰好撞馆内 QLB 号段之外的演示：
  //    这里故意造一个与馆内 QLB-2026 现有编号撞号的新标本，验证顺延重取 ——
  const collisionSerial = nextSerial('QLB', 2026, specimens.map((item) => item.code))
  const collisionCode = buildSpecimenCode('QLB', 2026, Math.max(1, collisionSerial - 1))
  const collisionId = `field_sp_collision_${collisionSerial}`
  const collision: FieldSpecimen = {
    id: collisionId,
    code: collisionCode,
    order: '半翅目',
    family: '蝽科',
    genus: '',
    species: '',
    tempName: '褐真蝽（撞号待重取）',
    collectDate: today,
    collector: '外业·陆昀',
    sex: '未知',
    stage: '成虫',
    bodyLength: 12.6,
    method: '扫网',
    quantity: 1,
    status: '待鉴定',
    determiner: '',
    siteId: qlb?.id ?? 'site_qlb',
    note: '离线自排编号，回馆合并时需顺延重取'
  }
  batchSpecimens.push(collision)

  // 新采集地标本（编号不撞，直接入库）
  const lygSerial = nextSerial('LYG', 2026, specimens.map((item) => item.code))
  const newId = 'field_sp_lyg_0001'
  batchSpecimens.push({
    id: newId,
    code: buildSpecimenCode('LYG', 2026, lygSerial),
    order: '膜翅目',
    family: '蚁科',
    genus: 'Camponotus',
    species: '',
    tempName: '弓背蚁一种',
    collectDate: today,
    collector: '外业·蓝澈',
    sex: '雌',
    stage: '成虫',
    bodyLength: 9.2,
    method: '徒手',
    quantity: 6,
    status: '待鉴定',
    determiner: '',
    siteId: 'field_site_lyg',
    note: '倒木蚁巢口采集'
  })

  // —— 情形 5：挂在撞号标本上的外业鉴定记录与柜位，跟随标本新编号走 ——
  const determinations: Determination[] = [
    {
      id: 'field_det_collision',
      specimenId: collisionId,
      determiner: '外业·覃羽',
      date: today,
      conclusion: 'Pentatomidae sp.',
      reference: '外业图谱速查（回馆待核）',
      confidence: '低',
      needReview: true
    }
  ]
  const storages: Storage[] = [
    {
      id: 'field_stg_collision',
      specimenId: collisionId,
      method: '针插',
      cabinet: 'C01',
      drawer: 1,
      box: 2,
      // 故意与馆内示例柜位同屉同盒不同插位之外的占用：取馆内已占用插位制造提示
      slot: 3,
      storedDate: today,
      handler: '外业·覃羽'
    }
  ]

  return {
    batchId,
    team,
    exportedAt: new Date().toISOString(),
    note: '演示批次：含撞号重取、字段分歧、已鉴定保护、挂接记录跟随、柜位占用提示',
    sites: batchSites,
    specimens: batchSpecimens,
    determinations,
    storages
  }
}
