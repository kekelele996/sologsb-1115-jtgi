/** 置信度 */
export const CONFIDENCES = ['高', '中', '低'] as const
export type Confidence = (typeof CONFIDENCES)[number]

/** Determination 鉴定记录 */
export interface Determination {
  id: string
  specimenId: string
  determiner: string
  date: string
  /** 鉴定结论（学名） */
  conclusion: string
  /** 依据文献 */
  reference: string
  confidence: Confidence
  needReview: boolean
}
