import { useEffect, useRef, useState } from 'react'
import { Segmented } from './controls'
import { ArrowClockwise, ChatCircleText, CircleNotch, Lightbulb, Sparkle } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useSession } from './store'
import { AssistantReply } from './AssistantReply'
import { useConversation } from './useConversation'
import { usePref } from './prefs'
import { cn } from '@/lib/utils'
import type { AssistantAnswer, Usage } from '@/shared/assistant'
import { IntakeFlow, aiRequest } from './AiIntake'
import { Keys, plainKey } from './shortcuts'

export function AssistantPage() {
  const { me, role, can } = useSession()
  const [savedTab, setTab] = usePref<'parse' | 'ask'>(`assistant-tab:${me.id}`, can('order.create') ? 'parse' : 'ask')
  const tab = savedTab === 'parse' && can('order.create') ? 'parse' : can('order.view') ? 'ask' : 'parse'
  const [status, setStatus] = useState<{ configured: boolean; usage?: Usage } | null>(null)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [retryQuestion, setRetryQuestion] = useState('')
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useConversation(`assistant-chat:${me.id}:${JSON.stringify(role)}`)
  const chatEnd = useRef<HTMLDivElement>(null)
  const questionInput = useRef<HTMLTextAreaElement>(null)
  // 老板只关心钱和量；销售看自己的单和款；其他人看手上的活
  const examples = me.isAdmin || role.locked
    ? ['本月净收入比上月多多少？', '本月哪个渠道贡献最多？', '近 6 个月每月接单和销售额']
    : role.fields.sales
      ? ['我本月接了多少单、多少钱？', '我名下还有多少款没收？', '按渠道汇总我本月的订单']
      : ['我有哪些订单快截止了？', '我本月完成了多少单？', '我现在有哪些进行中的订单？']
  useEffect(() => { if (turns.length) chatEnd.current?.scrollIntoView({ block: 'nearest' }) }, [turns.length])
  useEffect(() => { void aiRequest<{ configured: boolean; usage?: Usage }>('status').then(setStatus).catch(() => {}) }, [])
  useEffect(() => {
    if (tab !== 'ask') return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === '/' && plainKey(e)) { e.preventDefault(); questionInput.current?.focus() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab])

  async function askQuestion(requested?: string) {
    const q = (requested ?? question).trim()
    if (!q || pending || status?.configured === false) return
    setPending(q)
    setError('')
    setRetryQuestion('')
    try {
      const history = turns.slice(-12).map(t => ({ question: t.question, answer: (t.answer.answer.slice(0, 8000) + (t.answer.orders.length ? '\n相关订单：' + t.answer.orders.slice(0, 10).map(o => o.no).join('、') : '')).slice(0, 8000) }))
      const answer = await aiRequest<AssistantAnswer>('ask', { question: q, history })
      setTurns([...turns, { question: q, answer }])
      setQuestion((current) => current.trim() === q ? '' : current)
    } catch (e) {
      setError(e instanceof Error ? e.message : '查询失败，请重试')
      setRetryQuestion(q)
    } finally {
      setPending('')
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Sparkle size={19} weight="fill" /></div>
        <h1 className="text-xl font-semibold">智能助手</h1>
        <Segmented label="助手功能" className="ml-1 sm:ml-4" value={tab} onChange={setTab} items={[...(can('order.create') ? [['parse', '录单'] as const] : []), ...(can('order.view') ? [['ask', '问数据'] as const] : [])]} />
      </div>
      {status?.configured === false && <p role="status" className="rounded-lg bg-warn/10 px-3 py-2 text-sm">智能助手还没配置，请联系管理员。手动录单不受影响。</p>}
      {can('order.create') && <div id="assistant-panel-parse" role="tabpanel" aria-label="录单" hidden={tab !== 'parse'}><IntakeFlow /></div>}
      {can('order.view') && <div id="assistant-panel-ask" role="tabpanel" aria-label="问数据" hidden={tab !== 'ask'} className="space-y-5">
        {turns.length > 0 && <div className="flex justify-end"><Button size="sm" variant="ghost" disabled={!!pending} onClick={() => { setTurns([]); setQuestion(''); setError(''); setRetryQuestion('') }}>新对话</Button></div>}
        {!turns.length && !pending && <section aria-labelledby="assistant-examples-title" className="grid gap-4 rounded-2xl border border-dashed bg-card/60 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Lightbulb size={17} /></span>
            <div><h2 id="assistant-examples-title" className="text-sm font-semibold">可以这样问</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">直接说人话，只查你能看的数据。</p></div>
          </div>
          <div role="group" aria-label="示例问题" className="grid gap-2 sm:grid-cols-3">
            {examples.map((example) => <button key={example} type="button" data-assistant-example={example} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-left text-xs leading-5 text-muted-foreground transition-[border-color,color,background-color] hover:border-primary/35 hover:bg-accent hover:text-foreground" onClick={() => { setQuestion(example); questionInput.current?.focus() }}>{example}</button>)}
          </div>
        </section>}
        <div className="space-y-4">{turns.map((t, i) => <AssistantReply key={i} answer={t.answer} question={t.question} />)}<div ref={chatEnd} /></div>
        {pending && <section role="status" aria-live="polite" aria-label="正在查询" className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex items-start gap-3"><CircleNotch size={18} className="mt-0.5 shrink-0 animate-spin text-primary" /><div className="min-w-0"><h2 className="text-sm font-semibold">正在查询，请稍候</h2><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{pending}</p></div></div>
          <div className="grid gap-2" aria-hidden="true"><div className="h-2 w-3/4 animate-pulse rounded bg-muted" /><div className="h-2 w-1/2 animate-pulse rounded bg-muted" /></div>
        </section>}
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"><span className="min-w-0 flex-1 break-words">{error}</span>{retryQuestion && !pending && <Button type="button" size="sm" variant="ghost" className="gap-1.5 px-2 text-destructive hover:text-destructive" onClick={() => void askQuestion(retryQuestion)}><ArrowClockwise size={15} />重试</Button>}</div>}
        <form aria-busy={!!pending} onSubmit={(e) => { e.preventDefault(); void askQuestion() }} className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm">
          <textarea ref={questionInput} id="ai-question" aria-label="问题" aria-describedby="ai-question-hint" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void askQuestion() } }} rows={3} maxLength={1500} className="w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground/70" placeholder={turns.length ? '接着问' : '想查什么？'} />
          <div className="flex flex-wrap items-center gap-2">
            <span id="ai-question-hint" className="mr-auto text-xs text-muted-foreground">{pending ? '查询中，可以先写下一句' : <span className="hidden items-center gap-1.5 sm:inline-flex"><Keys keys={['/']} />输入<Keys keys={['⌘', '↵']} className="ml-2 inline-flex gap-1" />查询</span>}</span>
            <Button type="submit" disabled={!!pending || !question.trim() || status?.configured === false} className="gap-1.5">{pending ? <><CircleNotch size={15} className="animate-spin" />查询中</> : <>查询<ChatCircleText size={15} /></>}</Button>
          </div>
        </form>
      </div>}
      {role.locked && status?.usage && <p className="text-xs text-muted-foreground/70">本月调用 {status.usage.calls} 次 · 估算 ¥{status.usage.estimatedCny.toFixed(2)}</p>}
    </div>
  )
}
