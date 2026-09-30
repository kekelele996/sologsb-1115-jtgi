import { useRef, useState } from 'react'
import type { FieldBatch, FieldConflict, MergeLedger, Specimen } from '@/types'
import { fieldLabelOf } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { specimenStore } from '@/stores/specimenStore'
import { siteStore } from '@/stores/siteStore'
import { storageStore } from '@/stores/storageStore'
import { determinationStore } from '@/stores/determinationStore'
import { mergeStore } from '@/stores/mergeStore'
import {
  MergeValidationError,
  applyFieldBatch,
  planMerge,
  resolveFieldConflict,
  type MergeContext,
  type MergePlan
} from '@/utils/merge'
import { buildSampleBatch } from '@/utils/sampleBatch'

type JsonMode = 'file' | 'paste'

/** 分歧里序列化的值转成可读文本，siteId 优先显示采集地名称 */
function formatValue(json: string, siteMap: Map<string, string>): string {
  try {
    const value: unknown = JSON.parse(json)
    if (typeof value === 'string') return siteMap.get(value) ? `${siteMap.get(value)}（${value}）` : value
    if (value === null || value === undefined || value === '') return '（空）'
    return String(value)
  } catch {
    return json
  }
}

/** 外业批次合并：导入预检 → 整批事务合并 → 字段分歧裁定 → 合并台账 */
export default function MergePage(): JSX.Element {
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const sites = usePersistentStore(siteStore, (state) => state.rows)
  const conflicts = usePersistentStore(mergeStore, (state) => state.conflicts)
  const ledgers = usePersistentStore(mergeStore, (state) => state.ledgers)

  const [jsonMode, setJsonMode] = useState<JsonMode>('file')
  const [pasteText, setPasteText] = useState('')
  const [batch, setBatch] = useState<FieldBatch | null>(null)
  const [plan, setPlan] = useState<MergePlan | null>(null)
  const [appliedLedger, setAppliedLedger] = useState<MergeLedger | null>(null)
  const [wasDuplicate, setWasDuplicate] = useState(false)
  const [error, setError] = useState('')
  const [issues, setIssues] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const siteMap = new Map(sites.map((site) => [site.id, site.name]))
  const specimenMap = new Map(specimens.map((item) => [item.id, item]))

  const buildContext = (): MergeContext => ({
    specimens: specimenStore.getState().rows,
    sites: siteStore.getState().rows,
    storages: storageStore.getState().rows,
    determinations: determinationStore.getState().rows
  })

  /** 解析批次并做只读预检（不写库），生成「将要怎么合」的明细 */
  const loadBatch = (next: FieldBatch | null): void => {
    setAppliedLedger(null)
    setWasDuplicate(false)
    setError('')
    setIssues([])
    if (!next) {
      setBatch(null)
      setPlan(null)
      return
    }
    setBatch(next)
    try {
      setPlan(planMerge(next, buildContext()))
    } catch (err) {
      setPlan(null)
      if (err instanceof MergeValidationError) {
        setIssues(err.issues)
        setError('批次预检未通过，整批不会写入，修正后可原样重送。')
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  const onFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text()
      loadBatch(JSON.parse(text) as FieldBatch)
    } catch (err) {
      setBatch(null)
      setPlan(null)
      setIssues([])
      setError(err instanceof SyntaxError ? `JSON 解析失败：${err.message}` : String(err))
    }
  }

  const onPaste = (): void => {
    try {
      loadBatch(JSON.parse(pasteText) as FieldBatch)
    } catch (err) {
      setBatch(null)
      setPlan(null)
      setIssues([])
      setError(err instanceof SyntaxError ? `JSON 解析失败：${err.message}` : String(err))
    }
  }

  const onSample = (): void => {
    const sample = buildSampleBatch({ specimens, sites })
    setJsonMode('paste')
    setPasteText(JSON.stringify(sample, null, 2))
    loadBatch(sample)
  }

  /** 执行整批合并：失败事务整体回滚，同批次再送幂等不重复 */
  const submit = async (): Promise<void> => {
    if (!batch) return
    setBusy(true)
    setError('')
    setIssues([])
    try {
      const result = await applyFieldBatch(batch)
      setAppliedLedger(result.ledger)
      setWasDuplicate(result.duplicate)
      // 事务完成后统一水合四张业务表与合并台账，保证各页视图一致；
      // 预检计划保留为「本次实际执行」的记录，不再按合并后状态重算
      await Promise.all([
        specimenStore.getState().hydrate(),
        siteStore.getState().hydrate(),
        storageStore.getState().hydrate(),
        determinationStore.getState().hydrate(),
        mergeStore.getState().hydrate()
      ])
    } catch (err) {
      if (err instanceof MergeValidationError) {
        setIssues(err.issues)
        setError('整批合并失败并已整体回滚，没有写入任何标本/鉴定/柜位；修正后用原批次号重试即可。')
      } else {
        setError(`整批合并失败并已整体回滚：${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const choose = async (conflict: FieldConflict, side: '馆内' | '外业'): Promise<void> => {
    await resolveFieldConflict(conflict.id, side)
    await Promise.all([specimenStore.getState().hydrate(), mergeStore.getState().hydrate()])
  }

  const pendingConflicts = conflicts.filter((item) => item.status === '待处理')
  const resolvedConflicts = conflicts.filter((item) => item.status === '已解决')

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">外业批次合并</h1>
        <p className="page-sub">
          外业分队无信号离线登记、各自按「采集地代码-年份-流水号」排号；回驻地后整批送合并。撞号标本顺延重取，
          鉴定记录与柜位跟随新编号；馆内已鉴定/入柜内容不被覆盖；两边都改过的字段保留两版、标出来源交编目员裁定。
        </p>
      </header>

      {/* 一、导入批次 */}
      <section className="panel flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-700">1. 导入外业批次</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          {(['file', 'paste'] as JsonMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={jsonMode === mode ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setJsonMode(mode)}
            >
              {mode === 'file' ? '选择 JSON 文件' : '粘贴 JSON 文本'}
            </button>
          ))}
          <button type="button" className="btn-ghost" onClick={onSample}>
            一键载入演示批次
          </button>
        </div>

        {jsonMode === 'file' ? (
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="field-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onFile(file)
              e.target.value = ''
            }}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              className="field-input h-40 font-mono text-xs"
              placeholder='{"batchId":"...","team":"一队","specimens":[...]}'
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <div>
              <button type="button" className="btn-ghost" onClick={onPaste}>
                解析并预检
              </button>
            </div>
          </div>
        )}

        {batch ? (
          <dl className="grid gap-1 rounded-lg bg-field-50 p-3 text-xs text-field-700 md:grid-cols-4">
            <div>
              <dt className="text-field-600">批次号</dt>
              <dd className="font-mono font-semibold">{batch.batchId}</dd>
            </div>
            <div>
              <dt className="text-field-600">分队</dt>
              <dd>{batch.team}</dd>
            </div>
            <div>
              <dt className="text-field-600">导出时间</dt>
              <dd>{batch.exportedAt}</dd>
            </div>
            <div>
              <dt className="text-field-600">标本数</dt>
              <dd>{batch.specimens.length}</dd>
            </div>
            {batch.note ? <p className="text-field-600 md:col-span-4">备注：{batch.note}</p> : null}
          </dl>
        ) : null}

        {issues.length > 0 ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            <p className="mb-1 font-semibold">{error || '批次预检未通过'}</p>
            <ul className="list-inside list-disc space-y-1">
              {issues.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {issues.length === 0 && error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </section>

      {/* 二、预检明细 */}
      {plan ? (
        <section className="panel flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">
            2. 预检明细
            {appliedLedger ? (
              <span className="ml-2 text-xs font-normal text-field-600">
                （已于 {new Date(appliedLedger.appliedAt).toLocaleString('zh-CN')} 按此预案执行；再点一次合并即幂等重试）
              </span>
            ) : (
              <span className="ml-2 text-xs font-normal text-slate-400">（尚未写入）</span>
            )}
          </h2>
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <Stat label="新增标本" value={plan.insertedIds.length} tone="text-field-700" />
            <Stat label="更新标本" value={plan.updatedIds.length} />
            <Stat label="撞号重取" value={plan.renumberings.length} tone="text-amber-600" />
            <Stat label="字段分歧（待裁定）" value={plan.conflicts.length} tone="text-rose-600" />
            <Stat label="随批鉴定记录" value={plan.determinationPuts.length} />
            <Stat label="随批柜位" value={plan.storagePuts.length} />
            <Stat label="新采集地" value={plan.sitePuts.length} />
            <Stat label="提示" value={plan.warnings.length} />
          </div>

          {plan.renumberings.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-amber-700">撞号重取（采集信息保留，挂接记录跟随）</h3>
              <ul className="space-y-1 text-xs">
                {plan.renumberings.map((item) => (
                  <li key={item.specimenId} className="rounded bg-amber-50 px-2 py-1">
                    <span className="font-mono">{item.oldCode}</span>
                    <span className="mx-1">→</span>
                    <span className="font-mono font-semibold text-amber-700">{item.newCode}</span>
                    <span className="ml-2 text-slate-500">{item.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-500">
                  <th className="border border-slate-200 px-2 py-1">处理</th>
                  <th className="border border-slate-200 px-2 py-1">标本</th>
                  <th className="border border-slate-200 px-2 py-1">最终编号</th>
                  <th className="border border-slate-200 px-2 py-1">自动采纳外业字段</th>
                  <th className="border border-slate-200 px-2 py-1">字段分歧</th>
                  <th className="border border-slate-200 px-2 py-1">受保护跳过</th>
                </tr>
              </thead>
              <tbody>
                {plan.specimenPlans.map((item) => {
                  const currentCode = specimenMap.get(item.specimenId)?.code ?? ''
                  return (
                    <tr key={item.specimenId}>
                      <td className="border border-slate-200 px-2 py-1">{item.mode}</td>
                      <td className="border border-slate-200 px-2 py-1 font-mono">{item.oldCode}</td>
                      <td className="border border-slate-200 px-2 py-1">
                        <span className={item.renumbered ? 'font-semibold text-amber-700' : ''}>{item.finalCode}</span>
                        {item.mode === '更新' && currentCode && currentCode !== item.finalCode ? (
                          <span className="ml-1 text-slate-400">（馆内现编号 {currentCode}，保留）</span>
                        ) : null}
                      </td>
                      <td className="border border-slate-200 px-2 py-1">
                        {item.acceptedFields.map(fieldLabelOf).join('、') || '—'}
                      </td>
                      <td className="border border-slate-200 px-2 py-1">
                        {item.conflictFields.length > 0 ? (
                          <span className="text-rose-600">{item.conflictFields.map(fieldLabelOf).join('、')}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="border border-slate-200 px-2 py-1 text-slate-500">
                        {item.protectedSkips.map((skip) => `${fieldLabelOf(skip.field)}（${skip.reason}）`).join('；') || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {plan.warnings.length > 0 ? (
            <ul className="space-y-1 text-xs text-slate-600">
              {plan.warnings.map((item, index) => (
                <li key={`${item}-${index}`} className="rounded bg-slate-50 px-2 py-1">
                  · {item}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? '合并中…' : '确认整批合并'}
            </button>
            <span className="text-xs text-slate-400">
              合并在单个数据库事务内完成，失败整体回滚；同一批次号再送一次不会产生重复标本。
            </span>
          </div>
        </section>
      ) : null}

      {/* 三、合并结果 */}
      {appliedLedger ? (
        <section className="panel flex flex-col gap-2 border-field-200">
          <h2 className="text-sm font-semibold text-field-700">
            {wasDuplicate ? '该批次此前已合并（幂等重试，未重复写入）' : '3. 合并完成'}
          </h2>
          <dl className="grid gap-1 text-xs text-slate-600 md:grid-cols-4">
            <div>批次：<b>{appliedLedger.batchId}</b>（{appliedLedger.team}）</div>
            <div>新增 {appliedLedger.insertedCount} 份</div>
            <div>更新 {appliedLedger.updatedCount} 份</div>
            <div>重取编号 {appliedLedger.renumberedCount} 个</div>
            <div>字段分歧 {appliedLedger.conflictCount} 条</div>
            <div>提示 {appliedLedger.warningCount} 条</div>
            <div>合并时间 {new Date(appliedLedger.appliedAt).toLocaleString('zh-CN')}</div>
          </dl>
        </section>
      ) : null}

      {/* 四、字段分歧裁定 */}
      <section className="panel flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-700">
          4. 字段分歧裁定
          <span className="ml-2 text-xs font-normal text-slate-400">待处理 {pendingConflicts.length} 条 / 已解决 {resolvedConflicts.length} 条</span>
        </h2>
        {pendingConflicts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-400">
            没有待裁定的字段分歧
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingConflicts.map((conflict) => (
              <ConflictRow
                key={conflict.id}
                conflict={conflict}
                siteMap={siteMap}
                specimen={specimenMap.get(conflict.specimenId)}
                onChoose={(side) => void choose(conflict, side)}
              />
            ))}
          </ul>
        )}
        {resolvedConflicts.length > 0 ? (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">已解决的分歧（{resolvedConflicts.length}）</summary>
            <ul className="mt-2 space-y-1">
              {resolvedConflicts.map((conflict) => (
                <li key={conflict.id} className="rounded bg-slate-50 px-2 py-1">
                  {conflict.specimenCode} · {conflict.fieldLabel} → 采用「{conflict.chosenSide}」版本
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/* 五、合并台账 */}
      <section className="panel flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-700">5. 合并台账</h2>
        {ledgers.length === 0 ? (
          <p className="text-xs text-slate-400">还没有合并过外业批次</p>
        ) : (
          <ul className="flex flex-col gap-2 text-xs">
            {ledgers.map((ledger) => (
              <li key={ledger.batchId} className="rounded-lg border border-slate-200 p-2">
                <div className="flex flex-wrap items-center gap-3">
                  <b className="font-mono">{ledger.batchId}</b>
                  <span>{ledger.team}</span>
                  <span className="text-slate-400">{new Date(ledger.appliedAt).toLocaleString('zh-CN')}</span>
                  <span>
                    新增 {ledger.insertedCount} / 更新 {ledger.updatedCount} / 重取 {ledger.renumberedCount} / 分歧{' '}
                    {ledger.conflictCount}
                  </span>
                </div>
                {ledger.renumberings.length > 0 ? (
                  <p className="mt-1 text-amber-700">
                    {ledger.renumberings.map((item) => `${item.oldCode}→${item.newCode}`).join('，')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, tone = 'text-slate-700' }: { label: string; value: number; tone?: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      <b className={`text-sm ${tone}`}>{value}</b>
      {label}
    </span>
  )
}

function ConflictRow({
  conflict,
  siteMap,
  specimen,
  onChoose
}: {
  conflict: FieldConflict
  siteMap: Map<string, string>
  specimen?: Specimen
  onChoose: (side: '馆内' | '外业') => void
}): JSX.Element {
  return (
    <li className="rounded-lg border border-rose-200 bg-rose-50/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono font-semibold text-field-700">{conflict.specimenCode}</span>
        <span className="rounded bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">{conflict.fieldLabel}</span>
        {specimen ? <span className="text-slate-400">{specimen.order}/{specimen.family || '—'}</span> : null}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <button
          type="button"
          className="rounded-lg border border-slate-300 bg-white p-2 text-left hover:border-field-400"
          onClick={() => onChoose('馆内')}
        >
          <p className="mb-1 text-[11px] text-slate-400">馆内版本（{conflict.localSource}，当前生效）· 点击采用</p>
          <p className="text-sm text-slate-700">{formatValue(conflict.localValueJson, siteMap)}</p>
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 bg-white p-2 text-left hover:border-field-400"
          onClick={() => onChoose('外业')}
        >
          <p className="mb-1 text-[11px] text-slate-400">外业版本（{conflict.fieldSource}）· 点击采用</p>
          <p className="text-sm text-slate-700">{formatValue(conflict.fieldValueJson, siteMap)}</p>
        </button>
      </div>
    </li>
  )
}
