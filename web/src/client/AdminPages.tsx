import { PageLoading } from './PageLoading'
import { FinancialNoteView } from './FinancialNote'
import { HeaderBar, PersonFilter, Segmented } from './controls'
import { SelectField } from './SelectField'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ClockCounterClockwise, Trash, ArrowCounterClockwise, GitBranch } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { FORUM_COPY } from '@/shared/copy/forum'
import { cn } from '@/lib/utils'
import { DataTable, TableFooter, TablePageHeader } from './table-kit'
import { Avatar, ChannelName, Empty, Person, StatusPill, inputCls } from './ui'
import { loadAudit, restoreChannel, restoreOrders, useSession } from './store'
import { relTime } from '@/shared/format'
import { WORKBENCH_RELEASES } from '@/shared/releases'
import { ReleaseNotes } from './ReleaseNotes'

export function AuditPage() {
  const [tab, setTab] = useState<'operations' | 'releases'>('operations')
  return <div className="flex h-full min-h-0 flex-col bg-card">
    <TablePageHeader title="审计日志" summary={<span className="inline-flex items-center gap-1.5"><GitBranch size={13} />{WORKBENCH_RELEASES[0].version}</span>} />
    <HeaderBar><Segmented label="日志类型" value={tab} onChange={setTab} items={[['operations', '操作记录'], ['releases', '更新日志']]} /></HeaderBar>
    {tab === 'operations' ? <AuditRecords /> : <ReleaseNotes />}
  </div>
}

