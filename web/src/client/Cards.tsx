import { isInitialDeliveryPending, needsDeadline } from '@/shared/order-deadline'
import type { ChannelLabel } from '@/shared/channel-access'
import { imageSource } from './ImageViewer'
import { useEffect, useRef, useState } from 'react'

import { toast } from 'sonner'
import { CaretRight, CircleNotch, CopySimple, DownloadSimple } from '@phosphor-icons/react'
import { BrandMark } from './BrandMark'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OrderView } from '@/shared/types'
import type { Who } from './ui'
import { useSession, logExport } from './store'
import { confirmationState } from '@/shared/as-rules'
import { daysUntil, money } from '@/shared/format'
import { REFUND_TAG } from '@/shared/calc'
import { fileSize } from './files'

type AS = OrderView['afterSales'][number]
export type CardKind = 'order' | 'aftersale'

const WEEK = '日一二三四五六'
function fmtDay(date: string) {
  const d = new Date(date.length <= 10 ? date + 'T00:00:00' : date)
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`
}
/** 卡片会被转发，时间写成北京时间的具体日期，不用「今天」「明天」 */
function fmtTime(ts: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]))
  return `${p.month}月${p.day}日 ${p.weekday} ${p.hour}:${p.minute}`
}

function Av({ user, channel }: { user?: Who; channel?: ChannelLabel }) {
  const name = user?.name ?? channel?.name ?? '?'
  const src = user?.avatar ?? channel?.avatar
  let h = user?.hue ?? 0
  if (!user) for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span className={cn('pc-av', channel && 'sq')} style={{ background: `hsl(${h} 42% 88%)`, color: `hsl(${h} 45% 30%)` }}>
      {src ? <img src={src} alt="" /> : name.replace(/老师$/, '').slice(0, 1)}
    </span>
  )
}

const md = (date: string) => date.slice(5, 10).replace('-', '/')

/** 订单名一般是「编号 + 一点说明」，如 AJ2026102309 苔藓开题：编号当小票号放大，说明放下面 */
function splitName(title: string) {
  const t = title.trim()
  const ascii = t.match(/^[A-Za-z0-9][A-Za-z0-9 _-]*/)?.[0] ?? ''
  const end = ascii.search(/\d[^\d]*$/) + 1
  return end > 0 ? { code: t.slice(0, end).trim(), rest: t.slice(end).trim() } : { code: '', rest: t }
}
/** 中文标签，分段标题和待付下面再配一行小号英文 */
const L = ({ zh, en }: { zh: string; en?: string }) => <span className="rc-l">{zh}{en && <i>{en}</i>}</span>

/** 订单卡照微信小票、中英双语：订单名、渠道、费用为主；金额只在当前账号看得到时出现。 */
export function OrderCard({ v }: { v: OrderView }) {
  const { user, channel } = useSession()
  const d = daysUntil(v.dueDate)
  const ch = channel(v.channelId)
  const paid = (v.payments ?? []).filter((p) => !p.revoked).sort((a, b) => a.date.localeCompare(b.date))
  const tone = v.status === '已交付' ? 'done' : v.status === '退单' ? 'off' : !isInitialDeliveryPending(v) || d === null ? 'ok' : d < 0 ? 'late' : d <= 2 ? 'soon' : 'ok'
  const name = splitName(v.title)
  return (
    <article className="rc">
      <header className="rc-top">
        <span className="rc-brand">
          <BrandMark size={40} />
          <span>
            <b>笔下工单<CaretRight size={14} weight="bold" /></b>
            <i>BIXIA WORK ORDERS</i>
          </span>
        </span>
        <span className="rc-name">
          <i>ORDER · 订单</i>
          {name.code && <b data-len={name.code.length > 12 ? 'xl' : name.code.length > 10 ? 'l' : name.code.length > 8 ? 'm' : undefined}>{name.code}</b>}
          {name.rest && <em data-solo={!name.code || undefined}>{name.rest}</em>}
        </span>
      </header>

      <div className="rc-sec">
        {ch && <div className="rc-via">
          <Av channel={ch} />
          <span className="rc-via-text">
            <i>经由渠道</i>
            <b>{ch.name}</b>
            {v.channelNo && <small>渠道单号 {v.channelNo}</small>}
          </span>
        </div>}
        <div className="rc-row">
          {v.status === '已交付' ? <L zh="已交付" /> : v.status === '退单' ? <L zh="已退单" /> : <L zh="交稿截止" />}
          <span className="rc-due" data-k={tone}>
            {v.dueDate ? fmtDay(v.dueDate) : needsDeadline(v) ? '未定截止日期' : '—'}
          </span>
        </div>
      </div>

      {v.sales !== undefined && <div className="rc-sec">
        <div className="rc-table rc-th">
          <L zh="费用" en="Item" />
          <L zh="日期" en="Date" />
          <L zh="金额" en="Amount" />
        </div>
        <div className="rc-table rc-hero">
          <L zh="全款" />
          <span>{md(v.orderDate)}</span>
          <span className="rc-money">{money(v.sales)}</span>
        </div>
        {paid.map((p) => (
          <div key={p.id} className="rc-table">
            <L zh={p.tag === REFUND_TAG ? p.tag : `${p.tag}已付`} />
            <span>{md(p.date)}</span>
            <span className="rc-money">{p.tag === REFUND_TAG ? '-' : ''}{money(Math.abs(p.amount))}</span>
          </div>
        ))}
        {paid.length > 1 && <div className="rc-total">
          <div className="rc-row">
            <L zh="已付合计" />
            <span className="rc-money">{money(v.received)}</span>
          </div>
        </div>}
      </div>}

      <div className="rc-sec">
        <div className="rc-row">
          <L zh="负责人" />
          <span className="rc-who">
            {v.assignees.map((a) => (
              <Av key={a.userId} user={user(a.userId)} />
            ))}
            <em>{v.assignees.map((a) => user(a.userId)?.name).join('、') || '—'}</em>
          </span>
        </div>
        <div className="rc-row">
          <L zh="归属销售" />
          <span className="rc-who">
            <Av user={user(v.ownerId)} />
            <em>{user(v.ownerId)?.name}</em>
          </span>
        </div>
      </div>

      <div className="rc-sec">
        <div className="rc-row">
          <L zh="下单时间" />
          <span className="rc-num">{v.orderDate.slice(0, 10).replaceAll('-', '/')}</span>
        </div>
        {v.type && <div className="rc-row">
          <L zh="类型" />
          <span>{v.type}</span>
        </div>}
        {v.attachments.slice(0, 4).map((f) => {
          const ext = (f.name.split('.').pop() ?? '').toLowerCase()
          return (
            <div key={f.id} className="pc-file">
              <i data-ext={ext}>{ext.slice(0, 4).toUpperCase() || 'FILE'}</i>
              <span>{f.name}</span>
              <small>{fileSize(f.size)}</small>
            </div>
          )
        })}
      </div>

      <footer className="rc-end">
        <span>承君厚信，必不相负</span>
        <i>Your trust, our word</i>
      </footer>
    </article>
  )
}

/** 跟进卡和订单卡同一套小票样式：第几轮、改什么、几点前交，不放金额。 */
export function AfterSaleCard({ v, a }: { v: OrderView; a: AS }) {
  const { user } = useSession()
  const name = splitName(v.title)
  const confirmation = confirmationState(a)
  const late = !a.doneAt && new Date(a.due).getTime() < Date.now()
  const [label, at, tone] = a.cancelledAt ? ['已撤回', a.cancelledAt, 'off']
    : a.doneAt ? [(a.deliveredLateMin ?? 0) > 0 ? '逾期交付' : '已改完', a.doneAt, (a.deliveredLateMin ?? 0) > 0 ? 'late' : 'done']
    : confirmation === 'waiting' ? ['请先确认几点改完', a.confirmBy!, 'soon']
    : [late ? '已逾期，请尽快交付' : '交付截止', a.due, late ? 'late' : 'ok']
  return (
    <article className="rc">
      <header className="rc-top">
        <span className="rc-brand">
          <BrandMark size={40} />
          <span>
            <b>笔下工单<CaretRight size={14} weight="bold" /></b>
            <i>BIXIA WORK ORDERS</i>
          </span>
        </span>
        <span className="rc-name">
          <i>FOLLOW-UP · 跟进</i>
          {name.code && <b data-len={name.code.length > 12 ? 'xl' : name.code.length > 10 ? 'l' : name.code.length > 8 ? 'm' : undefined}>{name.code}</b>}
          {name.rest && <em data-solo={!name.code || undefined}>{name.rest}</em>}
        </span>
      </header>

      <div className="rc-sec">
        <div className="rc-row">
          <L zh="轮次" />
          <span className="rc-round">第 {a.round} 轮<small data-k={a.reason}>{a.reason}</small></span>
        </div>
        <div className="rc-row">
          <L zh={label} />
          <span className="rc-due" data-k={tone}>{fmtTime(at)}</span>
        </div>
        {confirmation === 'waiting' && !a.doneAt && !a.cancelledAt && <div className="rc-row">
          <L zh="不回复则按" />
          <span>{fmtTime(a.due)} 前交付</span>
        </div>}
      </div>

      <div className="rc-sec">
        <L zh="修改要求" en="Request" />
        <ol className="rc-req">
          {(a.req.length ? a.req : [`见截图（共 ${a.shots.length} 张），按截图里的要求改`]).map((r, i) => (
            <li key={i}>
              <i>{i + 1}</i>
              <span>{r}</span>
            </li>
          ))}
        </ol>
        {a.shots.length > 0 && <div className="pc-shots">
          {a.shots.slice(0, 3).map((s, i) => (
            <img key={i} src={imageSource(s)} alt="" />
          ))}
        </div>}
        {a.files.map((f, i) => {
          const ext = (f.name.split('.').pop() ?? '').toLowerCase()
          return (
            <div key={i} className="pc-file">
              <i data-ext={ext}>{ext.slice(0, 4).toUpperCase()}</i>
              <span>{f.name}</span>
              <small>{fileSize(f.size)}</small>
            </div>
          )
        })}
      </div>

      <div className="rc-sec">
        <div className="rc-row">
          <L zh="负责人" />
          <span className="rc-who">
            <Av user={user(a.writerId)} />
            <em>{user(a.writerId)?.name}</em>
          </span>
        </div>
        <div className="rc-row">
          <L zh="发起人" />
          <span className="rc-who">
            <Av user={user(a.by)} />
            <em>{user(a.by)?.name}</em>
          </span>
        </div>
        <div className="rc-row">
          <L zh="发起时间" />
          <span>{fmtTime(a.start)}</span>
        </div>
      </div>

      <footer className="rc-end">
        <span>{a.doneAt || a.cancelledAt ? '承君厚信，必不相负' : '改毕请点交付本次跟进'}</span>
        <i>{a.doneAt || a.cancelledAt ? 'Your trust, our word' : 'Deliver when done'}</i>
      </footer>
    </article>
  )
}

// 卡片直接预览；打开时准备图片，复制和下载共用同一张图。
type CardImage = { url: string; blob: Blob }
class CardImageCancelled extends Error {}

export function CardsDialog({ open, onOpenChange, orderIds, kind: kind0 = 'order' }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  orderIds: string[]
  kind?: CardKind
}) {
  const { views, s } = useSession()
  const list = views.filter((v) => orderIds.includes(v.id))
  const single = list.length === 1 ? list[0] : undefined
  const [kind, setKind] = useState<CardKind>(kind0)
  const [round, setRound] = useState('')
  const [busy, setBusy] = useState(false)
  const [image, setImage] = useState<{ generation: number; value: CardImage } | null>(null)
  const [error, setError] = useState('')
  const [showImage, setShowImage] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const rendering = useRef<{ generation: number; task: Promise<CardImage> } | null>(null)
  const acting = useRef<number | null>(null)
  // 人员头像、渠道名以及订单内容变化后，不复用上一张图片。
  const imageKey = JSON.stringify([open, kind, round, list, s.users, s.channels])
  const live = useRef({ key: imageKey, generation: 0 })
  if (live.current.key !== imageKey) {
    live.current = { key: imageKey, generation: live.current.generation + 1 }
    rendering.current = null
  }
  const generation = live.current.generation
  const ready = image?.generation === generation ? image.value : null
  const isCurrent = () => open && live.current.generation === generation && !!stage.current?.isConnected
  function requireCurrent(node: HTMLDivElement) {
    if (!isCurrent() || stage.current !== node) throw new CardImageCancelled()
  }

  useEffect(() => {
    if (!open) return
    setShowImage(false)
    setKind(kind0 === 'aftersale' && single?.afterSales.length ? 'aftersale' : 'order')
    setRound(single?.afterSales.length ? (single.afterSales.find((a) => !a.doneAt) ?? single.afterSales[single.afterSales.length - 1]).id : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderIds.join(','), kind0])

  async function renderImage(node: HTMLDivElement): Promise<CardImage> {
    requireCurrent(node)
    const { toCanvas } = await import('html-to-image')
    requireCurrent(node)
    const canvas = await toCanvas(node, { pixelRatio: 2, skipFonts: true, style: { margin: '0' } })
    requireCurrent(node)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    requireCurrent(node)
    if (!blob) throw new Error('图片准备失败，请重试')
    return { url: canvas.toDataURL('image/png'), blob }
  }

  function prepare(): Promise<CardImage> {
    if (ready) return Promise.resolve(ready)
    if (rendering.current?.generation === generation) return rendering.current.task
    const node = stage.current
    if (!node) return Promise.reject(new Error('卡片尚未就绪'))
    setError('')
    const task = renderImage(node).then(value => {
      requireCurrent(node)
      setImage({ generation, value })
      return value
    }).catch((cause: unknown) => {
      if (!(cause instanceof CardImageCancelled) && isCurrent()) setError('图片准备失败，请点击复制重试')
      throw cause
    }).finally(() => {
      if (rendering.current?.generation === generation) rendering.current = null
    })
    rendering.current = { generation, task }
    return task
  }

  useEffect(() => {
    if (!open || !list.length) return
    setImage(null)
    setBusy(false)
    const frame = requestAnimationFrame(() => { void prepare().catch(() => {}) })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation])

  function recordExport() {
    logExport(`${kind === 'order' ? '订单卡' : '跟进卡'} · ${list.map(v => v.title).join('、')}`, list.map(v => v.id))
  }
  async function copy() {
    if (acting.current === generation) return
    acting.current = generation; setBusy(true)
    // 在点击的同步阶段调用 clipboard.write，保留 Safari 所需的用户手势。
    const result = prepare()
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('clipboard unavailable')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': result.then(value => value.blob) })])
      if (!isCurrent()) return
      recordExport()
      toast.success(kind === 'order' ? '订单卡已复制' : '跟进卡已复制')
    } catch (cause) {
      if (cause instanceof CardImageCancelled || !isCurrent()) return
      try {
        await result
        if (!isCurrent()) return
        setShowImage(true)
        toast('可右键或长按图片复制、保存')
      } catch (cause) { if (!(cause instanceof CardImageCancelled) && isCurrent()) toast.error('图片准备失败，请重试') }
    } finally { if (acting.current === generation) { acting.current = null; if (isCurrent()) setBusy(false) } }
  }
  async function download() {
    if (acting.current === generation) return
    acting.current = generation; setBusy(true)
    try {
      const value = await prepare()
      if (!isCurrent()) return
      const a = document.createElement('a')
      a.href = value.url
      a.download = `${single?.title.replace(/[\\/:*?"<>|]/g, '') ?? `${list.length}单`}-${kind === 'order' ? '订单卡' : '跟进卡'}.png`
      a.click()
      recordExport()
    } catch (cause) { if (!(cause instanceof CardImageCancelled) && isCurrent()) toast.error('图片准备失败，请重试') }
    finally { if (acting.current === generation) { acting.current = null; if (isCurrent()) setBusy(false) } }
  }
  const afterSale = single?.afterSales.find(a => a.id === round)
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[560px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
      <div className="flex items-center gap-2 border-b py-3 pl-4 pr-12">
        <DialogTitle className="mr-auto text-base">{kind === 'order' ? '订单卡' : '跟进卡'}{list.length > 1 && <span className="ml-2 text-xs font-normal text-muted-foreground">{list.length} 单</span>}</DialogTitle>
        <DialogDescription className="sr-only">卡片预览，复制或下载图片</DialogDescription>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title="复制图片" aria-label="复制卡片图片" disabled={busy || !list.length} onClick={copy}>{busy ? <CircleNotch size={18} className="animate-spin" /> : <CopySimple size={18} />}</Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="下载图片" aria-label="下载卡片图片" disabled={busy || !list.length} onClick={download}><DownloadSimple size={18} /></Button>
      </div>
      {single && single.afterSales.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
        {(['order', 'aftersale'] as const).map(k => <button key={k} disabled={busy} onClick={() => { setKind(k); setShowImage(false) }} className={cn('rounded px-2.5 py-1', kind === k ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent')}>{k === 'order' ? '订单卡' : '跟进卡'}</button>)}
        {kind === 'aftersale' && single.afterSales.map(a => <button key={a.id} disabled={busy} onClick={() => { setRound(a.id); setShowImage(false) }} className={cn('rounded-full border px-2 py-0.5', round === a.id ? 'border-primary text-primary' : 'text-muted-foreground')}>第 {a.round} 轮</button>)}
      </div>}
      {error && <p role="status" className="px-4 py-2 text-xs text-danger">{error}</p>}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-[#ededed] p-4">
        {showImage && ready && <img src={ready.url} alt="卡片图片" className="mx-auto w-full max-w-[375px] rounded-lg" />}
        <div ref={stage} className={cn('mx-auto flex w-fit flex-col items-center gap-4', showImage && ready && 'absolute -left-[10000px] top-0')}>
          {kind === 'aftersale' && single && afterSale ? <AfterSaleCard v={single} a={afterSale} /> : list.map(v => <OrderCard key={v.id} v={v} />)}
        </div>
      </div>
    </DialogContent>
  </Dialog>
}
