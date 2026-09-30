import type { DetStatus } from '@/types'

const STYLES: Record<DetStatus, string> = {
  待鉴定: 'bg-slate-100 text-slate-700 border-slate-300',
  初鉴: 'bg-sky-50 text-sky-700 border-sky-300',
  已鉴定: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  待复核: 'bg-amber-50 text-amber-700 border-amber-300'
}

const DOTS: Record<DetStatus, string> = {
  待鉴定: 'bg-slate-400',
  初鉴: 'bg-sky-500',
  已鉴定: 'bg-emerald-500',
  待复核: 'bg-amber-500'
}

export interface StatusTagProps {
  status: DetStatus
  /** 是否显示状态圆点 */
  withDot?: boolean
  className?: string
}

/** 鉴定状态标签：4 种状态各自配色 */
export default function StatusTag({ status, withDot = true, className = '' }: StatusTagProps): JSX.Element {
  return (
    <span
      data-testid="status-tag"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs leading-5 ${STYLES[status]} ${className}`}
    >
      {withDot ? <i className={`h-1.5 w-1.5 rounded-full ${DOTS[status]}`} /> : null}
      {status}
    </span>
  )
}
