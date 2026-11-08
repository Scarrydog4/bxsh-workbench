import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { VirtualTableBody } from '@/client/VirtualTableBody'

function render(count: number, enabled = true) {
  return renderToStaticMarkup(createElement('table', null, createElement(VirtualTableBody<{id: string}>, {
    rows: Array.from({ length: count }, (_, i) => ({ id: `order-${i}` })),
    scrollRef: createRef<HTMLDivElement>(), rowHeight: 40, enabled, colSpan: 3,
    children: (row, index, measure) => createElement('tr', { key: row.id, 'data-index': index, ref: measure }, createElement('td', null, row.id)),
  })))
}

it('一万单只挂载视口及预留行，剩余订单用占位保留滚动范围', () => {
  const html = render(10_000)
  const rendered = (html.match(/data-index=/g) ?? []).length
  expect(rendered).toBeGreaterThan(10)
  expect(rendered).toBeLessThan(60)
  expect(html).toContain('order-0')
  expect(html).toContain('aria-hidden="true"')
  expect(html).not.toContain('order-9999')
})

it('短列表和空结果正常显示，不生成多余占位', () => {
  const html = render(3, false)
  expect(html.match(/data-index=/g)).toHaveLength(3)
  expect(html).toContain('order-2')
  expect(html).not.toContain('aria-hidden')
  expect(render(0)).toBe('<table><tbody></tbody></table>')
})
