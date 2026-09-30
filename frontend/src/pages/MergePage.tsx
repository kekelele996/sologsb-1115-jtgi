import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type {
  CollectMethod,
  Determination,
  Sex,
  Specimen,
  Stage,
  Storage
} from '@/types'
import { COLLECT_METHODS, ORDERS, SEXES, STAGES } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { specimenStore } from '@/stores/specimenStore'
import { siteStore } from '@/stores/siteStore'
import { determinationStore } from '@/stores/determinationStore'
import { storageStore } from '@/stores/storageStore'
import type { FieldBatch, MergeItemResult, MergeReport, MuseumSnapshot } from '@/utils/merge'
import {
  applyMerge,
  buildFieldBatch,
  getMergedBatch,
  parseFieldBatch,
  planMerge
} from '@/utils/merge'
import { parseSpecimenCode } from '@/utils/codec'
import { downloadJson } from '@/utils/export'
import { uid } from '@/utils/id'

type Choice = 'museum' | 'field'

interface DraftForm {
  id: string | null
  code: string
  order: string
  family: string
  genus: string
  species: string
  tempName: string
  siteId: string
  collectDate: string
  collector: string
  sex: Sex
  stage: Stage
  bodyLength: string
  method: CollectMethod
  quantity: string
  note: string
}

const newDraftForm = (): DraftForm => ({
  id: null,
  code: '',
  order: '鞘翅目',
  family: '',
  genus: '',
  species: '',
  tempName: '',
  siteId: '',
  collectDate: new Date().toISOString().slice(0, 10),
  collector: '',
  sex: '未知',
  stage: '成虫',
  bodyLength: '',
  method: '扫网',
  quantity: '1',
  note: ''
})

const OUTCOME_LABEL: Record<MergeItemResult['outcome'], string> = {
  inserted: '新标本入库',
  renumbered: '撞号重新取号',
  protected: '馆方已保护',
  conflict: '字段冲突待选',
  identical: '与馆内一致'
}

const OUTCOME_STYLE: Record<MergeItemResult['outcome'], string> = {
  inserted: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  renumbered: 'bg-sky-50 text-sky-700 border-sky-300',
  protected: 'bg-amber-50 text-amber-700 border-amber-300',
  conflict: 'bg-rose-50 text-rose-700 border-rose-300',
  identical: 'bg-slate-100 text-slate-600 border-slate-300'
}

