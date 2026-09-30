/** 采集方式 */
export const COLLECT_METHODS = ['扫网', '灯诱', '巴氏罐诱', '马氏网', '徒手'] as const
export type CollectMethod = (typeof COLLECT_METHODS)[number]

/** 鉴定状态 */
export const DET_STATUSES = ['待鉴定', '初鉴', '已鉴定', '待复核'] as const
export type DetStatus = (typeof DET_STATUSES)[number]

/** 性别 */
export const SEXES = ['雌', '雄', '未知'] as const
export type Sex = (typeof SEXES)[number]

/** 虫态 */
export const STAGES = ['成虫', '幼虫', '蛹', '卵'] as const
export type Stage = (typeof STAGES)[number]

/** 目（常用调查类群） */
export const ORDERS = ['鞘翅目', '鳞翅目', '膜翅目', '双翅目', '半翅目', '直翅目', '蜻蜓目'] as const

/** Specimen 标本 */
export interface Specimen {
  id: string
  /** 标本编号：采集地代码-年份-流水号 */
  code: string
  order: string
  family: string
  genus: string
  species: string
  /** 暂定名 */
  tempName: string
  collectDate: string
  collector: string
  sex: Sex
  stage: Stage
  /** 体长（mm） */
  bodyLength: number
  method: CollectMethod
  /** 个体数量 */
  quantity: number
  status: DetStatus
  determiner: string
  siteId: string
  note: string
}
