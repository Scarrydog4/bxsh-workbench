import { expect, it } from 'vitest'
import { withOrderLevel } from '@/shared/order-level'

it('专/本放在单号后面，单号仍在最前，自动编号和单号识别不受影响', () => {
  expect(withOrderLevel('aj26111203 计算机', '专')).toBe('aj26111203 专 计算机')
  expect(withOrderLevel('aj26111203', '本')).toBe('aj26111203 本')
  expect(withOrderLevel('aj20261102013-1 法学', '本')).toBe('aj20261102013-1 本 法学')
  expect(withOrderLevel('待定 ac26111009 作业', '专')).toBe('待定 ac26111009 专 作业')
})

it('没有单号放最前面；不标时原样保存', () => {
  expect(withOrderLevel('乡村振兴背景下县域电商发展路径', '本')).toBe('本 乡村振兴背景下县域电商发展路径')
  expect(withOrderLevel('  aj26111203 计算机 ', '')).toBe('aj26111203 计算机')
  expect(withOrderLevel('', '专')).toBe('')
})

it('订单名里已经写了专、专科、本、本科就不重复加', () => {
  expect(withOrderLevel('aj26111010 专科', '专')).toBe('aj26111010 专科')
  expect(withOrderLevel('ac26111009 专', '本')).toBe('ac26111009 专')
  expect(withOrderLevel('本科 毕业论文', '本')).toBe('本科 毕业论文')
  // 「专升本」不是层次标记，照常加
  expect(withOrderLevel('aj26111203 专升本英语', '本')).toBe('aj26111203 本 专升本英语')
})
