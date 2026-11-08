import { expect, test } from 'vitest'
import { distributeByPrice } from '@/shared/receipt-allocation'
test('30%', () => {
  const o = [{ id: 'a', sales: 240, unpaid: 240 }, { id: 'b', sales: 700, unpaid: 700 }, { id: 'c', sales: 900, unpaid: 900 }]
  expect(distributeByPrice(55200, o)).toEqual({ a: '72.00', b: '210.00', c: '270.00' })
  const r = distributeByPrice(10001, o)!; expect(Object.values(r).reduce((s, v) => s + Math.round(Number(v) * 100), 0)).toBe(10001)
  const capped = distributeByPrice(1000_00, [{ id: 'a', sales: 1000, unpaid: 100 }, { id: 'b', sales: 1000, unpaid: 1000 }])!
  expect(capped).toEqual({ a: '100.00', b: '900.00' })
})
