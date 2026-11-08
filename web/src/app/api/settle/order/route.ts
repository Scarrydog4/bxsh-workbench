import { isStagedWriterPay, writerStageSummary } from '@/shared/writer-stages'
import { orderFor } from '@/server/actions'
import { needSettle } from '@/server/actions-p2'
import { db } from '@/server/db'
import { bad, json, notFound, route } from '@/server/http'
import { adminIdsOf, loadWorld } from '@/server/repo'
import { incomeAmounts } from '@/shared/settle'

/** 订单上的发放面板只读取这一单的结算金额，无需开放他人的收入列表。 */
export const GET = route(async (req, c) => {
  const q = new URL(req.url).searchParams
  const kind = q.get('kind')
  if (kind !== '写手工资' && kind !== '销售提成') throw bad('类型不对')
  needSettle(c, kind)
  const w = await loadWorld(db)
  const o = orderFor(w, c, q.get('order') ?? '', 'settle.manage')
  const payeeId = q.get('payee') ?? ''
  if (!w.users.some(u => u.id === payeeId)) throw notFound('收款人不存在')
  const admins = adminIdsOf(w)
  const amounts = incomeAmounts(o, kind, payeeId, admins)
  return json({
    ...(c.role.locked && kind === '写手工资' && isStagedWriterPay(o) ? { writerStages: writerStageSummary(o, payeeId) } : {}),
    ...amounts,
    amount: amounts.due,
    unpaid: amounts.left,
    available: amounts.left,
    reserved: 0,
    pending: 0,
  })
})
