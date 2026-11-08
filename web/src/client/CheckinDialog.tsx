'use client'

import { fuzzyMatch } from '@/shared/search'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarCheck, Camera, CaretLeft, CaretRight, CheckCircle, Clock, SpinnerGap } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Calendar, fromDay, toDay } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { AppDialogBody, AppDialogContent } from '@/components/ui/app-dialog'
import { businessDate } from '@/shared/format'
import { CHECKIN_LABELS, type CheckinKind, type CheckinRecord, type CheckinList, type CheckinResult } from '@/shared/checkin'
import type { CheckinRequestList } from '@/shared/checkin-requests'
import { CheckinCamera } from './CheckinCamera'
import { CheckinRequests } from './CheckinRequests'
import { Thumbs } from './ImageViewer'
import { cn } from '@/lib/utils'
import { Segmented } from './controls'
import { Avatar } from './ui'
import { useSession } from './store'
import { DataTable, type Col } from './table-kit'

const time = (at: string) => new Date(at).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
const monthLabel = (month: string) => `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`
function shiftMonth(month: string, offset: number) {
  const date = toDay(`${month}-01`)
  date.setMonth(date.getMonth() + offset)
  return fromDay(date).slice(0, 7)
}
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? '暂时无法读取，请重试')
  return body
}

