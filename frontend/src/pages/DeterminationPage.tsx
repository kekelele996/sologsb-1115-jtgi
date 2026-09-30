import { useMemo, useState } from 'react'
import type { Confidence, DetStatus, Determination, Specimen } from '@/types'
import { CONFIDENCES } from '@/types'
import StatusTag from '@/components/common/StatusTag'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { determinationStore } from '@/stores/determinationStore'
import { specimenStore } from '@/stores/specimenStore'
import { siteStore } from '@/stores/siteStore'
import { downloadCsv } from '@/utils/export'
import { specimenTaxon } from '@/utils/codec'
import { uid } from '@/utils/id'

const QUEUE_STATUSES: DetStatus[] = ['待鉴定', '初鉴', '待复核']

/** 鉴定工作流：待鉴定队列逐条处理，落鉴定记录并推进标本状态 */
export default function DeterminationPage(): JSX.Element {
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const sites = usePersistentStore(siteStore, (state) => state.rows)
  const determinations = usePersistentStore(determinationStore, (state) => state.rows)

  const queue = useMemo(
    () => specimens.filter((item) => QUEUE_STATUSES.includes(item.status)),
    [specimens]
  )
  const [activeId, setActiveId] = useState('')
  const active = specimens.find((item) => item.id === activeId) ?? queue[0] ?? null

  const [determiner, setDeterminer] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [conclusion, setConclusion] = useState('')
  const [reference, setReference] = useState('')
  const [confidence, setConfidence] = useState<Confidence>('中')
  const [needReview, setNeedReview] = useState(false)
  const [message, setMessage] = useState('')

  const siteName = (siteId: string): string => sites.find((site) => site.id === siteId)?.name ?? '未关联采集地'

  const historyOf = (specimenId: string): Determination[] =>
    determinations.filter((item) => item.specimenId === specimenId)

  const pick = (specimen: Specimen): void => {
    setActiveId(specimen.id)
    setConclusion([specimen.genus, specimen.species].filter(Boolean).join(' '))
    setNeedReview(specimen.status === '待复核')
    setMessage('')
  }

  const submit = async (): Promise<void> => {
    if (!active) {
      setMessage('队列已清空，没有待处理标本')
      return
    }
    if (!determiner.trim()) {
      setMessage('请填写鉴定人')
      return
    }
    if (!conclusion.trim()) {
      setMessage('请填写鉴定结论（学名）')
      return
    }
    const record: Determination = {
      id: uid('det'),
      specimenId: active.id,
      determiner: determiner.trim(),
      date,
      conclusion: conclusion.trim(),
      reference: reference.trim(),
      confidence,
      needReview
    }
    await determinationStore.getState().save(record)
    await specimenStore.getState().save({
      ...active,
      status: needReview ? '待复核' : '已鉴定',
      determiner: determiner.trim()
    })
    setMessage(
      `${active.code} 已落鉴定记录：${record.conclusion}（置信度 ${record.confidence}，状态更新为${
        needReview ? '待复核' : '已鉴定'
      }）`
    )
    setActiveId('')
    setConclusion('')
    setReference('')
    setNeedReview(false)
  }

  const exportHistory = (): void => {
    const rows = determinations.map((item) => {
      const specimen = specimens.find((sp) => sp.id === item.specimenId)
      return {
        code: specimen?.code ?? item.specimenId,
        determiner: item.determiner,
        date: item.date,
        conclusion: item.conclusion,
        reference: item.reference,
        confidence: item.confidence,
        needReview: item.needReview ? '是' : '否'
      }
    })
    downloadCsv('鉴定记录.csv', rows as unknown as Record<string, unknown>[], [
      { key: 'code', label: '标本编号' },
      { key: 'determiner', label: '鉴定人' },
      { key: 'date', label: '鉴定日期' },
      { key: 'conclusion', label: '鉴定结论' },
      { key: 'reference', label: '依据文献' },
      { key: 'confidence', label: '置信度' },
      { key: 'needReview', label: '需复核' }
    ])
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">鉴定工作流</h1>
          <p className="page-sub">
            待鉴定队列逐条处理：填写结论与依据文献后落鉴定记录，标本状态自动推进为「已鉴定」或「待复核」。
          </p>
        </div>
        <button className="btn-ghost" type="button" onClick={exportHistory}>
          导出鉴定记录
        </button>
      </header>

      <section className="grid gap-4 md:grid-cols-[320px_1fr]">
        <div className="panel flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-700">待处理队列（{queue.length}）</h2>
          <div className="max-h-[420px] overflow-auto">
            {queue.map((specimen) => (
              <button
                key={specimen.id}
                type="button"
                onClick={() => pick(specimen)}
                className={`mb-1.5 w-full rounded-lg border px-3 py-2 text-left transition ${
                  active?.id === specimen.id ? 'border-field-500 bg-field-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-field-700">{specimen.code}</span>
                  <StatusTag status={specimen.status} />
                </span>
                <span className="mt-0.5 block text-xs text-slate-600">{specimenTaxon(specimen)}</span>
                <span className="block text-[11px] text-slate-400">
                  {siteName(specimen.siteId)} · {specimen.collectDate}
                </span>
              </button>
            ))}
            {queue.length === 0 ? <p className="text-sm text-slate-400">队列已清空，所有标本都已处理</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel">
            <h2 className="text-sm font-semibold text-slate-700">
              {active ? `处理 ${active.code}` : '请从左侧队列选择标本'}
            </h2>
            {active ? (
              <p className="mt-1 text-xs text-slate-500">
                {specimenTaxon(active)} · {siteName(active.siteId)} · 采集人 {active.collector || '—'} · 采集方式{' '}
                {active.method} · 体长 {active.bodyLength} mm
              </p>
            ) : null}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <span className="field-label">鉴定人</span>
                <input className="field-input" value={determiner} onChange={(e) => setDeterminer(e.target.value)} placeholder="如 覃羽" />
              </div>
              <div>
                <span className="field-label">鉴定日期</span>
                <input type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <span className="field-label">鉴定结论（学名）</span>
                <input className="field-input" value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder="如 Carabus smaragdinus" />
              </div>
              <div className="md:col-span-2">
                <span className="field-label">依据文献</span>
                <input className="field-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="如 《中国步甲志》第二卷 P.218" />
              </div>
              <div>
                <span className="field-label">置信度</span>
                <select className="field-input" value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)}>
                  {CONFIDENCES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <label className="mt-5 flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" className="h-4 w-4 accent-field-600" checked={needReview} onChange={(e) => setNeedReview(e.target.checked)} />
                标记为需复核（状态置为「待复核」）
              </label>
            </div>
            {message ? <p className="mt-3 text-sm text-field-700">{message}</p> : null}
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" type="button" onClick={() => void submit()}>
                提交鉴定记录
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => {
                  setConclusion('')
                  setReference('')
                  setNeedReview(false)
                  setMessage('')
                }}
              >
                清空结论
              </button>
            </div>
          </div>

          {active ? (
            <div className="panel">
              <h3 className="text-sm font-semibold text-slate-700">该标本的历史鉴定记录</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {historyOf(active.id).map((record) => (
                  <li key={record.id} className="rounded-lg border border-slate-200 px-3 py-2">
                    <p className="font-medium text-slate-800">{record.conclusion}</p>
                    <p className="text-xs text-slate-500">
                      {record.determiner} · {record.date} · 置信度 {record.confidence} ·{' '}
                      {record.needReview ? '需复核' : '无需复核'}
                    </p>
                    <p className="text-xs text-slate-400">依据：{record.reference || '未填写'}</p>
                  </li>
                ))}
                {historyOf(active.id).length === 0 ? <li className="text-xs text-slate-400">暂无鉴定记录</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <h2 className="text-sm font-semibold text-slate-700">全部鉴定记录（{determinations.length}）</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="border border-slate-200 px-2 py-1">标本编号</th>
                <th className="border border-slate-200 px-2 py-1">鉴定人</th>
                <th className="border border-slate-200 px-2 py-1">日期</th>
                <th className="border border-slate-200 px-2 py-1">结论</th>
                <th className="border border-slate-200 px-2 py-1">依据文献</th>
                <th className="border border-slate-200 px-2 py-1">置信度</th>
                <th className="border border-slate-200 px-2 py-1">标本状态</th>
                <th className="border border-slate-200 px-2 py-1">操作</th>
              </tr>
            </thead>
            <tbody>
              {determinations.map((record) => {
                const specimen = specimens.find((item) => item.id === record.specimenId)
                return (
                  <tr key={record.id}>
                    <td className="border border-slate-200 px-2 py-1 font-mono text-xs">{specimen?.code ?? '—'}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.determiner}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.date}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.conclusion}</td>
                    <td className="border border-slate-200 px-2 py-1 text-xs text-slate-500">{record.reference || '—'}</td>
                    <td className="border border-slate-200 px-2 py-1">{record.confidence}</td>
                    <td className="border border-slate-200 px-2 py-1">{specimen ? <StatusTag status={specimen.status} /> : '—'}</td>
                    <td className="border border-slate-200 px-2 py-1">
                      <button
                        className="btn-danger"
                        type="button"
                        onClick={() => void determinationStore.getState().remove(record.id)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
