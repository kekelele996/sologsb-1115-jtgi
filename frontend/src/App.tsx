import { NavLink, Outlet } from 'react-router-dom'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { specimenStore } from '@/stores/specimenStore'
import { siteStore } from '@/stores/siteStore'
import { storageStore } from '@/stores/storageStore'
import { determinationStore } from '@/stores/determinationStore'
import { mergeStore } from '@/stores/mergeStore'

const NAV = [
  { to: '/specimens', label: '标本清单', hint: '筛选 / 批量推进' },
  { to: '/collect', label: '采集登记', hint: '同批次多份录入' },
  { to: '/sites', label: '采集地管理', hint: '坐标校验 / 合并' },
  { to: '/determination', label: '鉴定工作流', hint: '待鉴定队列' },
  { to: '/storage', label: '保藏柜位图', hint: '柜-屉-盒-位' },
  { to: '/merge', label: '外业批次合并', hint: '离线批次 / 撞号重取' }
]

/** 应用外壳：左侧导航 + 顶部状态条 + 路由出口 */
export default function AppLayout(): JSX.Element {
  const specimens = usePersistentStore(specimenStore, (state) => state.rows)
  const sites = usePersistentStore(siteStore, (state) => state.rows)
  const storages = usePersistentStore(storageStore, (state) => state.rows)
  const determinations = usePersistentStore(determinationStore, (state) => state.rows)
  const pendingConflicts = usePersistentStore(
    mergeStore,
    (state) => state.conflicts.filter((item) => item.status === '待处理').length
  )

  const pending = specimens.filter((item) => item.status === '待鉴定').length

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-field-700 px-3 py-5 text-field-50">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-field-100 text-lg font-bold text-field-700">
            ⌘
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight">昆虫标本采集记录台</p>
            <p className="truncate text-[10px] text-field-100/80">Insect Specimen Log</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm transition ${
                  isActive ? 'bg-field-600 text-white' : 'text-field-100 hover:bg-field-600/60'
                }`
              }
            >
              <span className="flex items-center justify-between">
                {item.label}
                {item.to === '/merge' && pendingConflicts > 0 ? (
                  <span
                    className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                    data-testid="merge-badge"
                  >
                    {pendingConflicts}
                  </span>
                ) : null}
              </span>
              <span className="block text-[11px] text-field-100/70">{item.hint}</span>
            </NavLink>
          ))}
        </nav>
        <dl className="mt-auto space-y-1 rounded-xl bg-field-600/50 p-3 text-xs">
          <div className="flex justify-between">
            <dt>标本</dt>
            <dd className="font-semibold">{specimens.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt>待鉴定</dt>
            <dd className="font-semibold">{pending}</dd>
          </div>
          <div className="flex justify-between">
            <dt>采集地</dt>
            <dd className="font-semibold">{sites.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt>已入柜</dt>
            <dd className="font-semibold">{storages.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt>鉴定记录</dt>
            <dd className="font-semibold">{determinations.length}</dd>
          </div>
          {pendingConflicts > 0 ? (
            <div className="flex justify-between text-rose-200">
              <dt>待裁定字段分歧</dt>
              <dd className="font-semibold">{pendingConflicts}</dd>
            </div>
          ) : null}
          <p className="pt-1 text-[11px] leading-relaxed text-field-100/70">
            数据保存在浏览器 IndexedDB，无需后端服务
          </p>
        </dl>
      </aside>
      <main className="flex-1 bg-[#f5f8f6]">
        <div className="mx-auto max-w-[1180px] px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
