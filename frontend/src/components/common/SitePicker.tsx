import { useMemo, useState } from 'react'
import { distanceMeters, type CollectSite } from '@/types'
import { formatLatLng } from '@/utils/codec'

export interface SitePickerProps {
  sites: CollectSite[]
  value: string
  onChange: (siteId: string) => void
  /** 是否允许选择「不关联采集地」 */
  allowEmpty?: boolean
  label?: string
}

/** 判断输入是否为「经度,纬度」形式的坐标反查 */
function parseCoordinate(input: string): { longitude: number; latitude: number } | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input)
  if (!match) return null
  const longitude = Number(match[1])
  const latitude = Number(match[2])
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null
  return { longitude, latitude }
}

/** 采集地选择器：支持关键字筛选与坐标反查（按距离排序） */
export default function SitePicker({
  sites,
  value,
  onChange,
  allowEmpty = false,
  label = '采集地'
}: SitePickerProps): JSX.Element {
  const [keyword, setKeyword] = useState('')

  const coordinate = parseCoordinate(keyword)

  const options = useMemo(() => {
    if (coordinate) {
      return sites
        .map((site) => ({
          site,
          distance: distanceMeters(coordinate.latitude, coordinate.longitude, site.latitude, site.longitude)
        }))
        .sort((a, b) => a.distance - b.distance)
    }
    const text = keyword.trim().toLowerCase()
    const list = text
      ? sites.filter((site) =>
          [site.name, site.region, site.code, site.habitat, site.microHabitat]
            .join(' ')
            .toLowerCase()
            .includes(text)
        )
      : sites
    return list.map((site) => ({ site, distance: null as number | null }))
  }, [sites, keyword, coordinate])

  const selected = sites.find((site) => site.id === value)

  return (
    <div className="flex flex-col gap-2" data-testid="site-picker">
      <label className="text-xs font-medium text-slate-500">{label}</label>
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-field-500"
        placeholder="输入关键字，或输入坐标反查（如 107.21,25.81）"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <div className="max-h-52 overflow-auto rounded-lg border border-slate-200">
        {allowEmpty ? (
          <button
            type="button"
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 ${
              value === '' ? 'bg-field-50 font-medium text-field-700' : ''
            }`}
            onClick={() => onChange('')}
          >
            <span>不关联采集地</span>
          </button>
        ) : null}
        {options.map(({ site, distance }) => (
          <button
            key={site.id}
            type="button"
            onClick={() => onChange(site.id)}
            className={`flex w-full items-start justify-between gap-2 border-t border-slate-100 px-3 py-2 text-left hover:bg-slate-50 ${
              value === site.id ? 'bg-field-50' : ''
            }`}
          >
            <span>
              <span className="block text-sm text-slate-800">
                <span className="font-mono text-xs text-field-600">{site.code}</span> {site.name}
              </span>
              <span className="block text-xs text-slate-500">
                {site.habitat} · {site.region} · {formatLatLng(site.longitude, site.latitude)}
              </span>
            </span>
            {distance !== null ? (
              <span className="whitespace-nowrap text-xs text-amber-600">约 {distance} m</span>
            ) : null}
          </button>
        ))}
        {options.length === 0 ? <p className="px-3 py-2 text-sm text-slate-400">没有匹配的采集地</p> : null}
      </div>
      <p className="text-xs text-slate-500">
        当前选择：{selected ? `${selected.code} ${selected.name}（${selected.habitat}）` : '未选择'}
      </p>
    </div>
  )
}
