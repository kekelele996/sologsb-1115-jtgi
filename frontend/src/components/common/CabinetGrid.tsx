import type { ReactNode } from 'react'
import type { Storage } from '@/types'
import { encodeSlot } from '@/utils/codec'

export interface CabinetGridProps {
  cabinet: string
  drawers: number
  boxes: number
  slots: number
  storages: Storage[]
  /** 每个标本编号，用于显示占用 */
  codeOf: (specimenId: string) => string
  /** 当前拖拽中的标本编号 */
  draggingCode: string | null
  /** 点击或拖放到某个插位 */
  onDropSlot: (payload: { cabinet: string; drawer: number; box: number; slot: number }) => void
  onPickStorage?: (storage: Storage) => void
  footer?: ReactNode
}

/** 柜位网格：柜 → 抽屉 → 盒 → 插位，插位作为拖放目标 */
export default function CabinetGrid({
  cabinet,
  drawers,
  boxes,
  slots,
  storages,
  codeOf,
  draggingCode,
  onDropSlot,
  onPickStorage,
  footer
}: CabinetGridProps): JSX.Element {
  const drawerList = Array.from({ length: drawers }, (_, index) => index + 1)
  const boxList = Array.from({ length: boxes }, (_, index) => index + 1)
  const slotList = Array.from({ length: slots }, (_, index) => index + 1)

  const slotMap = new Map<string, Storage>()
  storages
    .filter((item) => item.cabinet.toUpperCase() === cabinet.toUpperCase())
    .forEach((item) => slotMap.set(encodeSlot(item.cabinet, item.drawer, item.box, item.slot), item))

  return (
    <div className="flex flex-col gap-4" data-testid="cabinet-grid">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          标本柜 {cabinet} · {drawers} 抽屉 × {boxes} 盒 × {slots} 位
        </h3>
        <span className="text-xs text-slate-500">
          {draggingCode ? `正在拖动 ${draggingCode}，点击任一空插位即可放置` : '从右侧未入柜列表拖动标本到插位'}
        </span>
      </div>
      {drawerList.map((drawer) => (
        <section key={drawer} className="rounded-xl border border-slate-200 bg-white p-3">
          <header className="mb-2 text-xs font-medium text-slate-500">抽屉 D{drawer}</header>
          <div className="flex flex-col gap-3">
            {boxList.map((box) => (
              <div key={box} className="flex flex-wrap items-center gap-2">
                <span className="w-16 text-xs text-slate-500">盒 B{String(box).padStart(2, '0')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {slotList.map((slot) => {
                    const storage = slotMap.get(encodeSlot(cabinet, drawer, box, slot))
                    const code = storage ? codeOf(storage.specimenId) : ''
                    return (
                      <button
                        key={slot}
                        type="button"
                        title={storage ? `占用：${code}` : '空位'}
                        onClick={() =>
                          storage && onPickStorage ? onPickStorage(storage) : onDropSlot({ cabinet, drawer, box, slot })
                        }
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault()
                          onDropSlot({ cabinet, drawer, box, slot })
                        }}
                        className={`h-12 w-16 rounded-md border text-[11px] leading-tight transition ${
                          storage
                            ? 'border-field-500 bg-field-50 text-field-700 hover:bg-field-100'
                            : 'border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-field-500 hover:text-field-600'
                        }`}
                      >
                        <span className="block font-mono">{storage ? code : `S${String(slot).padStart(2, '0')}`}</span>
                        <span className="block">{storage ? '占用' : '空位'}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {footer}
    </div>
  )
}
