/** 打卡只记录本人每天的首次上下班时间，不参与订单、工资或绩效计算。 */
export interface CheckinRecord {
  id: string
  userId: string
  name: string
  avatar?: string
  hue: number
  day: string
  clockInAt: string
  clockOutAt: string | null
  clockInPhoto: string
  clockOutPhoto: string | null
  breakStartAt: string | null
  breakEndAt: string | null
  late: boolean
  earlyLeave: boolean
  isWorkday: boolean
  breakMinutes: number | null
  breakOvertimeMinutes: number
  overtimeMinutes: number | null
}

export type CheckinScope = 'mine' | 'team'
export const CHECKIN_KINDS = ['in', 'break-start', 'break-end', 'out'] as const
export type CheckinKind = typeof CHECKIN_KINDS[number]
export const CHECKIN_LABELS: Record<CheckinKind, string> = { in: '上班', 'break-start': '午休开始', 'break-end': '午休结束', out: '下班' }

export const CHECKIN_SCHEDULE = { start: '10:00', end: '20:00', timeZone: 'Asia/Shanghai', breakMinutes: 90, workdays: [1, 2, 3, 4, 5] } as const

export function checkinTiming(day: string, clockInAt: string, clockOutAt: string | null, breakStartAt: string | null = null, breakEndAt: string | null = null, now = new Date()) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  const isWorkday = weekday >= 1 && weekday <= 5
  const duration = breakStartAt ? Math.max(0, (new Date(breakEndAt ?? now).getTime() - new Date(breakStartAt).getTime()) / 60_000) : null
  const overtimeStart = Math.max(new Date(clockInAt).getTime(), new Date(`${day}T${CHECKIN_SCHEDULE.end}:00+08:00`).getTime())
  const overtimeEnd = clockOutAt ? new Date(clockOutAt).getTime() : null
  const breakOverlap = overtimeEnd !== null && breakStartAt && breakEndAt
    ? Math.max(0, Math.min(overtimeEnd, new Date(breakEndAt).getTime()) - Math.max(overtimeStart, new Date(breakStartAt).getTime())) : 0
  const overtime = overtimeEnd === null ? null : Math.max(0, overtimeEnd - overtimeStart - breakOverlap) / 60_000
  return {
    isWorkday,
    late: isWorkday && new Date(clockInAt).getTime() > new Date(`${day}T${CHECKIN_SCHEDULE.start}:00+08:00`).getTime(),
    earlyLeave: isWorkday && clockOutAt !== null && new Date(clockOutAt).getTime() < new Date(`${day}T${CHECKIN_SCHEDULE.end}:00+08:00`).getTime(),
    breakMinutes: duration === null ? null : Math.round(duration * 100) / 100,
    breakOvertimeMinutes: duration === null ? 0 : Math.round(Math.max(0, duration - CHECKIN_SCHEDULE.breakMinutes) * 100) / 100,
    overtimeMinutes: overtime === null ? null : Math.round(overtime * 100) / 100,
  }
}

export interface CheckinList {
  today: string
  month: string
  rows: CheckinRecord[]
  /** 无论查看哪个月、哪个范围，这里始终是本人今天的记录。 */
  todayRecord: CheckinRecord | null
  summary: { recordCount: number; peopleCount: number; myDays: number }
  schedule: typeof CHECKIN_SCHEDULE
}

export interface CheckinResult {
  record: CheckinRecord
  created: boolean
}
