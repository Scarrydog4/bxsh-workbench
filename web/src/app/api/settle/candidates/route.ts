import { db } from '@/server/db'
import { adminIdsOf, loadWorld } from '@/server/repo'
import { bad, deny, json, route } from '@/server/http'
import { can, rowVisible } from '@/shared/perm'
import { candidates } from '@/shared/settle'

/** 新建 / 编辑结算单时：列出某人还没结清的单和剩余应结。?kind=写手工资&payee=&period=2026-10-15&except=<草稿 id> */
export const GET = route(async (req, c) => {
  const q = new URL(req.url).searchParams
  const kind = q.get('kind')
  if (kind !== '写手工资' && kind !== '销售提成') throw bad('类型不对')
  const f = c.role.locked ? { writerPay: 'all', commission: 'all' } : c.role.fields
  if (!can(c.role, 'settle.manage') || (kind === '写手工资' ? f.writerPay : f.commission) !== 'all') throw deny()
  const w = await loadWorld(db)
  const period = q.get('period') || undefined
  const payee = q.get('payee') ?? '', admins = adminIdsOf(w)
  if (admins.has(payee)) return json([])
  return json(candidates(w.orders.filter(order => rowVisible(order, c.me, c.role)), kind, payee, admins, { period, exceptBatch: q.get('except') || undefined }))
})
