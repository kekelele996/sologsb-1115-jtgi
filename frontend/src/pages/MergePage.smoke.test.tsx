import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import MergePage from '@/pages/MergePage'

/** 冒烟：合并页首屏（各 store 初始空态）能正常渲染，不抛运行时错误 */
describe('MergePage 首屏渲染', () => {
  it('空态 SSR 不抛错并包含关键区块', () => {
    const html = renderToString(
      <MemoryRouter>
        <MergePage />
      </MemoryRouter>
    )
    expect(html).toContain('外业批次合并')
    expect(html).toContain('导入外业批次')
    expect(html).toContain('字段分歧裁定')
    expect(html).toContain('合并台账')
  })
})
