import type { CollectSite, Determination, Specimen, Storage } from './index'

/**
 * 外业批次：分队在无信号环境下离线登记，回到驻地后整批送合并。
 * - sites：分队本地新建的采集地（已在馆内的，按 code 匹配，不要求 id 相同）
 * - specimens：标本全字段记录；对同一份标本的离线修改可附带 base 离队前快照，用于三方比对
 * - determinations / storages：挂在本批标本上的鉴定记录与保藏柜位，按 specimenId 跟随标本
 */
export interface FieldBatch {
  /** 批次号：外业导出时生成，全局唯一，整批重试时保持不变（幂等键） */
  batchId: string
  /** 分队名称，作为外业版本的来源标记 */
  team: string
  exportedAt: string
  note?: string
  sites?: CollectSite[]
  specimens: FieldSpecimen[]
  determinations?: Determination[]
  storages?: Storage[]
}

/** 外业标本：在 Specimen 基础上附带离队前快照，用于判断字段是哪一方改的 */
export interface FieldSpecimen extends Specimen {
  /** 离队前该标本在馆内的字段快照；没有快照时字段分歧一律交编目员裁定 */
  base?: Partial<Specimen>
}

/** 参与三方比对的标本字段（工作流字段 status/determiner 与编号 code 不在其列） */
export const MERGE_FIELDS = [
  { key: 'order', label: '目' },
  { key: 'family', label: '科' },
  { key: 'genus', label: '属' },
  { key: 'species', label: '种' },
  { key: 'tempName', label: '暂定名' },
  { key: 'collectDate', label: '采集日期' },
  { key: 'collector', label: '采集人' },
  { key: 'sex', label: '性别' },
  { key: 'stage', label: '虫态' },
  { key: 'bodyLength', label: '体长' },
  { key: 'method', label: '采集方式' },
  { key: 'quantity', label: '数量' },
  { key: 'note', label: '备注' },
  { key: 'siteId', label: '采集地' }
] as const

export type MergeableFieldKey = (typeof MERGE_FIELDS)[number]['key']

export function fieldLabelOf(key: string): string {
  return MERGE_FIELDS.find((item) => item.key === key)?.label ?? key
}

/** 字段分歧：两边都改过（或无快照无法判定），两版都留着，编目员挑一版 */
export interface FieldConflict {
  id: string
  batchId: string
  specimenId: string
  /** 冲突发生时的标本编号（重编号后的新编号），便于列表展示 */
  specimenCode: string
  field: MergeableFieldKey
  fieldLabel: string
  /** 馆内版本（JSON 序列化，保留数字/枚举原始类型） */
  localValueJson: string
  /** 外业版本（JSON 序列化） */
  fieldValueJson: string
  localSource: string
  /** 外业版本来源，如「外业·一队」 */
  fieldSource: string
  status: '待处理' | '已解决'
  /** 编目员最终选择 */
  chosenSide?: '馆内' | '外业'
  resolvedAt?: string
}

/** 一次重编号记录 */
export interface Renumbering {
  specimenId: string
  oldCode: string
  newCode: string
  reason: string
}

/** 合并台账：每个批次一行，保证整批重试不产生重复标本 */
export interface MergeLedger {
  /** 主键即批次号 */
  batchId: string
  team: string
  exportedAt: string
  appliedAt: string
  /** 批次内容指纹；同批次号但内容不同会被拒绝 */
  payloadHash: string
  insertedCount: number
  updatedCount: number
  renumberedCount: number
  conflictCount: number
  warningCount: number
  renumberings: Renumbering[]
  warnings: string[]
}

/** 合并预检 / 执行结果 */
export interface MergeResult {
  duplicate: boolean
  ledger: MergeLedger
}
