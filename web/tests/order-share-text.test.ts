import { expect, it } from 'vitest'
import { orderShareName, orderShareText } from '@/shared/order-share-text'

it('unpaid and paid copy uses actual receipt values without inventing a deposit', () => {
  const order = { title: 'aj26110401 网络安全', total: 800, paid: 0 }
  expect(orderShareText(order)).toBe('待定 aj26110401 网络安全 全款800 定金未付')
  expect(orderShareText({ ...order, paid: 400 })).toBe('aj26110401 网络安全 全款800 定金400已付')
  expect(orderShareText({ ...order, paid: 800 })).toBe('aj26110401 网络安全 全款800 已付清')
  expect(orderShareText({ ...order, paid: 800.01 })).toBe('aj26110401 网络安全 全款800 已付800.01 多付0.01')
})

it('copies the existing title and type without duplicating manual numbers or category', () => {
  expect(orderShareName({ title: '网络安全', number: 'aj26110401', pending: true })).toBe('待定 aj26110401 网络安全')
  expect(orderShareName({ title: 'XY2026110402 旅游管理', number: 'aj26110401', type: '论文' })).toBe('XY2026110402 旅游管理 论文')
  expect(orderShareName({ title: 'aj26110401 网络安全论文', type: '论文' })).toBe('aj26110401 网络安全论文')
})

it('missing payment visibility is not reported as unpaid and cost mode is not customer total', () => {
  expect(orderShareText({ title: 'ac26110401 机械', total: null, paid: null })).toBe('ac26110401 机械')
  expect(orderShareText({ title: 'ac26110401 机械', total: 800, paid: 400, salesMode: 'cost' })).toBe('ac26110401 机械 应付底价800 销售已付400')
  expect(orderShareText({ title: 'aj26110401 修改', total: 0, paid: 0 })).toBe('aj26110401 修改 全款0 无需付款')
})