/** 外业批次：离线登记标本 → 导出 JSON → 回站导入合并，撞号重新取号、馆方保护、字段冲突编目员选版 */
export default function MergePage(): JSX.Element {
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const sites = usePersistentStore(siteStore, (state) => state.rows)
  const determinations = usePersistentStore(determinationStore, (state) => state.rows)
  const storages = usePersistentStore(storageStore, (state) => state.rows)

  const [tab, setTab] = useState<'export' | 'import'>('export')

  // —— 登记与导出 ——
  const [team, setTeam] = useState('')
  const [draft, setDraft] = useState<{ specimens: Specimen[]; determinations: Determination[]; storages: Storage[] }>({
    specimens: [],
    determinations: [],
    storages: []
  })
  const [form, setForm] = useState<DraftForm>(newDraftForm())
  const [formError, setFormError] = useState('')
  const [exportMsg, setExportMsg] = useState('')

  // —— 导入与合并 ——
  const [importBatch, setImportBatch] = useState<FieldBatch | null>(null)
  const [items, setItems] = useState<MergeItemResult[]>([])
  const [choices, setChoices] = useState<Record<string, Record<string, Choice>>>({})
  const [report, setReport] = useState<MergeReport | null>(null)
  const [alreadyMerged, setAlreadyMerged] = useState<MergeReport | null>(null)
  const [importError, setImportError] = useState('')
  const [mergeError, setMergeError] = useState('')
  const [merging, setMerging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const museum = useMemo<MuseumSnapshot>(
    () => ({ specimens, determinations, storages }),
    [specimens, determinations, storages]
  )

  const siteName = (siteId: string): string => sites.find((s) => s.id === siteId)?.name ?? '未关联采集地'

  const patchForm = (patch: Partial<DraftForm>): void => setForm((prev) => ({ ...prev, ...patch }))

  /** 从馆内数据生成外业快照（含标本、鉴定记录、保藏位置） */
  const snapshot = (): void => {
    setDraft({
      specimens: museum.specimens.map((s) => ({ ...s })),
      determinations: museum.determinations.map((d) => ({ ...d })),
      storages: museum.storages.map((s) => ({ ...s }))
    })
    setExportMsg(`已从馆内数据生成 ${museum.specimens.length} 条标本的快照，可在此基础上离线修改或新增外业标本`)
  }

  /** 新增 / 更新一条外业标本（手工排号，允许与馆内编号冲突） */
  const saveDraftSpecimen = (): void => {
    if (!form.code.trim()) {
      setFormError('请填写标本编号（采集地代码-年份-流水号）')
      return
    }
    if (!parseSpecimenCode(form.code.trim())) {
      setFormError('编号格式应为「采集地代码-年份-流水号」，如 QLB-2026-0005')
      return
    }
    if (!form.order.trim()) {
      setFormError('请填写目')
      return
    }
    setFormError('')
    const row: Specimen = {
      id: form.id ?? uid('sp'),
      code: form.code.trim().toUpperCase(),
      order: form.order.trim(),
      family: form.family.trim(),
      genus: form.genus.trim(),
      species: form.species.trim(),
      tempName: form.tempName.trim(),
      siteId: form.siteId,
      collectDate: form.collectDate,
      collector: form.collector.trim(),
      sex: form.sex,
      stage: form.stage,
      bodyLength: Number(form.bodyLength) || 0,
      method: form.method,
      quantity: Number(form.quantity) || 1,
      status: '待鉴定',
      determiner: '',
      note: form.note.trim()
    }
    setDraft((prev) => {
      const exists = prev.specimens.some((s) => s.id === row.id)
      return {
        ...prev,
        specimens: exists ? prev.specimens.map((s) => (s.id === row.id ? row : s)) : [...prev.specimens, row]
      }
    })
    setForm(newDraftForm())
    setExportMsg(form.id ? `已更新外业标本 ${row.code}` : `已新增外业标本 ${row.code}（离线排号，合并时查重）`)
  }

  const editDraft = (s: Specimen): void => {
    setForm({
      id: s.id,
      code: s.code,
      order: s.order,
      family: s.family,
      genus: s.genus,
      species: s.species,
      tempName: s.tempName,
      siteId: s.siteId,
      collectDate: s.collectDate,
      collector: s.collector,
      sex: s.sex,
      stage: s.stage,
      bodyLength: s.bodyLength ? String(s.bodyLength) : '',
      method: s.method,
      quantity: String(s.quantity),
      note: s.note
    })
    setFormError('')
  }

  const removeDraft = (id: string): void => {
    setDraft((prev) => ({
      specimens: prev.specimens.filter((s) => s.id !== id),
      determinations: prev.determinations.filter((d) => d.specimenId !== id),
      storages: prev.storages.filter((s) => s.specimenId !== id)
    }))
    if (form.id === id) setForm(newDraftForm())
  }

  /** 导出外业批次 JSON */
  const exportJson = (): void => {
    if (draft.specimens.length === 0) {
      setExportMsg('外业批次为空，请先生成快照或新增外业标本')
      return
    }
    const batch = buildFieldBatch(team, draft, '外业离线登记，回站合并')
    downloadJson(`外业批次-${batch.team}-${batch.batchId}.json`, batch)
    setExportMsg(`已导出 ${batch.team} 的外业批次（${batch.specimens.length} 条标本），回站后在「导入与合并」载入`)
  }

  /** 读取导入的批次 JSON 并规划合并 */
  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError('')
    setMergeError('')
    setReport(null)
    setAlreadyMerged(null)
    try {
      const raw = JSON.parse(await file.text())
      const parsed = parseFieldBatch(raw)
      if (!parsed.ok) {
        setImportError(`批次文件无效：${parsed.error}`)
        return
      }
      const batch = parsed.batch
      const merged = await getMergedBatch(batch.batchId)
      if (merged) {
        setAlreadyMerged(merged)
        setImportBatch(batch)
        setItems([])
        return
      }
      const plan = planMerge(batch, museum)
      setImportBatch(batch)
      setItems(plan)
      const initChoices: Record<string, Record<string, Choice>> = {}
      plan.forEach((item) => {
        if (item.conflicts) {
          const c: Record<string, Choice> = {}
          item.conflicts.forEach((f) => (c[f.field] = 'museum'))
          initChoices[item.key] = c
        }
      })
      setChoices(initChoices)
    } catch (err) {
      setImportError(`读取失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const setChoice = (key: string, field: string, choice: Choice): void => {
    setChoices((prev) => ({ ...prev, [key]: { ...prev[key], [field]: choice } }))
  }

  const setItemChoiceAll = (key: string, choice: Choice): void => {
    setChoices((prev) => {
      const next = { ...prev }
      const item = items.find((i) => i.key === key)
      if (item?.conflicts) {
        const c: Record<string, Choice> = {}
        item.conflicts.forEach((f) => (c[f.field] = choice))
        next[key] = c
      }
      return next
    })
  }

  /** 应用合并（事务性，失败回滚，可重试） */
  const confirmMerge = async (): Promise<void> => {
    if (!importBatch) return
    setMerging(true)
    setMergeError('')
    try {
      const applied = await applyMerge(importBatch, items, choices)
      await Promise.all([
        specimenStore.getState().hydrate(),
        determinationStore.getState().hydrate(),
        storageStore.getState().hydrate()
      ])
      setReport(applied)
      setItems([])
      setImportBatch(null)
    } catch (err) {
      setMergeError(`整批合并失败，已回滚，可重试：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setMerging(false)
    }
  }

  const counts = useMemo(() => {
    const c = { inserted: 0, renumbered: 0, protected: 0, conflict: 0, identical: 0 }
    items.forEach((i) => {
      c[i.outcome] += 1
    })
    return c
  }, [items])

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">外业批次合并</h1>
        <p className="page-sub">
          林区无信号时离线登记标本，回站后整批合并进馆内编目。撞号标本重新取号，鉴定记录与保藏柜位随新编号迁走；
          馆内已鉴定或入柜的内容不被盖掉；两边都改过的字段保留两版标来源，由编目员挑一版。整批合并在一个事务内完成，失败回滚、重试不产生重复标本。
        </p>
      </header>

      <div className="flex gap-2">
        <button className={tab === 'export' ? 'btn-primary' : 'btn-ghost'} type="button" onClick={() => setTab('export')}>
          登记与导出
        </button>
        <button className={tab === 'import' ? 'btn-primary' : 'btn-ghost'} type="button" onClick={() => setTab('import')}>
          导入与合并
        </button>
      </div>

      {tab === 'export' ? (
        <>
          <section className="panel flex flex-wrap items-end gap-3">
            <div>
              <span className="field-label">外业分队名称</span>
              <input className="field-input w-48" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="如 二队" />
            </div>
            <button className="btn-ghost" type="button" onClick={snapshot}>
              从馆内数据生成快照
            </button>
            <button className="btn-primary" type="button" onClick={exportJson}>
              导出外业批次 JSON（{draft.specimens.length} 条）
            </button>
            {exportMsg ? <p className="w-full text-sm text-field-700">{exportMsg}</p> : null}
          </section>

          <section className="panel">
            <h2 className="text-sm font-semibold text-slate-700">
              {form.id ? '编辑外业标本' : '新增外业标本'}（手工排号，允许与馆内编号冲突）
            </h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <span className="field-label">标本编号（采集地代码-年份-流水号）</span>
                <input className="field-input font-mono" value={form.code} onChange={(e) => patchForm({ code: e.target.value })} placeholder="如 QLB-2026-0005" />
              </div>
              <div>
                <span className="field-label">采集地</span>
                <select className="field-input" value={form.siteId} onChange={(e) => patchForm({ siteId: e.target.value })}>
                  <option value="">不关联采集地</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="field-label">采集日期</span>
                <input type="date" className="field-input" value={form.collectDate} onChange={(e) => patchForm({ collectDate: e.target.value })} />
              </div>
              <div>
                <span className="field-label">目</span>
                <select className="field-input" value={form.order} onChange={(e) => patchForm({ order: e.target.value })}>
                  {ORDERS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="field-label">科</span>
                <input className="field-input" value={form.family} onChange={(e) => patchForm({ family: e.target.value })} />
              </div>
              <div>
                <span className="field-label">属</span>
                <input className="field-input" value={form.genus} onChange={(e) => patchForm({ genus: e.target.value })} />
              </div>
              <div>
                <span className="field-label">种</span>
                <input className="field-input" value={form.species} onChange={(e) => patchForm({ species: e.target.value })} />
              </div>
              <div>
                <span className="field-label">暂定名</span>
                <input className="field-input" value={form.tempName} onChange={(e) => patchForm({ tempName: e.target.value })} />
              </div>
              <div>
                <span className="field-label">采集人</span>
                <input className="field-input" value={form.collector} onChange={(e) => patchForm({ collector: e.target.value })} />
              </div>
              <div>
                <span className="field-label">性别</span>
                <select className="field-input" value={form.sex} onChange={(e) => patchForm({ sex: e.target.value as Sex })}>
                  {SEXES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="field-label">虫态</span>
                <select className="field-input" value={form.stage} onChange={(e) => patchForm({ stage: e.target.value as Stage })}>
                  {STAGES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="field-label">体长(mm)</span>
                <input className="field-input" value={form.bodyLength} onChange={(e) => patchForm({ bodyLength: e.target.value })} />
              </div>
              <div>
                <span className="field-label">采集方式</span>
                <select className="field-input" value={form.method} onChange={(e) => patchForm({ method: e.target.value as CollectMethod })}>
                  {COLLECT_METHODS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="field-label">数量</span>
                <input className="field-input" value={form.quantity} onChange={(e) => patchForm({ quantity: e.target.value })} />
              </div>
              <div className="md:col-span-3">
                <span className="field-label">备注</span>
                <input className="field-input" value={form.note} onChange={(e) => patchForm({ note: e.target.value })} />
              </div>
            </div>
            {formError ? <p className="mt-3 text-sm text-rose-600">{formError}</p> : null}
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" type="button" onClick={saveDraftSpecimen}>
                {form.id ? '保存修改' : '加入外业批次'}
              </button>
              {form.id ? (
                <button className="btn-ghost" type="button" onClick={() => setForm(newDraftForm())}>
                  取消编辑
                </button>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <h2 className="text-sm font-semibold text-slate-700">外业批次标本（{draft.specimens.length}）</h2>
            {draft.specimens.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">
                暂无外业标本。可「从馆内数据生成快照」后离线修改，或用上方表单新增手工排号的外业标本。
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs text-slate-500">
                      <th className="border border-slate-200 px-2 py-1">编号</th>
                      <th className="border border-slate-200 px-2 py-1">分类</th>
                      <th className="border border-slate-200 px-2 py-1">采集地</th>
                      <th className="border border-slate-200 px-2 py-1">采集日期</th>
                      <th className="border border-slate-200 px-2 py-1">附带鉴定/入柜</th>
                      <th className="border border-slate-200 px-2 py-1">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.specimens.map((s) => (
                      <tr key={s.id}>
                        <td className="border border-slate-200 px-2 py-1 font-mono text-xs text-field-700">{s.code}</td>
                        <td className="border border-slate-200 px-2 py-1">
                          {s.order}
                          {s.family ? ` · ${s.family}` : ''} · {s.tempName || '未定名'}
                        </td>
                        <td className="border border-slate-200 px-2 py-1 text-xs">{siteName(s.siteId)}</td>
                        <td className="border border-slate-200 px-2 py-1 text-xs">{s.collectDate}</td>
                        <td className="border border-slate-200 px-2 py-1 text-xs">
                          {draft.determinations.filter((d) => d.specimenId === s.id).length} 鉴定 /{' '}
                          {draft.storages.filter((x) => x.specimenId === s.id).length} 入柜
                        </td>
                        <td className="border border-slate-200 px-2 py-1">
                          <button className="btn-ghost" type="button" onClick={() => editDraft(s)}>
                            编辑
                          </button>
                          <button className="btn-danger" type="button" onClick={() => removeDraft(s.id)}>
                            移除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="panel flex flex-wrap items-end gap-3">
            <div>
              <span className="field-label">外业批次 JSON 文件</span>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="block w-72 text-sm text-slate-600"
                onChange={(e) => void onFile(e)}
              />
            </div>
            {importBatch ? (
              <div className="text-xs text-slate-500">
                批次：{importBatch.team} · 编号 {importBatch.batchId} · 外业标本 {importBatch.specimens.length} 条 ·
                鉴定 {importBatch.determinations.length} · 入柜 {importBatch.storages.length}
              </div>
            ) : null}
            {importError ? <p className="w-full text-sm text-rose-600">{importError}</p> : null}
          </section>

          {alreadyMerged ? (
            <section className="panel border-field-500 bg-field-50">
              <h2 className="text-sm font-semibold text-field-700">该批次已于 {new Date(alreadyMerged.mergedAt).toLocaleString()} 合并，无需重复导入</h2>
              <p className="mt-1 text-xs text-field-700">
                幂等保护：同一批再送一次不会多出重复标本。本次合并入库 {alreadyMerged.inserted}、撞号重新取号 {alreadyMerged.renumbered}、
                馆方保护 {alreadyMerged.protectedCount}、字段冲突 {alreadyMerged.conflictCount}、与馆内一致 {alreadyMerged.identicalCount}。
              </p>
            </section>
          ) : null}

          {items.length > 0 ? (
            <>
              <section className="panel flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold text-slate-700">合并预览</h2>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700">新标本入库 {counts.inserted}</span>
                  <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-700">撞号重新取号 {counts.renumbered}</span>
                  <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700">馆方已保护 {counts.protected}</span>
                  <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-rose-700">字段冲突 {counts.conflict}</span>
                  <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-600">与馆内一致 {counts.identical}</span>
                </div>
                <div className="ml-auto flex gap-2">
                  <button className="btn-primary" type="button" disabled={merging} onClick={() => void confirmMerge()}>
                    {merging ? '合并中…' : '确认合并（整批事务）'}
                  </button>
                  <button
                    className="btn-ghost"
                    type="button"
                    disabled={merging}
                    onClick={() => {
                      setItems([])
                      setImportBatch(null)
                      setMergeError('')
                    }}
                  >
                    取消
                  </button>
                </div>
                {mergeError ? <p className="w-full text-sm text-rose-600">{mergeError}</p> : null}
              </section>

              <section className="flex flex-col gap-3">
                {items.map((item) => (
                  <MergeItemCard
                    key={item.key}
                    item={item}
                    choices={choices[item.key] ?? {}}
                    siteName={siteName}
                    onChoice={(field, choice) => setChoice(item.key, field, choice)}
                    onChoiceAll={(choice) => setItemChoiceAll(item.key, choice)}
                  />
                ))}
              </section>
            </>
          ) : null}

          {report ? (
            <section className="panel border-field-500 bg-field-50">
              <h2 className="text-sm font-semibold text-field-700">合并完成（{new Date(report.mergedAt).toLocaleString()}）</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-field-700">
                <li>新标本入库 {report.inserted} 条</li>
                <li>撞号重新取号 {report.renumbered} 条（外业编号已改为馆内新编号）</li>
                <li>馆方已保护 {report.protectedCount} 条（馆内已鉴定/入柜，外业版本未盖掉）</li>
                <li>字段冲突 {report.conflictCount} 条（已按编目员选择写入馆内版本）</li>
                <li>与馆内一致 {report.identicalCount} 条（无变化）</li>
                <li>随新标本迁入鉴定记录 {report.carriedDet} 条、保藏位置 {report.carriedStorage} 条</li>
              </ul>
              <p className="mt-2 text-xs text-field-700">
                批次 {report.batchId} 已存档，重复导入将被幂等拦截，不会产生重复标本。
              </p>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

interface MergeItemCardProps {
  item: MergeItemResult
  choices: Record<string, Choice>
  siteName: (siteId: string) => string
  onChoice: (field: string, choice: Choice) => void
  onChoiceAll: (choice: Choice) => void
}

function MergeItemCard({ item, choices, siteName, onChoice, onChoiceAll }: MergeItemCardProps): JSX.Element {
  const f = item.fieldSpecimen
  const m = item.museumSpecimen
  return (
    <article className="panel flex flex-col gap-2">
      <header className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-xs ${OUTCOME_STYLE[item.outcome]}`}>
          {OUTCOME_LABEL[item.outcome]}
        </span>
        <span className="font-mono text-sm font-semibold text-field-700">
          {f.code}
          {item.newCode ? <span className="text-slate-400"> → </span> : null}
          {item.newCode ? <span className="text-sky-700">{item.newCode}</span> : null}
        </span>
        {m && m.id !== f.id ? <span className="font-mono text-xs text-slate-400">馆内原编号 {m.code}</span> : null}
        <span className="text-xs text-slate-500">
          {f.order}
          {f.family ? ` · ${f.family}` : ''} · {f.tempName || '未定名'} · {siteName(f.siteId)}
        </span>
      </header>

      {item.outcome === 'renumbered' ? (
        <p className="text-xs text-sky-700">
          外业编号 {f.code} 与馆内标本 {m?.code} 撞号（不同标本），已重新取号为 <b>{item.newCode}</b> 入库，
          采集信息保留
          {item.attachedDet > 0 || item.attachedStorage > 0
            ? `，附带的 ${item.attachedDet} 条鉴定记录、${item.attachedStorage} 个保藏柜位随新编号迁走`
            : ''}
          。
          {item.museumProtected ? '馆内原标本已鉴定/入柜，保留不动。' : ''}
        </p>
      ) : null}

      {item.outcome === 'protected' ? (
        <p className="text-xs text-amber-700">
          馆内标本 {m?.code} 已有鉴定记录或保藏位置，属馆方权威内容，外业版本未盖掉、未合并。
          {item.attachedDet > 0 || item.attachedStorage > 0
            ? ` 外业附带的 ${item.attachedDet} 条鉴定记录、${item.attachedStorage} 个柜位以馆内为准，未并入。`
            : ''}
        </p>
      ) : null}

      {item.outcome === 'inserted' ? (
        <p className="text-xs text-emerald-700">
          新标本入库，编号 {f.code} 未与馆内冲突。
          {item.attachedDet > 0 || item.attachedStorage > 0
            ? ` 附带的 ${item.attachedDet} 条鉴定记录、${item.attachedStorage} 个保藏柜位已随标本迁入。`
            : ''}
        </p>
      ) : null}

      {item.outcome === 'identical' ? (
        <p className="text-xs text-slate-500">外业版本与馆内标本 {m?.code} 完全一致，无变化。</p>
      ) : null}

      {item.outcome === 'conflict' && item.conflicts ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              外业版本与馆内标本 {m?.code} 在以下字段不一致，请编目员挑选一版：
            </span>
            <button className="btn-ghost px-2 py-0.5 text-xs" type="button" onClick={() => onChoiceAll('museum')}>
              整版采用馆方
            </button>
            <button className="btn-ghost px-2 py-0.5 text-xs" type="button" onClick={() => onChoiceAll('field')}>
              整版采用外业
            </button>
          </div>
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="border border-slate-200 px-2 py-1">字段</th>
                <th className="border border-slate-200 px-2 py-1">馆方版本</th>
                <th className="border border-slate-200 px-2 py-1">外业版本</th>
              </tr>
            </thead>
            <tbody>
              {item.conflicts.map((c) => (
                <tr key={c.field}>
                  <td className="border border-slate-200 px-2 py-1 text-xs text-slate-500">{c.label}</td>
                  <td className="border border-slate-200 px-2 py-1">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`${item.key}-${c.field}`}
                        checked={(choices[c.field] ?? 'museum') === 'museum'}
                        onChange={() => onChoice(c.field, 'museum')}
                      />
                      <span className={choices[c.field] === 'field' ? 'text-slate-400' : 'text-field-700'}>
                        {c.museumValue}
                      </span>
                    </label>
                  </td>
                  <td className="border border-slate-200 px-2 py-1">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`${item.key}-${c.field}`}
                        checked={choices[c.field] === 'field'}
                        onChange={() => onChoice(c.field, 'field')}
                      />
                      <span className={choices[c.field] === 'field' ? 'text-sky-700' : 'text-slate-600'}>
                        {c.fieldValue}
                      </span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  )
}