function AuditRecords() {
  const { s, user } = useSession()
  const [who, setWho] = useState('')
  const [act, setAct] = useState('')
  const [showViews, setShowViews] = useState(false)
  const [next,setNext]=useState<number|null>(null)
  const [loading,setLoading]=useState(true),[error,setError]=useState(false),[revision,setRevision]=useState(0)
  const params=new URLSearchParams({actor:who,action:act,views:showViews?'1':'0'}).toString()
  useEffect(()=>{let active=true;setLoading(true);setError(false);void loadAudit(params).then(n=>{if(active)setNext(n)}).catch(()=>{if(active)setError(true)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[params,s.version,revision])
  const actions = useMemo(() => Array.from(new Set(s.audit.map((a) => a.action))), [s.audit])
  const list = s.audit.filter((a) => (!who || a.actorId === who) && (!act || a.action === act) && (showViews || act === '查看详情' || a.action !== '查看详情'))

  if(loading||error)return <div className="p-3"><PageLoading page="audit" error={error} onRetry={()=>setRevision(value=>value+1)}/></div>

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        <PersonFilter size="sm" label="按操作人" allLabel="所有人" value={who || 'all'} onChange={id => setWho(id === 'all' ? '' : id)} people={s.users.map(u => ({ id: u.id, user: u }))} />
        <span className="mx-1 h-4 w-px bg-border" />
        <SelectField aria-label="筛选操作动作" value={act} onChange={e => setAct(e.target.value)} className={cn(inputCls, 'h-8 w-auto text-xs')}><option value="">所有动作</option>{actions.map(a => <option key={a} value={a}>{actionLabel(a)}</option>)}</SelectField>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showViews} onChange={(e) => setShowViews(e.target.checked)} /> 显示查看记录
        </label>
      </div>
      <DataTable
        fill
        id="audit"
        rows={list}
        rowId={(a) => a.id}
        empty={<Empty icon={<ClockCounterClockwise size={22} />} title="没有符合条件的记录" />}
        cols={[
          { id: 'at', header: '时间', size: 130, sort: (a) => a.at, cell: (a) => <span className="num text-xs text-muted-foreground">{relTime(a.at)}</span> },
          {
            id: 'actor',
            header: '操作人',
            size: 120,
            sort: (a) => user(a.actorId)?.name ?? a.actorId,
            cell: (a) =>
              // 定时任务记 system，分享链接被渠道打开记 public
              a.actorId === 'system' || a.actorId === 'public' ? (
                <span className="text-muted-foreground">{a.actorId === 'system' ? '系统' : '外部访客'}</span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Avatar user={user(a.actorId)} size={20} /> {user(a.actorId)?.name}
                </span>
              ),
          },
          { id: 'action', header: '动作', size: 90, sort: (a) => a.action, cell: (a) => actionLabel(a.action, a.to) },
          {
            id: 'object',
            header: '对象',
            size: 220,
            filterValue: a => [a.objectLabel, a.field].filter(Boolean).join(' · '),
            cell: (a) => (
              <span className="block truncate" title={`${a.objectLabel ?? ''}${a.field ? ` · ${a.field}` : ''}`}>
                <span className={a.objectType === 'order' ? 'text-xs font-semibold tabular-nums' : ''}>{a.objectLabel}</span>
                {a.field && <span className="text-muted-foreground"> · {a.field}</span>}
              </span>
            ),
          },
          {
            id: 'diff',
            header: '改动',
            size: 340,
            filterValue: a => [a.from, a.to].filter(Boolean).join(' → '),
            cell: (a) =>
              (a.from || a.to) && (
                <span className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs" title={[a.from, a.to].filter(Boolean).join(' → ')}>
                  {a.from && <span className="truncate rounded bg-danger/10 px-1.5 py-0.5 text-danger line-through decoration-danger/40">{a.from}</span>}
                  {a.from && a.to && <span className="text-muted-foreground">→</span>}
                  {a.to && <span className="truncate rounded bg-ok/10 px-1.5 py-0.5 text-ok">{a.to}</span>}
                </span>
              ),
          },
          { id: 'note', header: '备注', size: 260, filterValue: a => a.note ?? '', cell: a => <FinancialNoteView note={a.note} proof={a.proof} /> },
        ]}
      />
      <TableFooter>{list.length} 条记录{next!==null&&<Button size="sm" variant="ghost" onClick={()=>void loadAudit(params+'&before='+next,true).then(setNext).catch(()=>toast.error('审计日志加载失败，请重试'))}>加载更多</Button>}</TableFooter>
    </div>
  )
}

export function TrashPage() {
  const { s, user, channel, role } = useSession()
  const list = s.trash
  const [tab, setTab] = useState<'orders' | 'channels'>('orders')
  const channels = role.locked ? s.trashChannels ?? [] : []
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <TablePageHeader title="回收站" summary={`${list.length} 条订单 · ${channels.length} 个渠道`} />
      {role.locked && <HeaderBar><Segmented label="回收站类型" value={tab} onChange={setTab} items={[['orders', `订单 ${list.length}`], ['channels', `渠道 ${channels.length}`]]} /></HeaderBar>}
      {role.locked && tab === 'channels' ? <DataTable fill id="trash-channels" rows={channels} rowId={ch => ch.id} empty={<Empty icon={<Trash size={22}/>} title="没有已删除渠道"/>} cols={[
        {id:'name',header:'渠道',size:240,sort:ch=>ch.name,cell:ch=><ChannelName channel={ch}/>},
        {id:'owner',header:'归属销售',size:140,filterValue:ch=>user(ch.ownerId)?.name??'',cell:ch=><Person user={user(ch.ownerId)}/>},
        {id:'deleted',header:'删除时间',size:160,sort:ch=>ch.deletedAt??'',cell:ch=><span>{relTime(ch.deletedAt!)}</span>},
        {id:'restore',header:'操作',size:100,cell:ch=><Button size="sm" variant="ghost" onClick={()=>void restoreChannel(ch.id).then(ok=>ok&&toast.success(`已恢复「${ch.name}」`))}><ArrowCounterClockwise size={14}/>恢复</Button>},
      ]}/> :
      <DataTable fill id="trash" rows={list} rowId={o => o.id} freeze={2}
        empty={<Empty icon={<Trash size={22} />} title="回收站是空的" />}
        cols={[
          { id: 'title', header: '订单名称', size: 300, sort: o => o.title, cell: o => <span className="block truncate" title={o.title}>{o.title}</span> },
          { id: 'channel', header: '渠道', size: 130, sort: o => channel(o.channelId)?.name ?? '', cell: o => <ChannelName channel={channel(o.channelId)}/> },
          { id: 'owner', header: '归属销售', size: 110, sort: o => user(o.ownerId)?.name ?? '', cell: o => <Person user={user(o.ownerId)}/> },
          { id: 'status', header: '状态', size: 100, sort: o => o.status, cell: o => <StatusPill status={o.status}/> },
          { id: 'deleted', header: '删除时间', size: 140, sort: o => o.deletedAt, cell: o => <span className="text-xs text-muted-foreground">{relTime(o.deletedAt)}</span> },
          { id: 'actions', header: '操作', size: 90, cell: o => <Button size="sm" variant="ghost" className="h-7 gap-1 text-primary" onClick={() => void restoreOrders([o.id]).then(ok => ok && toast.success(`已恢复 ${o.title}`))}><ArrowCounterClockwise size={14}/>恢复</Button> },
        ]}
      />}
      <TableFooter>{list.length} 条记录</TableFooter>
    </div>
  )
}

/** 论坛、私信的动作代码在审计日志里显示中文（《论坛文案》第 10 节） */
function actionLabel(action: string, to?: string) {
  if (action === 'forum.pin' && to === 'false') return FORUM_COPY.audit['forum.unpin']
  if (action === 'forum.like' && to === 'false') return FORUM_COPY.audit['forum.unlike']
  return FORUM_COPY.audit[action] ?? action
}
