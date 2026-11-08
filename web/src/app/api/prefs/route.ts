import { z } from 'zod'
import { db } from '@/server/db'
import { userPrefs } from '@/server/schema'
import { bad, json, route } from '@/server/http'

/** 个人设置（列顺序、列宽、冻结列、首页卡片顺序、保存的视图）：每人一份，存服务器，换电脑也在 */
export const POST = route(async (req, c) => {
  const body = z.object({ key: z.string().min(1).max(100), value: z.unknown() }).safeParse(await req.json().catch(() => null))
  if (!body.success) throw bad('设置格式不对')
  if (JSON.stringify(body.data.value ?? null).length > 50_000) throw bad('设置太大了')
  await db
    .insert(userPrefs)
    .values({ userId: c.me.id, key: body.data.key, value: body.data.value ?? null })
    .onConflictDoUpdate({ target: [userPrefs.userId, userPrefs.key], set: { value: body.data.value ?? null } })
  return json({ ok: true })
})
