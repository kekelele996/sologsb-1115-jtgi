import { useMemo, useState } from 'react'
import type { CollectSite, Habitat } from '@/types'
import { HABITATS, findNearbySites } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { siteStore } from '@/stores/siteStore'
import { specimenStore } from '@/stores/specimenStore'
import { formatLatLng, validateLatLng } from '@/utils/codec'
import { uid } from '@/utils/id'

interface SiteForm {
  id: string | null
  code: string
  name: string
  region: string
  longitude: string
  latitude: string
  altitude: string
  habitat: Habitat
  microHabitat: string
  microClimate: string
  dateStart: string
  dateEnd: string
}

const EMPTY_FORM: SiteForm = {
  id: null,
  code: '',
  name: '',
  region: '',
  longitude: '',
  latitude: '',
  altitude: '',
  habitat: '阔叶林',
  microHabitat: '',
  microClimate: '',
  dateStart: new Date().toISOString().slice(0, 10),
  dateEnd: new Date().toISOString().slice(0, 10)
}

/** 采集地管理：坐标格式校验 + 50 米内邻近采集地提示与合并 */
export default function SitesPage(): JSX.Element {
  const sites = usePersistentStore(siteStore, (state) => state.rows)
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const [form, setForm] = useState<SiteForm>(EMPTY_FORM)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const patch = (next: Partial<SiteForm>): void => setForm((prev) => ({ ...prev, ...next }))

  const countOf = (siteId: string): number => specimens.filter((item) => item.siteId === siteId).length

  /** 当前输入坐标 50 米内的既有采集地 */
  const nearby = useMemo(() => {
    const longitude = Number(form.longitude)
    const latitude = Number(form.latitude)
    if (validateLatLng(longitude, latitude) !== null) return []
    if (form.longitude.trim() === '' || form.latitude.trim() === '') return []
    return findNearbySites(sites, latitude, longitude, 50, form.id ?? undefined)
  }, [form.longitude, form.latitude, form.id, sites])

  const submit = async (): Promise<void> => {
    const longitude = Number(form.longitude)
    const latitude = Number(form.latitude)
    if (!form.code.trim() || !form.name.trim()) {
      setError('采集地代码与名称必填')
      return
    }
    const coordError = validateLatLng(longitude, latitude)
    if (coordError) {
      setError(coordError)
      return
    }
    if (sites.some((site) => site.code.toUpperCase() === form.code.trim().toUpperCase() && site.id !== form.id)) {
      setError(`采集地代码「${form.code}」已存在，请换一个（标本编号依赖它）`)
      return
    }
    setError('')
    const row: CollectSite = {
      id: form.id ?? uid('site'),
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      region: form.region.trim(),
      longitude,
      latitude,
      altitude: Number(form.altitude) || 0,
      habitat: form.habitat,
      microHabitat: form.microHabitat.trim(),
      microClimate: form.microClimate.trim(),
      dateStart: form.dateStart,
      dateEnd: form.dateEnd
    }
    await siteStore.getState().save(row)
    setMessage(form.id ? `采集地「${row.name}」已更新` : `采集地「${row.name}」已建立`)
    setForm(EMPTY_FORM)
  }

  const edit = (site: CollectSite): void => {
    setForm({
      id: site.id,
      code: site.code,
      name: site.name,
      region: site.region,
      longitude: String(site.longitude),
      latitude: String(site.latitude),
      altitude: String(site.altitude),
      habitat: site.habitat,
      microHabitat: site.microHabitat,
      microClimate: site.microClimate,
      dateStart: site.dateStart,
      dateEnd: site.dateEnd
    })
    setError('')
  }

  const remove = async (site: CollectSite): Promise<void> => {
    const count = countOf(site.id)
    if (count > 0) {
      setError(`「${site.name}」下仍有 ${count} 份标本，请先合并到其他采集地`)
      return
    }
    await siteStore.getState().remove(site.id)
    setMessage(`采集地「${site.name}」已删除`)
  }

  const mergeInto = async (source: CollectSite, target: CollectSite): Promise<void> => {
    const moved = await siteStore.getState().mergeSite(source.id, target.id)
    await specimenStore.getState().hydrate()
    setMessage(`已把「${source.name}」的 ${moved} 份标本合并到「${target.name}」，并删除原采集地`)
  }

  const nearestOther = (site: CollectSite): { site: CollectSite; distance: number } | null => {
    const list = findNearbySites(sites, site.latitude, site.longitude, 50, site.id)
    return list.length > 0 ? list[0] : null
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="page-title">采集地管理</h1>
        <p className="page-sub">
          坐标输入带经纬度格式校验；同坐标 50 米内的记录会提示合并为同一采集地，合并时标本会自动改挂。
        </p>
      </header>

      <section className="panel grid gap-3 md:grid-cols-3">
        <div>
          <span className="field-label">采集地代码（用于标本编号前缀）</span>
          <input className="field-input" value={form.code} onChange={(e) => patch({ code: e.target.value })} placeholder="如 QLB" />
        </div>
        <div>
          <span className="field-label">采集地名称</span>
          <input className="field-input" value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="如 青龙背斜阔叶林样地" />
        </div>
        <div>
          <span className="field-label">行政区</span>
          <input className="field-input" value={form.region} onChange={(e) => patch({ region: e.target.value })} placeholder="如 黔南州 · 平塘县" />
        </div>
        <div>
          <span className="field-label">经度（-180 ~ 180）</span>
          <input className="field-input" value={form.longitude} onChange={(e) => patch({ longitude: e.target.value })} placeholder="107.2136" />
        </div>
        <div>
          <span className="field-label">纬度（-90 ~ 90）</span>
          <input className="field-input" value={form.latitude} onChange={(e) => patch({ latitude: e.target.value })} placeholder="25.8123" />
        </div>
        <div>
          <span className="field-label">海拔（m）</span>
          <input className="field-input" value={form.altitude} onChange={(e) => patch({ altitude: e.target.value })} placeholder="986" />
        </div>
        <div>
          <span className="field-label">生境类型</span>
          <select className="field-input" value={form.habitat} onChange={(e) => patch({ habitat: e.target.value as Habitat })}>
            {HABITATS.map((habitat) => (
              <option key={habitat} value={habitat}>
                {habitat}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="field-label">采集日期起</span>
          <input type="date" className="field-input" value={form.dateStart} onChange={(e) => patch({ dateStart: e.target.value })} />
        </div>
        <div>
          <span className="field-label">采集日期止</span>
          <input type="date" className="field-input" value={form.dateEnd} onChange={(e) => patch({ dateEnd: e.target.value })} />
        </div>
        <div className="md:col-span-3">
          <span className="field-label">小生境描述</span>
          <input className="field-input" value={form.microHabitat} onChange={(e) => patch({ microHabitat: e.target.value })} placeholder="如 林下腐殖层厚，倒木与落叶堆积" />
        </div>
        <div className="md:col-span-3">
          <span className="field-label">微气候备注</span>
          <input className="field-input" value={form.microClimate} onChange={(e) => patch({ microClimate: e.target.value })} placeholder="如 午后无风，湿度偏高" />
        </div>

        {nearby.length > 0 ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 md:col-span-3">
            <p className="font-medium">坐标 50 米内已有采集地，建议合并为同一采集地：</p>
            <ul className="mt-1 space-y-1">
              {nearby.map((item) => (
                <li key={item.site.id} className="flex items-center justify-between gap-3">
                  <span>
                    {item.site.code} {item.site.name} · 距离约 {item.distance} m · {item.site.habitat}
                  </span>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">已存在，可直接选用</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? <p className="text-sm text-rose-600 md:col-span-3">{error}</p> : null}
        {message ? <p className="text-sm text-field-700 md:col-span-3">{message}</p> : null}

        <div className="flex gap-2 md:col-span-3">
          <button className="btn-primary" type="button" onClick={() => void submit()}>
            {form.id ? '保存修改' : '新增采集地'}
          </button>
          <button className="btn-ghost" type="button" onClick={() => { setForm(EMPTY_FORM); setError('') }}>
            清空表单
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {sites.map((site) => {
          const near = nearestOther(site)
          return (
            <article key={site.id} className="panel flex flex-col gap-2">
              <header className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">
                    <span className="font-mono text-field-600">{site.code}</span> {site.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {site.habitat} · {site.region || '未填行政区'} · {formatLatLng(site.longitude, site.latitude)} ·{' '}
                    {site.altitude} m
                  </p>
                </div>
                <span className="rounded-full bg-field-50 px-2 py-0.5 text-xs text-field-700">
                  采集 {countOf(site.id)} 次
                </span>
              </header>
              <p className="text-xs text-slate-600">小生境：{site.microHabitat || '—'}</p>
              <p className="text-xs text-slate-600">微气候：{site.microClimate || '—'}</p>
              <p className="text-xs text-slate-500">
                采集日期区间：{site.dateStart} ~ {site.dateEnd}
              </p>
              {near ? (
                <p className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  与「{near.site.name}」相距约 {near.distance} m（≤50 m），建议合并
                </p>
              ) : null}
              <footer className="mt-auto flex flex-wrap gap-2 pt-2">
                <button className="btn-ghost" type="button" onClick={() => edit(site)}>
                  编辑
                </button>
                {near ? (
                  <button className="btn-primary" type="button" onClick={() => void mergeInto(site, near.site)}>
                    合并到 {near.site.code}
                  </button>
                ) : null}
                <button className="btn-danger" type="button" onClick={() => void remove(site)}>
                  删除
                </button>
              </footer>
            </article>
          )
        })}
      </section>
    </div>
  )
}
