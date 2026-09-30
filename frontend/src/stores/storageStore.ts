import { create } from 'zustand'
import type { Storage } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'

export interface StorageState {
  rows: Storage[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: Storage) => Promise<void>
  remove: (id: string) => Promise<void>
  removeBySpecimen: (specimenId: string) => Promise<void>
}

export const storageStore = create<StorageState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<Storage>(db.storages)
    rows.sort((a, b) => (a.cabinet + a.drawer + a.box + a.slot).localeCompare(`${b.cabinet}${b.drawer}${b.box}${b.slot}`))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<Storage>(db.storages, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<Storage>(db.storages, id)
    await get().hydrate()
  },
  removeBySpecimen: async (specimenId) => {
    const targets = get().rows.filter((row) => row.specimenId === specimenId)
    await Promise.all(targets.map((row) => deleteRow<Storage>(db.storages, row.id)))
    await get().hydrate()
  }
}))
