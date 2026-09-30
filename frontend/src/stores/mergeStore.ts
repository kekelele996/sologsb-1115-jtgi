import { create } from 'zustand'
import type { FieldConflict, MergeLedger } from '@/types'
import { db, loadAll } from '@/hooks/usePersistentStore'

export interface MergeState {
  conflicts: FieldConflict[]
  ledgers: MergeLedger[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 待处理字段分歧数量（导航角标用） */
  pendingCount: () => number
}

/** 外业合并台账与字段分歧的内存镜像，写入由 utils/merge 的事务直接落库后统一 hydrate */
export const mergeStore = create<MergeState>((set, get) => ({
  conflicts: [],
  ledgers: [],
  loaded: false,
  hydrate: async () => {
    const [conflicts, ledgers] = await Promise.all([
      loadAll<FieldConflict>(db.mergeConflicts),
      loadAll<MergeLedger>(db.mergeLedgers)
    ])
    conflicts.sort((a, b) => {
      if (a.status !== b.status) return a.status === '待处理' ? -1 : 1
      return a.specimenCode.localeCompare(b.specimenCode, 'zh-Hans-CN')
    })
    ledgers.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
    set({ conflicts, ledgers, loaded: true })
  },
  pendingCount: () => get().conflicts.filter((item) => item.status === '待处理').length
}))
