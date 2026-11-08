import { useEffect, useState } from 'react'
import type { OrderView } from '@/shared/types'
import { useSession } from './store'
import { getOrderSettlement, type Kind, type OrderSettlementSummary } from './store-p2'
import { CustLight, PayButton } from './PayButton'
import { Money, Person } from './ui'

/** 订单里的工资：每人一行，总额 · 剩余 · 发。 */
export function OrderPayLines({ v }: { v: OrderView }) {
  const { s, can } = useSession()
  const see = (k: Kind) => can('settle.manage') && (s.role.locked || (k === '写手工资' ? s.role.fields.writerPay : s.role.fields.commission) === 'all')
  const outside = (id: string) => s.users.some(u => u.id === id && !u.isAdmin)
  const lines: { kind: Kind; payeeId: string }[] = [
    ...(see('销售提成') && !v.isSelf && v.salesMode !== 'cost' && outside(v.ownerId) ? [{ kind: '销售提成' as const, payeeId: v.ownerId }] : []),
    ...(see('写手工资') ? v.assignees.filter(a => outside(a.userId)).map(a => ({ kind: '写手工资' as const, payeeId: a.userId })) : []),
  ]
  if (!lines.length) return null
  return <section data-order-field="工资结算" className="grid gap-1">
    <header className="flex h-8 items-center gap-2 text-[13px] font-medium">工资<span className="ml-auto"><CustLight stage={v.custStage}/></span></header>
    <div className="divide-y rounded-lg border">
      {lines.map(l => <PayLine key={`${l.kind}:${l.payeeId}`} v={v} {...l}/>)}
    </div>
  </section>
}

function PayLine({ v, kind, payeeId }: { v: OrderView; kind: Kind; payeeId: string }) {
  const { s, user } = useSession()
  const [sum, setSum] = useState<OrderSettlementSummary | null>(null)
  const person = user(payeeId)
  useEffect(() => {
    let live = true
    void getOrderSettlement({ orderId: v.id, kind, payeeId }).then(r => { if (live) setSum(r) })
    return () => { live = false }
  }, [v.id, kind, payeeId, s.version])
  const over = sum?.over ?? 0
  return <div className="flex h-11 items-center gap-3 px-3 text-sm">
    <span className="min-w-0 flex-1"><Person user={person} size={22}/>{kind === '销售提成' && <span className="ml-1.5 text-xs text-muted-foreground">销售</span>}</span>
    <span className="w-20 text-right text-xs text-muted-foreground">总额 <Money value={sum ? sum.due : undefined} className="text-sm text-foreground"/></span>
    <span className="w-24 text-right text-xs text-muted-foreground">{over > 0 ? <>多发 <Money value={over} className="text-sm text-foreground"/></> : <>剩 <Money value={sum ? sum.left : undefined} className={sum?.left ? 'text-sm font-medium text-foreground' : 'text-sm text-muted-foreground'}/></>}</span>
    {sum && person ? <PayButton orderId={v.id} kind={kind} payeeId={payeeId} payeeName={person.name} left={sum.left} suggest={sum.suggest}/> : <span className="w-[42px]"/>}
  </div>
}
