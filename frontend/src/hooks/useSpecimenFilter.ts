import { useMemo, useState } from 'react'
import type { DetStatus, Specimen } from '@/types'

export interface SpecimenFilterState {
  order: string
  family: string
  status: DetStatus | ''
  siteId: string
  dateFrom: string
  dateTo: string
  keyword: string
}

export const EMPTY_FILTER: SpecimenFilterState = {
  order: '',
  family: '',
  status: '',
  siteId: '',
  dateFrom: '',
  dateTo: '',
  keyword: ''
}

/** 组合筛选条件，返回过滤结果、命中数与可选的目/科候选 */
export function useSpecimenFilter(specimens: Specimen[]): {
  filter: SpecimenFilterState
  setFilter: (patch: Partial<SpecimenFilterState>) => void
  reset: () => void
  filtered: Specimen[]
  hitCount: number
  orders: string[]
  families: string[]
} {
  const [filter, setFilterState] = useState<SpecimenFilterState>(EMPTY_FILTER)

  const setFilter = (patch: Partial<SpecimenFilterState>): void => {
    setFilterState((prev) => ({ ...prev, ...patch }))
  }
  const reset = (): void => setFilterState(EMPTY_FILTER)

  const orders = useMemo(
    () => Array.from(new Set(specimens.map((item) => item.order).filter(Boolean))).sort(),
    [specimens]
  )
  const families = useMemo(
    () => Array.from(new Set(specimens.map((item) => item.family).filter(Boolean))).sort(),
    [specimens]
  )

  const filtered = useMemo(() => {
    const keyword = filter.keyword.trim().toLowerCase()
    return specimens.filter((item) => {
      if (filter.order && item.order !== filter.order) return false
      if (filter.family && item.family !== filter.family) return false
      if (filter.status && item.status !== filter.status) return false
      if (filter.siteId && item.siteId !== filter.siteId) return false
      if (filter.dateFrom && item.collectDate < filter.dateFrom) return false
      if (filter.dateTo && item.collectDate > filter.dateTo) return false
      if (keyword) {
        const haystack = [
          item.code,
          item.order,
          item.family,
          item.genus,
          item.species,
          item.tempName,
          item.collector,
          item.note
        ]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      return true
    })
  }, [specimens, filter])

  return { filter, setFilter, reset, filtered, hitCount: filtered.length, orders, families }
}
