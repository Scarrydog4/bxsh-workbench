import { open } from 'node:fs/promises'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/server/db'
import { uploads } from '@/server/schema'
import { bad, json, notFound, route } from '@/server/http'
import { CHUNK } from '@/server/files'

async function mine(id: string, userId: string) {
  const [u] = await db.select().from(uploads).where(and(eq(uploads.id, id), eq(uploads.userId, userId)))
  if (!u) throw notFound('上传不存在')
  return u
}

/** 查进度：断线后从 received 接着传 */
export const GET = route<{ id: string }>(async (_req, c, p) => {
  const u = await mine(p.id, c.me.id)
  return json({ received: u.received, size: u.size })
})

/**
 * 传一片：?offset= 必须等于已收到的字节数。
 * 同一个上传的分片排队写（锁住这行上传记录），按偏移量写到文件的固定位置，
 * 重复或重叠的请求不会把同一段写两遍，文件长度始终等于 received。
 */
export const PUT = route<{ id: string }>(async (req, c, p) => {
  const offset = Number(new URL(req.url).searchParams.get('offset'))
  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.length > CHUNK) throw bad('单片太大')
  return db.transaction(async (tx) => {
    const [u] = await tx
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, p.id), eq(uploads.userId, c.me.id), isNull(uploads.doneAt)))
      .for('update')
    if (!u) throw notFound('上传不存在或已完成')
    if (offset !== u.received) return json({ error: '偏移量不对，按 received 续传', received: u.received }, { status: 409 })
    if (u.received + buf.length > u.size) throw bad('超出文件大小')
    const fh = await open(u.path, 'r+')
    try {
      await fh.write(buf, 0, buf.length, offset)
      await fh.truncate(offset + buf.length)
    } finally {
      await fh.close()
    }
    const received = u.received + buf.length
    await tx.update(uploads).set({ received }).where(eq(uploads.id, u.id))
    return json({ received })
  })
})
