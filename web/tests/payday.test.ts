import { afterEach, describe, expect, it, vi } from 'vitest'
import { businessDate, payday } from '@/shared/format'

const originalTZ = process.env.TZ
afterEach(() => {
  vi.useRealTimers()
  if (originalTZ === undefined) delete process.env.TZ
  else process.env.TZ = originalTZ
})
describe('工资统一按北京时间归期', () => {
  for (const tz of ['Asia/Shanghai', 'America/New_York', 'Asia/Tokyo']) {
    it(`${tz}：15日零点前后、纯日期与跨年结果一致`, () => {
      process.env.TZ = tz
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
      expect(payday('2026-10-14T15:59:59Z')).toBe('10月15日')
      expect(payday('2026-10-14T16:00:00Z')).toBe('11月15日')
      expect(payday('2026-10-14T16:30:00Z')).toBe('11月15日')
      expect(businessDate('2026-10-14T16:30:00Z')).toBe('2026-10-15')
      expect(payday('2026-10-14')).toBe('10月15日')
      expect(payday('2026-10-15')).toBe('11月15日')
      expect(payday('2026-12-14T16:00:00Z')).toBe('2027年1月15日')
      expect(payday(null)).toBeNull()
    })
  }
})
