import { create } from 'zustand'
import type { Determination } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'

export interface DeterminationState {
  rows: Determination[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: Determination) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const determinationStore = create<DeterminationState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<Determination>(db.determinations)
    rows.sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<Determination>(db.determinations, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<Determination>(db.determinations, id)
    await get().hydrate()
  }
}))
