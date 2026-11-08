import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { CHECKIN_SCHEDULE, checkinTiming } from '@/shared/checkin'
import type { CheckinKind, CheckinList, CheckinRecord, CheckinResult, CheckinScope } from '@/shared/checkin'
import { businessDate } from '@/shared/format'
import { db } from './db'
import { bad, deny, notFound } from './http'
import { dailyCheckins, users } from './schema'
import type { Ctx } from './session'
import { env } from './env'

const columns = {
  id: dailyCheckins.id, userId: dailyCheckins.userId, day: dailyCheckins.day,
  clockInAt: dailyCheckins.clockInAt, clockOutAt: dailyCheckins.clockOutAt,
  breakStartAt: dailyCheckins.breakStartAt, breakEndAt: dailyCheckins.breakEndAt,
  name: users.name, avatar: users.avatar, hue: users.hue,
}

type CheckinRow = typeof dailyCheckins.$inferSelect

function record(row: Pick<CheckinRow, 'id' | 'userId' | 'day' | 'clockInAt' | 'clockOutAt' | 'breakStartAt' | 'breakEndAt'> & { name: string; hue: number; avatar?: string | null }): CheckinRecord {
  return {
    id: row.id, userId: row.userId, day: row.day, name: row.name, hue: row.hue, avatar: row.avatar ?? undefined,
    clockInAt: new Date(row.clockInAt).toISOString(), clockOutAt: row.clockOutAt ? new Date(row.clockOutAt).toISOString() : null,
    breakStartAt: row.breakStartAt ? new Date(row.breakStartAt).toISOString() : null, breakEndAt: row.breakEndAt ? new Date(row.breakEndAt).toISOString() : null,
    clockInPhoto: `/api/checkins/${row.id}/photo?kind=in`, clockOutPhoto: row.clockOutAt ? `/api/checkins/${row.id}/photo?kind=out` : null,
    ...checkinTiming(row.day, row.clockInAt, row.clockOutAt, row.breakStartAt, row.breakEndAt),
  }
}

export async function listCheckins(c: Ctx, month: string | undefined, scope: CheckinScope): Promise<CheckinList> {
  if (scope === 'team' && !c.role.locked) throw deny('只有老板可以查看全员打卡')
  const today = businessDate(new Date())
  month ??= today.slice(0, 7)
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) throw bad('请选择有效月份')
  const [year, monthNumber] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const rows = (await db.select(columns).from(dailyCheckins)
    .innerJoin(users, eq(users.id, dailyCheckins.userId))
    .where(and(gte(dailyCheckins.day, `${month}-01`), lte(dailyCheckins.day, `${month}-${lastDay}`),
      scope === 'mine' ? eq(dailyCheckins.userId, c.me.id) : undefined))
    .orderBy(desc(dailyCheckins.clockInAt), dailyCheckins.id)).map(record)
  let todayRecord = rows.find(r => r.userId === c.me.id && r.day === today) ?? null
  if (month !== today.slice(0, 7)) {
    const [current] = await db.select(columns).from(dailyCheckins)
      .innerJoin(users, eq(users.id, dailyCheckins.userId))
      .where(and(eq(dailyCheckins.userId, c.me.id), eq(dailyCheckins.day, today))).limit(1)
    todayRecord = current ? record(current) : null
  }
  return { today, month, rows, todayRecord, schedule: CHECKIN_SCHEDULE,
    summary: { recordCount: rows.length, peopleCount: new Set(rows.map(r => r.userId)).size, myDays: rows.filter(r => r.userId === c.me.id).length } }
}

/** 单独目录，不进入公开头像或订单附件；重编码默认去掉 EXIF 等元数据。 */
async function savePhoto(data: string, id: string, kind: 'in' | 'out') {
  const match = data.match(/^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match) throw bad('请拍照后再打卡')
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.length > 8_000_000) throw bad('照片不能超过 8MB')
  let output: Buffer
  try {
    output = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
      .resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer()
  } catch { throw bad('照片无法读取，请重新拍照') }
  const dir = path.join(env.storageDir, 'checkin-photos'), file = `${id}-${kind}.webp`
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, file), output)
  return file
}

export async function checkin(c: Ctx, kind: CheckinKind, photo?: string): Promise<CheckinResult> {
  const day = businessDate(new Date())
  let savedPhoto: string | undefined
  try {
    return await db.transaction(async tx => {
      // 每人每天独立排队；重试先返回原记录，不重复写照片或覆盖首次时间。
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`daily-checkin:${c.me.id}:${day}`}, 0))`)
      const now = new Date()
      if (businessDate(now) !== day) throw bad('北京时间已进入新的一天，请重新打卡')
      const [existing] = await tx.select().from(dailyCheckins)
        .where(and(eq(dailyCheckins.userId, c.me.id), eq(dailyCheckins.day, day))).limit(1)
      const dto = (row: CheckinRow) => record({ ...row, name: c.me.name, avatar: c.me.avatar, hue: c.me.hue })
      const timeField = { in: 'clockInAt', 'break-start': 'breakStartAt', 'break-end': 'breakEndAt', out: 'clockOutAt' }[kind] as 'clockInAt' | 'breakStartAt' | 'breakEndAt' | 'clockOutAt'
      if (existing?.[timeField]) return { record: dto(existing), created: false }
      if (kind !== 'in' && !existing) throw bad('今天还没有上班打卡，请先打上班卡')
      if (kind !== 'in' && existing.clockOutAt) throw bad('今天已经下班，不能再登记午休')
      if (kind === 'break-end' && !existing.breakStartAt) throw bad('请先登记午休开始')
      if (kind === 'out' && existing.breakStartAt && !existing.breakEndAt) throw bad('午休尚未结束，请先登记午休结束')
      const id = existing?.id ?? randomUUID()
      if (kind === 'in' || kind === 'out') {
        if (!photo) throw bad('请拍照后再打卡')
        savedPhoto = await savePhoto(photo, id, kind)
      }
      let row: CheckinRow
      if (kind === 'in') {
        [row] = await tx.insert(dailyCheckins).values({ id, userId: c.me.id, day, clockInAt: now.toISOString(), clockInPhoto: savedPhoto! }).returning()
      } else {
        const previousAt = kind === 'break-end' ? existing.breakStartAt! : kind === 'out' ? existing.breakEndAt ?? existing.clockInAt : existing.clockInAt
        const at = new Date(Math.max(now.getTime(), new Date(previousAt).getTime())).toISOString()
        const patch: Partial<typeof dailyCheckins.$inferInsert> = { [timeField]: at }
        if (kind === 'out') patch.clockOutPhoto = savedPhoto!
        const updated = await tx.update(dailyCheckins).set(patch).where(eq(dailyCheckins.id, id)).returning()
        row = updated[0]
      }
      return { record: dto(row), created: true }
    })
  } catch (error) {
    if (savedPhoto) await unlink(path.join(env.storageDir, 'checkin-photos', savedPhoto)).catch(() => {})
    throw error
  }
}

export async function checkinPhoto(c: Ctx, id: string, kind: 'in' | 'out') {
  const [row] = await db.select().from(dailyCheckins).where(eq(dailyCheckins.id, id)).limit(1)
  if (!row || (!c.role.locked && row.userId !== c.me.id)) throw notFound()
  const file = kind === 'in' ? row.clockInPhoto : row.clockOutPhoto
  if (!file || !/^[0-9a-f-]{36}-(in|out)\.webp$/.test(file)) throw notFound()
  return { path: path.join(env.storageDir, 'checkin-photos', file), name: `${row.day}-${kind === 'in' ? '上班' : '下班'}.webp`, id: file }
}