export function CheckinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { me, role } = useSession()
  const [scope, setScope] = useState<'mine' | 'team' | 'requests'>(() => role.locked ? 'team' : 'mine')
  const [period, setPeriod] = useState<'today' | 'month'>('today')
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [teamSearch, setTeamSearch] = useState('')
  const [month, setMonth] = useState(() => businessDate(new Date()).slice(0, 7))
  const [selected, setSelected] = useState(() => businessDate(new Date()))
  const [data, setData] = useState<CheckinList | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [capture, setCapture] = useState<{ kind: 'in' | 'out'; day: string; photo: string } | null>(null)
  const [cameraKind, setCameraKind] = useState<'in' | 'out' | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const saving = useRef(false)
  const requestVersion = useRef(0)
  const today = data?.today ?? businessDate(new Date())
  const activeScope = scope === 'team' && !role.locked ? 'mine' : scope
  const current = data?.todayRecord
  const finished = !!current?.clockOutAt
  const onBreak = !!current?.breakStartAt && !current.breakEndAt
  const photographing = !!cameraKind || !!capture

  useEffect(() => {
    if (!open || activeScope === 'requests') return
    const controller = new AbortController(), version = ++requestVersion.current
    setLoading(true); setError(''); setData(null)
    call<CheckinList>(`/api/checkins?${new URLSearchParams({ month, scope: activeScope })}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted && version === requestVersion.current) setData(result) })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '网络连接失败，请重试') })
      .finally(() => { if (!controller.signal.aborted && version === requestVersion.current) setLoading(false) })
    return () => controller.abort()
  }, [open, month, activeScope, refresh, me.id])

  useEffect(() => {
    if (!open || !role.locked || activeScope !== 'team') return
    const controller = new AbortController()
    setPendingCount(null)
    call<CheckinRequestList>('/api/checkin-requests?scope=team&status=pending&limit=1', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPendingCount(result.total) })
      .catch(() => { /* 数量读取失败时保留空值，仍可进入申请审批重试。 */ })
    return () => controller.abort()
  }, [open, activeScope, refresh, me.id, role.locked])

  // 回到页面时刷新服务器日期；跨午夜或另一台设备打过卡时，按钮状态也能及时更新。
  useEffect(() => {
    if (!open || cameraKind || capture) return
    const update = () => { if (document.visibilityState === 'visible' && !saving.current) setRefresh(n => n + 1) }
    const interval = window.setInterval(update, 60_000)
    window.addEventListener('focus', update)
    return () => { clearInterval(interval); window.removeEventListener('focus', update) }
  }, [open, cameraKind, capture])

  useEffect(() => { setCameraKind(null); setCapture(null) }, [open, activeScope])

  const rows = data?.rows ?? []
  const checkedDays = useMemo(() => rows.map(row => toDay(row.day)), [rows])
  const chosen = rows.find(row => row.day === selected)
  const teamRows = rows.filter(row => period === 'month' || row.day === today)
  const visibleTeamRows = teamRows.filter(row => (!onlyIssues || hasIssue(row, today)) && fuzzyMatch(row.name, teamSearch))
  const cols: Col<CheckinRecord>[] = useMemo(() => [
    { id: 'person', header: '员工', size: 160, sort: row => row.name, cell: row => <span className="flex items-center gap-2"><Avatar user={{ id: row.userId, name: row.name, hue: row.hue, avatar: row.avatar }} /><span>{row.name}</span></span> },
    { id: 'day', header: '日期', size: 130, sort: row => row.day, cell: row => <span className="tabular-nums">{row.day}</span> },
    { id: 'in', header: '上班', size: 120, sort: row => row.clockInAt, filterValue: row => time(row.clockInAt), cell: row => <span className="tabular-nums">{time(row.clockInAt)}</span> },
    { id: 'out', header: '下班', size: 120, sort: row => row.clockOutAt ?? '', filterValue: row => row.clockOutAt ? time(row.clockOutAt) : '—', cell: row => row.clockOutAt ? <span className="tabular-nums">{time(row.clockOutAt)}</span> : <span className="text-muted-foreground">—</span> },
    { id: 'breakStart', header: '午休离场', size: 120, sort: row => row.breakStartAt ?? '', cell: row => row.breakStartAt ? time(row.breakStartAt) : '—' },
    { id: 'breakEnd', header: '午休返回', size: 120, sort: row => row.breakEndAt ?? '', cell: row => row.breakEndAt ? time(row.breakEndAt) : '—' },
    { id: 'break', header: '午休时长', size: 130, sort: row => row.breakMinutes ?? 0, cell: row => row.breakMinutes === null ? '—' : <span className={row.breakOvertimeMinutes > 0 ? 'text-warning' : ''}>{minutes(row.breakMinutes)}{!row.breakEndAt && ' · 休息中'}</span> },
    { id: 'overtime', header: '晚间在岗', size: 130, sort: row => row.overtimeMinutes ?? 0, cell: row => row.overtimeMinutes === null ? '下班后统计' : minutes(row.overtimeMinutes) },
    { id: 'status', header: '情况', size: 140, sort: row => status(row, today), cell: row => <span className={cn('text-xs', hasIssue(row, today) ? 'text-warning' : 'text-muted-foreground')}>{status(row, today)}</span> },
    { id: 'photos', header: '打卡照片', size: 130, cell: row => <Thumbs pics={photos(row)} imgClass="h-9 w-9" /> },
  ], [today])

  async function checkIn(kind: CheckinKind) {
    if (saving.current || finished) return
    const needsPhoto = kind === 'in' || kind === 'out'
    if (needsPhoto && (!capture || capture.kind !== kind)) return
    if (capture && capture.day !== businessDate(new Date())) {
      setCapture(null); setRefresh(n => n + 1); setError('日期已变更，请重新拍照打卡'); return
    }
    saving.current = true; setBusy(true); setError('')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const result = await call<CheckinResult>('/api/checkins', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, ...(needsPhoto ? { photo: capture!.photo } : {}) }) })
      setSelected(result.record.day); setMonth(result.record.day.slice(0, 7)); setCapture(null)
      setRefresh(n => n + 1)
      toast.success(result.created ? `${CHECKIN_LABELS[kind]}已记录` : '这次打卡已经记录，无需重复提交')
    } catch (e) {
      setError(controller.signal.aborted ? '提交结果暂未确认，请刷新记录核对后再操作' : e instanceof Error ? e.message : '网络连接失败，请重试')
    }
    finally { clearTimeout(timeout); saving.current = false; setBusy(false) }
  }

  return <Dialog open={open} onOpenChange={value => { if (!saving.current) onOpenChange(value) }}>
    <AppDialogContent size="lg" data-checkin-dialog className="[&>button]:z-20 [&>button]:h-9 [&>button]:w-9 [&>button]:grid [&>button]:place-items-center [&>button]:right-2 [&>button]:top-2">
      <div className="flex shrink-0 items-center gap-2.5 border-b px-4 py-4 pr-14">
        <CalendarCheck size={21} className="text-primary" />
        <DialogTitle className="text-base">{photographing ? `${CHECKIN_LABELS[cameraKind ?? capture!.kind]}拍照` : role.locked ? '出勤管理' : '上下班打卡'}</DialogTitle>
      </div>
      <DialogDescription className="sr-only">上下班现场拍照，午休离场和返回点一下记录。所有记录按北京时间保存。</DialogDescription>
      {photographing ? <AppDialogBody className="p-4 sm:mx-auto sm:w-full sm:max-w-lg">
        <div className="mb-3 flex items-center gap-2"><Avatar user={me} size={28} /><span className="text-sm font-medium">{me.name}</span><span className="ml-auto text-xs text-muted-foreground">现场拍照 · 不存相册</span></div>
        {cameraKind ? <CheckinCamera onCancel={() => setCameraKind(null)} onCapture={photo => { setCapture({ kind: cameraKind, day: today, photo }); setCameraKind(null) }} /> : capture && <>
          <img src={capture.photo} alt="本次打卡照片预览" className="max-h-[48dvh] w-full rounded-xl border bg-black object-contain" />
          <div className="sticky bottom-0 flex gap-2 bg-background pt-3 pb-1">
            <Button variant="outline" className="h-12" disabled={busy} onClick={() => { setCameraKind(capture.kind); setCapture(null) }}><Camera size={18} />重拍</Button>
            <Button className="h-12 flex-1" onClick={() => void checkIn(capture.kind)} disabled={loading || busy || !data}>{busy ? <SpinnerGap size={17} className="animate-spin" /> : <CalendarCheck size={18} />}{busy ? '正在提交…' : `确认${CHECKIN_LABELS[capture.kind]}打卡`}</Button>
          </div>
          <button type="button" disabled={busy} className="mt-1 min-h-10 w-full text-sm text-muted-foreground" onClick={() => setCapture(null)}>取消本次打卡</button>
        </>}
      </AppDialogBody> : <>
      <div className="shrink-0 border-b px-3 py-2"><Segmented label="打卡范围" className="[&_button]:min-h-10" value={activeScope} onChange={setScope} items={[...(role.locked ? [["team", '团队出勤'] as const] : []), ["mine", '我的打卡'], ["requests", role.locked ? '申请审批' : '请假 / 申请']]} /></div>
      <AppDialogBody data-checkin-scroll className={activeScope === 'mine' ? 'sm:mx-auto sm:w-full sm:max-w-lg' : undefined}>
      {activeScope === 'mine' && <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground"><span>工作日 <b className="font-medium text-foreground">10:00–20:00</b></span><span>午休自选 · 最多90分钟</span></div>}
      {activeScope === 'requests' ? <CheckinRequests /> : activeScope === 'mine' ? <>
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2.5"><Avatar user={me} size={34} /><div className="min-w-0"><p className="text-sm font-semibold break-words">{me.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{today} · 北京时间</p></div><span className="ml-auto shrink-0 rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{finished ? '已下班' : onBreak ? '午休中' : current ? '在岗' : '尚未上班'}</span></div>
          <LiveClock />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Punch label="上班" at={current?.clockInAt} abnormal={!!current?.late} />
            <Punch label="下班" at={current?.clockOutAt} abnormal={!!current?.earlyLeave} />
          </div>
          {current && <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs"><span>午休 {current.breakStartAt ? `${time(current.breakStartAt).slice(0, 5)} → ${current.breakEndAt ? time(current.breakEndAt).slice(0, 5) : '休息中'}` : '未使用'}</span><span className={current.breakOvertimeMinutes > 0 ? 'text-warning' : 'text-muted-foreground'}>{current.breakMinutes === null ? '可自行安排' : `${minutes(current.breakMinutes)}${current.breakOvertimeMinutes > 0 ? ' · 超时' : ''}`}</span></div>}
          {!finished && <div className="mt-4 space-y-2">
            {current && !current.breakEndAt && <Button className="h-12 w-full" variant={onBreak ? 'default' : 'outline'} disabled={loading || busy || !data} onClick={() => void checkIn(onBreak ? 'break-end' : 'break-start')}>{busy ? <SpinnerGap size={18} className="animate-spin" /> : <Clock size={19} />}{onBreak ? '结束午休 · 我已返回' : '开始午休'}</Button>}
            {!onBreak && <Button className="h-12 w-full gap-2" disabled={loading || busy || !data} onClick={() => { setError(''); setCameraKind(current ? 'out' : 'in') }}><Camera size={21} weight="duotone" />{current ? '下班打卡' : '上班打卡'}</Button>}
          </div>}
          {finished && <div role="status" className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-primary/5 p-3 text-sm text-primary"><span className="inline-flex items-center gap-2"><CheckCircle size={20} weight="fill" />上、下班均已记录</span><Thumbs pics={photos(current)} imgClass="h-10 w-10" /></div>}
          {current?.isWorkday && !finished && <p className="mt-2 text-xs text-muted-foreground">下班时间20:00。需提前离开，可到「请假 / 申请」说明。</p>}
          {finished && <p className="mt-2 text-xs text-muted-foreground">20点后实际在岗 {minutes(current.overtimeMinutes ?? 0)} · 金额由老板核定</p>}
        </div>
        <details className="mt-3 border-t px-5 py-3 text-xs text-muted-foreground"><summary className="cursor-pointer text-sm text-foreground">出勤约定</summary><div className="mt-2 space-y-2 leading-relaxed"><p>工作日10:00–20:00；午休时间自选，离场与返回都要打卡，休息不超过90分钟。上、下班需现场拍照。</p><p>晚到、早退、请假、加班和周末出勤，请先到「请假 / 申请」说明安排。打卡保留真实时间，审批单独记录。</p><p>写手晚间加班参考15元/小时，平台记录20点后实际在岗时长，金额由老板核定。周末按工作日时间出勤参考100元，12点后上班参考50元；20点后额外计时。销售奖金由老板另行确定。</p></div></details>
        <details className="group border-t">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-medium">打卡记录 <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">{monthLabel(month)} · {loading ? '…' : rows.length}天<CaretRight className="transition-transform group-open:rotate-90" size={14} /></span></summary>
          <div className="px-5 pb-3" aria-busy={loading}>
            <Calendar mode="single" required selected={toDay(selected)} month={toDay(`${month}-01`)} onMonthChange={date => setMonth(fromDay(date).slice(0, 7))} onSelect={date => { const key = fromDay(date); setSelected(key); setMonth(key.slice(0, 7)) }}
              today={toDay(today)} endMonth={toDay(today)} disabled={{ after: toDay(today) }}
              modifiers={{ checked: checkedDays }} modifiersClassNames={{ checked: '[&>button]:bg-primary/10 [&>button]:font-medium [&>button]:text-primary' }}
              classNames={{ day_button: 'relative my-0.5 h-10 w-full max-w-10 rounded-lg tabular-nums outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none', selected: '[&>button]:ring-2 [&>button]:ring-primary [&>button]:ring-offset-1 [&>button]:ring-offset-background', today: '[&>button]:font-bold [&>button]:underline [&>button]:underline-offset-4' }} />
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />有打卡记录</span><button type="button" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today) }} className="rounded px-2 py-1 text-primary hover:bg-accent">今天</button></div>
          </div>
          <div className="border-t px-5 py-3 text-sm" aria-live="polite"><div className="mb-2 flex items-center gap-2"><Clock size={16} className="text-muted-foreground" /><span className="tabular-nums">{selected}</span></div>{loading ? '读取中…' : chosen ? <><div className="grid grid-cols-2 gap-3"><Punch label="上班" at={chosen.clockInAt} abnormal={chosen.late} /><Punch label="下班" at={chosen.clockOutAt} abnormal={chosen.earlyLeave} /></div><Thumbs className="mt-3" pics={photos(chosen)} imgClass="h-16 w-20" /></> : <span className="text-muted-foreground">暂无打卡记录</span>}</div>
        </details>
      </> : <>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <Segmented label="团队出勤日期" value={period} onChange={value => { setPeriod(value); setOnlyIssues(false); if (value === 'today') setMonth(today.slice(0, 7)) }} items={[["today", '今天'], ["month", '按月查看']]} className="[&_button]:min-h-10" />
          {period === 'month' ? <div className="flex items-center gap-1"><Button size="icon" variant="ghost" aria-label="上一月" onClick={() => setMonth(shiftMonth(month, -1))}><CaretLeft size={16} /></Button><span className="min-w-28 text-center text-sm font-medium">{monthLabel(month)}</span><Button size="icon" variant="ghost" aria-label="下一月" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}><CaretRight size={16} /></Button></div> : <span className="text-xs text-muted-foreground">{today} · 北京时间</span>}
        </div>
        <div className="grid grid-cols-2 gap-y-3 border-b py-3 sm:grid-cols-4 sm:divide-x">
          <Metric label={period === 'today' ? '已上班' : '出勤人次'} value={loading ? '—' : `${teamRows.length}`} />
          <Metric label={period === 'today' ? '在岗 / 午休' : '有记录员工'} value={loading ? '—' : period === 'today' ? `${teamRows.filter(row => !row.clockOutAt && (!row.breakStartAt || row.breakEndAt)).length} / ${teamRows.filter(row => !row.clockOutAt && row.breakStartAt && !row.breakEndAt).length}` : `${new Set(teamRows.map(row => row.userId)).size}`} />
          <button type="button" aria-pressed={onlyIssues} onClick={() => setOnlyIssues(v => !v)} className={cn('rounded-md hover:bg-accent/50', onlyIssues && 'bg-warning/10')}><Metric label="需核对" value={loading ? '—' : `${teamRows.filter(row => hasIssue(row, today)).length}`} warning /></button>
          <button type="button" onClick={() => setScope('requests')} className="rounded-md hover:bg-accent/50" aria-label={`查看待审批申请${pendingCount === null ? '' : `，${pendingCount}条`}`}><Metric label="待审批 · 全部日期" value={pendingCount === null ? '—' : `${pendingCount}`} warning={!!pendingCount} /></button>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 py-2 text-xs text-muted-foreground"><span>{onlyIssues ? '已筛选：迟到、早退、午休超时或历史缺卡' : '仅统计已打卡记录；未打卡不自动认定缺勤'}</span>{onlyIssues && <button type="button" className="shrink-0 p-2 text-primary" onClick={() => setOnlyIssues(false)}>查看全部</button>}</div>
        <div className="px-4 pb-3 sm:hidden"><input aria-label="搜索考勤员工" placeholder="搜索员工" value={teamSearch} onChange={e => setTeamSearch(e.target.value)} className="h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" /></div>
        <div className="hidden h-[min(52dvh,460px)] min-h-64 flex-col overflow-hidden sm:flex" aria-busy={loading}>
          <DataTable id={`checkins-team:${me.id}`} cols={cols} rows={visibleTeamRows} rowId={row => row.id} fill defaultVisibility={{ breakStart: false, breakEnd: false, break: false, overtime: false }} empty={<div role="status" className="flex min-h-40 flex-1 items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground">{loading ? '正在读取打卡记录…' : onlyIssues ? '没有需要核对的打卡记录' : period === 'today' ? '今天还没有人打卡' : '这个月还没有打卡记录'}</div>} />
        </div>
        <div className="divide-y sm:hidden" aria-busy={loading}>{loading ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">正在读取打卡记录…</p> : visibleTeamRows.length ? visibleTeamRows.map(row => <TeamCard key={row.id} row={row} today={today} />) : <p className="px-4 py-8 text-center text-sm text-muted-foreground">{onlyIssues || teamSearch ? '没有符合条件的记录' : '暂无打卡记录'}</p>}</div>
      </>}
      </AppDialogBody>
      </>}
      {busy && <p role="status" className="shrink-0 border-t px-5 py-3 text-sm text-muted-foreground">正在提交打卡，确认结果后即可关闭…</p>}
      {error && activeScope !== 'requests' && <div role="alert" className="flex items-center justify-between gap-2 border-t px-5 py-3 text-sm text-danger"><span>{error}</span><Button size="sm" variant="outline" onClick={() => setRefresh(n => n + 1)}>刷新</Button></div>}
    </AppDialogContent>
  </Dialog>
}

function hasIssue(row: CheckinRecord, today: string) {
  return row.late || row.earlyLeave || row.breakOvertimeMinutes > 0 || (row.day < today && !row.clockOutAt)
}
function status(row: CheckinRecord, today: string) {
  const presence = row.clockOutAt ? '已下班' : row.day < today ? '缺下班卡' : row.breakStartAt && !row.breakEndAt ? '午休中' : '在岗'
  return [presence, !row.isWorkday && '周末出勤', row.late && '迟到', row.earlyLeave && '早退', row.breakOvertimeMinutes > 0 && '午休超时'].filter(Boolean).join(' · ')
}
function minutes(value: number) {
  const total = Math.floor(Math.max(0, value))
  if (value > 0 && total === 0) return '不足1分钟'
  return total >= 60 ? `${Math.floor(total / 60)}小时${total % 60 ? `${total % 60}分钟` : ''}` : `${total}分钟`
}
function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className="px-2 text-center"><p className="text-xs text-muted-foreground">{label}</p><p className={cn('mt-1 text-xl font-semibold tabular-nums', warning && 'text-warning')}>{value}</p></div>
}
function TeamCard({ row, today }: { row: CheckinRecord; today: string }) {
  return <article className="px-4 py-3">
    <div className="flex items-center gap-2"><Avatar user={{ id: row.userId, name: row.name, hue: row.hue, avatar: row.avatar }} size={30} /><strong className="min-w-0 flex-1 break-words text-sm">{row.name}</strong><span className="text-xs tabular-nums text-muted-foreground">{row.day}</span></div>
    <div className="mt-2 grid grid-cols-2 gap-2"><Punch label="上班" at={row.clockInAt} abnormal={row.late} /><Punch label="下班" at={row.clockOutAt} abnormal={row.earlyLeave} /></div>
    <p className={cn('mt-2 text-xs', hasIssue(row, today) ? 'text-warning' : 'text-muted-foreground')}>{status(row, today)}</p>
    <details className="mt-2 text-xs"><summary className="min-h-9 cursor-pointer py-2 text-primary">午休、晚间时长与照片</summary><div className="space-y-2 rounded-lg bg-muted/30 p-3"><p>午休：{row.breakStartAt ? `${time(row.breakStartAt).slice(0, 5)}—${row.breakEndAt ? time(row.breakEndAt).slice(0, 5) : '进行中'}` : '未使用'}{row.breakMinutes !== null && ` · ${minutes(row.breakMinutes)}`}</p><p>20点后在岗：{row.overtimeMinutes === null ? '下班后统计' : minutes(row.overtimeMinutes)}</p><Thumbs pics={photos(row)} imgClass="h-14 w-16" /></div></details>
  </article>
}
function photos(row: CheckinRecord) {
  return [{ src: row.clockInPhoto, name: `${row.name}-${row.day}-上班照片` }, ...(row.clockOutPhoto ? [{ src: row.clockOutPhoto, name: `${row.name}-${row.day}-下班照片` }] : [])]
}
function Punch({ label, at, abnormal }: { label: '上班' | '下班'; at?: string | null; abnormal: boolean }) {
  return <div className={cn('rounded-lg border p-3', at && 'border-primary/20 bg-primary/5')}><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{label}</span>{at && <span className={abnormal ? 'text-warning' : 'text-primary'}>{abnormal ? label === '上班' ? '迟到' : '早退' : '正常'}</span>}</div><div className="mt-1 text-base font-medium tabular-nums">{at ? time(at) : '—'}</div></div>
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer) }, [])
  return <div className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{time(now.toISOString())}</div>
}
