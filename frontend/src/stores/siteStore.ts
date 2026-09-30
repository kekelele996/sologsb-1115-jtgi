import { create } from 'zustand'
import type { CollectSite, Specimen } from '@/types'
import { db, deleteRow, loadAll, putRow, putRows } from '@/hooks/usePersistentStore'

export interface SiteState {
  rows: CollectSite[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: CollectSite) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 合并采集地：把 sourceId 下的标本全部改挂到 targetId，然后删除 source 记录 */
  mergeSite: (sourceId: string, targetId: string) => Promise<number>
}

export const siteStore = create<SiteState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<CollectSite>(db.sites)
    rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<CollectSite>(db.sites, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<CollectSite>(db.sites, id)
    await get().hydrate()
  },
  mergeSite: async (sourceId, targetId) => {
    const specimens = await loadAll<Specimen>(db.specimens)
    const moved = specimens.filter((item) => item.siteId === sourceId).map((item) => ({ ...item, siteId: targetId }))
    await putRows<Specimen>(db.specimens, moved)
    await deleteRow<CollectSite>(db.sites, sourceId)
    await get().hydrate()
    return moved.length
  }
}))
