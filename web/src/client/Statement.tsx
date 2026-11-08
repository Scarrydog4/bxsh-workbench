'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { DownloadSimple, LinkSimple, CopySimple, Prohibit } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Channel } from '@/shared/types'
import type { StatementPrepayment, StatementRow } from '@/server/statement'
import { iso, money, relTime, today } from '@/shared/format'
import { Money, StatusPill, inputCls, SkeletonRows } from './ui'
import { useSession } from './store'
import { createShare, revokeShare } from './store-p2'
import { DataTable } from './table-kit'

interface Data {
  channel: string
  month: string
  rows: StatementRow[]
  total: { sales: number; received: number; unpaid: number }
  prepayments?: StatementPrepayment[]
  prepaymentTotal?: number
}

/** 渠道对账单：选月份看订单、渠道单号、金额、已收、未收；导出 Excel；生成只读分享链接（可设有效期、随时撤销） */
export function StatementDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { s } = useSession()
  const [month, setMonth] = useState(iso(today()).slice(0, 7))
  const [data, setData] = useState<Data | null>(null)
  const [days, setDays] = useState<number | null>(30)
  const [fresh, setFresh] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setData(null)
    void fetch(`/api/statement?channelId=${channel.id}&month=${month}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [channel.id, month, s.version])

  const links = s.shareLinks.filter((l) => l.channelId === channel.id)

  async function share() {
    const r = await createShare(channel.id, month, days)
    if (!r) return
    const url = `${location.origin}/s/${r.token}`
    setFresh(url)
    try {
      await navigator.clipboard.writeText(url)
      toast.success('链接已复制，发给渠道就行')
    } catch {
      toast.success('链接已生成，点「复制」发给渠道')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-money="plain" className="max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[760px] gap-0 overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">{channel.name} · 对账单</DialogTitle>
            <DialogDescription className="text-xs">按下单日期算月份；只含你能看到的订单</DialogDescription>
          </div>
          <input type="month" aria-label="月份" className={cn(inputCls, 'h-8 w-auto')} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <a href={`/api/statement?channelId=${channel.id}&month=${month}&format=xlsx`} download className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent">
            <DownloadSimple size={14} /> 导出
          </a>
        </div>

        <div className="scroll-thin max-h-[45dvh] overflow-auto">
          {!data ? (
            <SkeletonRows rows={5}/>
          ) : data.rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">这个月没有订单</div>
          ) : (
            <DataTable id="channel-statement-orders" rows={data.rows} rowId={r => r.no} cols={[
              { id: 'title', header: '订单', size: 250, sort: r => r.title, filterValue: r => `${r.title} ${r.no} ${r.orderDate}`, cell: r => <div className="py-1"><div className="truncate" title={r.title}>{r.title}</div><div className="num text-xs text-muted-foreground">{r.orderDate.slice(5)}</div></div> },
              { id: 'channelNo', header: '渠道单号', size: 120, sort: r => r.channelNo, cell: r => <span className="text-muted-foreground">{r.channelNo || '—'}</span> },
              { id: 'status', header: '状态', size: 105, sort: r => r.status, cell: r => <StatusPill status={r.status} /> },
              { id: 'sales', header: '金额', size: 100, align: 'right', sort: r => r.sales, cell: r => <Money value={r.sales} plain className="text-gold" /> },
              { id: 'received', header: '已收', size: 100, align: 'right', sort: r => r.received, cell: r => <Money value={r.received} /> },
              { id: 'unpaid', header: '未收', size: 110, align: 'right', sort: r => r.unpaid, cell: r => <span>{r.unpaid < 0 ? `多收 ${money(-r.unpaid)}` : <Money value={r.unpaid} plain className="text-foreground" />}</span> },
            ]} />
          )}
          {!!data?.prepayments?.length && <section className="border-t">
            <div className="flex flex-wrap items-center justify-between gap-1 px-5 py-3"><div><h3 className="text-sm font-medium">未分配预收</h3><p className="mt-0.5 text-xs text-muted-foreground">本月收款 · 当前余额 · 未计入订单已收</p></div><span className="num text-sm font-medium text-primary">{money(data.prepaymentTotal ?? 0)}</span></div>
            <DataTable id="channel-statement-prepayments" rows={data.prepayments} rowId={r => r.no} cols={[
              { id: 'date', header: '收款日期', size: 130, sort: r => r.date, cell: r => <span className="num">{r.date}</span> },
              { id: 'no', header: '收款编号', size: 150, sort: r => r.no, cell: r => <span className="num">{r.no}</span> },
              { id: 'amount', header: '原收款', size: 110, align: 'right', sort: r => r.amount, cell: r => <Money value={r.amount} /> },
              { id: 'allocated', header: '已分配', size: 110, align: 'right', sort: r => r.allocated, cell: r => <Money value={r.allocated} /> },
              { id: 'unallocated', header: '未分配', size: 110, align: 'right', sort: r => r.unallocated, cell: r => <Money value={r.unallocated} className="font-medium" /> },
            ]} />
          </section>}
        </div>
        {data && data.rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 border-t px-5 py-2.5 text-sm">
            <span className="mr-auto text-xs text-muted-foreground">本月合计</span>
            <span>
              金额 <Money value={data.total.sales} plain className="font-medium text-gold" />
            </span>
            <span>
              已收 <Money value={data.total.received} className="font-medium" />
            </span>
            <span>
              未收 <Money value={data.total.unpaid} plain className="font-medium text-foreground" />
            </span>
          </div>
        )}

        <div className="grid gap-2 border-t bg-muted/20 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <LinkSimple size={15} className="text-muted-foreground" />
            <span className="font-medium">分享给渠道</span>
            <span className="text-xs text-muted-foreground">对方不用登录，只能看这个月的对账单</span>
            <span className="ml-auto flex items-center gap-1 text-xs">
              有效期
              {([7, 30, null] as const).map((d) => (
                <button key={String(d)} onClick={() => setDays(d)} className={cn('rounded-full border px-2 py-0.5', days === d ? 'border-primary bg-primary/10 text-primary' : 'border-dashed border-input text-muted-foreground')}>
                  {d ? `${d} 天` : '长期'}
                </button>
              ))}
            </span>
            <Button size="sm" className="h-7 gap-1" onClick={() => void share()}>
              生成 {Number(month.slice(5))} 月的链接
            </Button>
          </div>
          {fresh && (
            <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/[0.06] px-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono">{fresh}</span>
              <button onClick={() => void navigator.clipboard.writeText(fresh).then(() => toast.success('已复制'))} className="flex items-center gap-1 text-primary hover:underline">
                <CopySimple size={12} /> 复制
              </button>
              <span className="text-muted-foreground">只显示这一次</span>
            </div>
          )}
          {links.length > 0 && (
            <div className="grid gap-1 text-xs">
              {links.map((l) => {
                const expired = l.expiresAt && new Date(l.expiresAt).getTime() < Date.now()
                const dead = l.revokedAt || expired
                return (
                  <div key={l.id} className={cn('flex items-center gap-2 rounded-md px-1 py-1', dead && 'text-muted-foreground')}>
                    <span className="num">{l.month}</span>
                    <span>{l.revokedAt ? '已撤销' : expired ? '已过期' : l.expiresAt ? `有效到 ${l.expiresAt.slice(5, 10)}` : '长期有效'}</span>
                    <span className="text-muted-foreground">
                      {relTime(l.createdAt)} 生成 · 打开 {l.opens} 次
                    </span>
                    {!dead && (
                      <button onClick={() => void revokeShare(l.id).then((ok) => ok && toast.success('链接已撤销，马上失效'))} className="ml-auto flex items-center gap-1 text-danger hover:underline">
                        <Prohibit size={12} /> 撤销
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
