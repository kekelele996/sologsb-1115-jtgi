import type { ReactNode } from 'react'
import type { CollectSite, Specimen } from '@/types'
import { specimenTaxon } from '@/utils/codec'
import StatusTag from './StatusTag'

export interface SpecimenCardProps {
  specimen: Specimen
  site?: CollectSite
  /** 是否处于选中态 */
  selected?: boolean
  /** 左上角勾选（批量操作） */
  selectable?: boolean
  onToggle?: (id: string) => void
  onOpen?: (specimen: Specimen) => void
  /** 卡片底部自定义操作区 */
  footer?: ReactNode
}

/** 标本摘要卡片：分类阶元 + 采集地 + 鉴定状态 */
export default function SpecimenCard({
  specimen,
  site,
  selected = false,
  selectable = false,
  onToggle,
  onOpen,
  footer
}: SpecimenCardProps): JSX.Element {
  return (
    <article
      data-testid="specimen-card"
      className={`flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-sm transition ${
        selected ? 'border-field-500 ring-1 ring-field-500' : 'border-slate-200 hover:border-field-100'
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {selectable ? (
            <input
              type="checkbox"
              aria-label={`选择标本 ${specimen.code}`}
              className="mt-1 h-4 w-4 accent-field-600"
              checked={selected}
              onChange={() => onToggle?.(specimen.id)}
            />
          ) : null}
          <div>
            <button
              type="button"
              onClick={() => onOpen?.(specimen)}
              className="text-left font-mono text-sm font-semibold text-field-700 hover:underline"
            >
              {specimen.code}
            </button>
            <p className="text-sm text-slate-700">{specimenTaxon(specimen)}</p>
            <p className="text-xs text-slate-500">
              {specimen.order}
              {specimen.family ? ` · ${specimen.family}` : ''} · {specimen.sex} · {specimen.stage} ·{' '}
              {specimen.bodyLength} mm
            </p>
          </div>
        </div>
        <StatusTag status={specimen.status} />
      </header>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
        <div>
          <dt className="text-slate-400">采集地</dt>
          <dd>{site ? site.name : '未关联采集地'}</dd>
        </div>
        <div>
          <dt className="text-slate-400">采集日期</dt>
          <dd>{specimen.collectDate}</dd>
        </div>
        <div>
          <dt className="text-slate-400">采集方式</dt>
          <dd>
            {specimen.method} × {specimen.quantity}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">采集人</dt>
          <dd>{specimen.collector || '—'}</dd>
        </div>
      </dl>
      {specimen.note ? <p className="rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-500">{specimen.note}</p> : null}
      {footer ? <footer className="mt-1 flex flex-wrap gap-2">{footer}</footer> : null}
    </article>
  )
}
