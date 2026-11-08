import { useEffect, useState } from 'react'
import { needsDeadline } from '@/shared/order-deadline'
import type { ChannelLabel } from '@/shared/channel-access'
import { ArrowUpRight, Check, Copy, Sparkle } from '@phosphor-icons/react'
import { toast } from 'sonner'
import type { AssistantAnswer } from '@/shared/assistant'
import { money } from '@/shared/format'
import { useSession } from './store'
import { useNav } from './nav'
import { Avatar, ChannelAvatar, StatusPill, type Who } from './ui'
import { Button } from '@/components/ui/button'

// 只强调普通文本中的单号和金额，模型回复不作为 HTML 执行。
function AnswerText({ text, channels, people }: { text: string; channels: ChannelLabel[]; people: Who[] }) {
  const names = [...new Set([...channels, ...people].map((item) => item.name))].filter(Boolean).sort((a, b) => b.length - a.length)
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(\\bDD\\d{10,}\\b|[¥￥]\\s*\\d[\\d,]*(?:\\.\\d+)?|\\d[\\d,]*(?:\\.\\d+)?\\s*元${escaped.length ? '|' + escaped.join('|') : ''})`, 'g')
  return <div className="space-y-3 text-sm leading-7 text-foreground/90">{text.split(/\n\s*\n/).filter(Boolean).map((paragraph, i) =>
    <p key={i} className="whitespace-pre-wrap break-words">{paragraph.split(pattern).map((part, j) => {
      if (j % 2 === 0) return part
      const channel = channels.find((ch) => ch.name === part)
      const person = people.find((u) => u.name === part)
      if (channel && !person) return <span key={j} className="mx-0.5 inline-flex items-center gap-1 align-middle font-medium"><ChannelAvatar channel={channel} size={18} />{part}</span>
      if (person && !channel) return <span key={j} className="mx-0.5 inline-flex items-center gap-1 align-middle font-medium"><Avatar user={person} size={18} />{part}</span>
      return <strong key={j} className="font-semibold tabular-nums text-foreground">{part}</strong>
    })}</p>
  )}</div>
}

export function CopyAnswerButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])
  async function copyAnswer() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      toast.error('复制失败，请选中文字后手动复制')
    }
  }
  return <Button type="button" size="sm" variant="ghost" aria-label={copied ? '已复制查询回复' : '复制查询回复'} className="-mr-2 -mt-1 shrink-0 gap-1.5 text-muted-foreground" onClick={() => void copyAnswer()}>{copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}<span aria-live="polite" className="hidden sm:inline">{copied ? '已复制' : '复制'}</span></Button>
}

export function AssistantReply({ answer, question }: { answer: AssistantAnswer; question: string }) {
  const { s, channel: getChannel } = useSession()
  const { openOrder } = useNav()
  const linkedOrders = s.orders.filter((o) => answer.orders.some((link) => link.id === o.id))
  const channels = [...new Map(linkedOrders.map(o => getChannel(o.channelId)).filter((ch): ch is ChannelLabel => !!ch).map(ch => [ch.id, ch])).values()]
  const people = s.users.filter((u) => linkedOrders.some((o) => o.ownerId === u.id || o.assignees.some((a) => a.userId === u.id)))
  return <section aria-label="查询回复" className="space-y-5 rounded-2xl border bg-card p-4 font-sans md:p-6">
    <header className="flex items-start gap-2.5"><span className="rounded-lg bg-primary/10 p-2 text-primary"><Sparkle size={18} weight="duotone" /></span><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">查询结果</h2><p className="mt-0.5 break-words text-xs text-muted-foreground">{question}</p></div><CopyAnswerButton text={answer.answer} /></header>
    <AnswerText text={answer.answer} channels={channels} people={people} />
    {answer.orders.length > 0 && <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><h3 className="font-medium">相关订单 <span className="ml-1 rounded bg-muted px-1.5 py-0.5 tabular-nums">{answer.orders.length}</span></h3><span>点击查看详情</span></div>
      {answer.orders.map((link) => {
        // 使用工作台已经过权限裁剪的数据；头像和身份不依赖模型生成。
        const order = s.orders.find((o) => o.id === link.id)
        const channel = order && getChannel(order.channelId)
        const owner = s.users.find((u) => u.id === order?.ownerId)
        const writers = order?.assignees.map((a) => s.users.find((u) => u.id === a.userId)) ?? []
        return <button key={link.id} onClick={() => openOrder(link.id)} aria-label={`查看订单 ${link.no} ${link.title}`} className="group block w-full rounded-xl border bg-background/40 p-3.5 text-left transition-colors hover:border-primary/35 hover:bg-accent/50 focus-visible:outline-primary sm:p-4">
          <div className="flex items-start gap-3">
            {channel && <ChannelAvatar channel={channel} size={38} />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="break-all text-sm font-medium">{channel?.name ?? '未关联渠道'}</span>{order && <StatusPill status={order.status} />}</div>
            </div>
            <ArrowUpRight size={17} className="mt-1 shrink-0 text-muted-foreground group-hover:text-primary" />
          </div>
          <p className="mt-3 break-words text-[14px] font-medium leading-6">{link.title}</p>
          {order && <>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              <span className="inline-flex min-w-0 items-center gap-1.5"><span className="text-muted-foreground">销售</span><Avatar user={owner} size={21} /><span className="break-all">{owner?.name ?? '未指定'}</span></span>
              <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5"><span className="text-muted-foreground">写手</span>{writers.length ? writers.map((writer, i) => <span key={writer?.id ?? i} className="inline-flex items-center gap-1.5"><Avatar user={writer} size={21} /><span className="break-all">{writer?.name ?? '未指定'}</span></span>) : <span>未指定</span>}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3 text-xs">
              <span className="text-muted-foreground">截止 <span className="ml-1 text-foreground tabular-nums">{order.dueDate ?? (needsDeadline(order) ? '未设置' : '—')}</span></span>
              {order.sales !== undefined && <span className="text-muted-foreground">销售额 <strong className="ml-1 text-sm font-semibold tabular-nums text-gold">{money(order.sales)}</strong></span>}
              {order.unpaid !== undefined && <span className="text-muted-foreground">未收 <strong className="ml-1 text-sm font-semibold tabular-nums text-foreground">{money(order.unpaid)}</strong></span>}
            </div>
          </>}
        </button>
      })}
    </div>}
    {!!answer.scopes?.length && <details className="border-t pt-3 text-xs text-muted-foreground"><summary className="cursor-pointer select-none">查询口径与范围</summary><div className="mt-2 space-y-1.5 leading-5">{answer.scopes.map((scope) => <p key={scope}>{scope}</p>)}</div></details>}
  </section>
}
