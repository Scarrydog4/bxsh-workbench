'use client'

import { LoadingList } from '../PageLoading'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { forumPostFromPath, forumPostPath } from '../page-route'
import { ChatCircleText, MagnifyingGlass, Paperclip, Plus, PushPin } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FORUM_COPY } from '@/shared/copy/forum'
import { FORUM_CATEGORIES, type ForumCategory, type ForumPostDetail, type ForumPostSummary, type ForumSort } from '@/shared/forum'
import { Segmented } from '../controls'
import { ChoiceRail } from '@/components/ui/choice-rail'
import { usePref } from '../prefs'
import { useSession } from '../store'
import { Avatar } from '../ui'
import { listPosts, onLive } from './api'
import { CategoryIcon } from './CategoryIcon'
import { Composer } from './Composer'
import { relTime } from './format'
import { takeForumTarget, useForumTarget } from './live'
import { plainText } from './Markdown'
import { PostDetail, PrivateChip, StatusPill } from './PostDetail'

const F = FORUM_COPY.forum
type Cat = ForumCategory | 'all'

export function ForumPage() {
  const { me, role } = useSession()
  // 换账号或权限时丢掉上一个人的列表和草稿
  return <ForumPanel key={`${me.id}:${role.id}:${role.locked}`} />
}

function ForumPanel() {
  const { role } = useSession()
  const [category, setCategory] = usePref<Cat>('forum.category', 'all')
  const [sort, setSort] = usePref<ForumSort>('forum.sort', 'activity')
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ForumPostSummary[]>([])
  const [total, setTotal] = useState(0)
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [counts, setCounts] = useState<Partial<Record<Cat, number>>>({})
  const [pending, setPending] = useState(0)
  const pathname = usePathname() || '/forum', router = useRouter()
  const [selected, setSelected] = useState<string | null>(() => forumPostFromPath(pathname))
  useEffect(() => { setSelected(forumPostFromPath(pathname)) }, [pathname])
  const openPost = useCallback((id: string, replace = false) => {
    setSelected(id)
    if (pathname !== forumPostPath(id)) router[replace ? 'replace' : 'push'](forumPostPath(id), { scroll: false })
  }, [router, pathname])
  const closePost = useCallback(() => {
    setSelected(null)
    if (pathname !== '/forum') router.push('/forum', { scroll: false })
  }, [router, pathname])
  const [composer, setComposer] = useState<{ post?: ForumPostDetail; category?: ForumCategory } | null>(null)
  const [bannerSeen, setBannerSeen] = usePref<boolean>('forum.migrationSeen', false)
  const target = useForumTarget()
  const ctrl = useRef<AbortController | null>(null)

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t) }, [q])

  const load = useCallback(async (append = false, offset = 0) => {
    ctrl.current?.abort()
    const c = new AbortController(); ctrl.current = c
    if (!append) setLoading(true)
    try {
      const r = await listPosts({ category: category === 'all' ? undefined : category, q: query, sort, offset, limit: 50 }, c.signal)
      if (c.signal.aborted) return
      setRows(old => append ? [...old, ...r.rows] : r.rows); setTotal(r.total); setNext(r.next); setError('')
      if (r.pendingFeedbackCount != null) setPending(r.pendingFeedbackCount)
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : FORUM_COPY.errors.unknown) }
    finally { if (!c.signal.aborted) setLoading(false) }
  }, [category, query, sort])
  const loadCounts = useCallback(async () => {
    const all = await Promise.all((['all', ...FORUM_CATEGORIES] as Cat[]).map(c => listPosts({ category: c === 'all' ? undefined : c, limit: 1 }).then(r => [c, r.total, r.pendingFeedbackCount] as const).catch(() => null)))
    setCounts(Object.fromEntries(all.filter(Boolean).map(x => [x![0], x![1]])))
    const p = all.find(x => x?.[2] != null)?.[2]; if (p != null) setPending(p)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadCounts() }, [loadCounts])
  const refreshAll = useCallback(() => { void load(); void loadCounts() }, [load, loadCounts])
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const off = onLive('post', () => { if (t) clearTimeout(t); t = setTimeout(refreshAll, 300) })
    return () => { off(); if (t) clearTimeout(t) }
  }, [refreshAll])

  // 提醒、左下角卡片跳过来：打开指定的帖子，或者直接开始写
  useEffect(() => {
    if (!target.postId && !target.compose && !target.category) return
    const t = takeForumTarget()
    if (t.category) setCategory(t.category)
    if (t.postId) openPost(t.postId, true)
    if (t.compose) setComposer({ category: t.compose })
  }, [target, setCategory, openPost])

  // 宽屏默认打开第一条
  useEffect(() => {
    if (selected || !rows.length || typeof window === 'undefined' || window.matchMedia('(max-width: 1023px)').matches) return
    setSelected(rows[0].id)
  }, [rows, selected])

  const empty = query ? F.emptySearch(query) : category === 'all' ? F.emptyAll : F.emptyCategory(FORUM_COPY.categories[category])
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
        <h1 className="text-lg font-semibold tracking-tight">{F.title}</h1>
        <label className="flex h-8 min-w-0 flex-1 basis-48 items-center gap-1.5 rounded-md border bg-background px-2.5 text-muted-foreground sm:max-w-xs">
          <MagnifyingGlass size={15} />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={F.searchPlaceholder} aria-label={F.searchPlaceholder} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none" />
        </label>
        <Button size="sm" className="ml-auto" onClick={() => setComposer({ category: category === 'all' ? undefined : category })}><Plus size={15} />{F.newPost}</Button>
      </div>
      {!bannerSeen && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2 text-[12.5px]">
          <span className="min-w-0 flex-1">{F.migrationBanner}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setBannerSeen(true)}>{FORUM_COPY.common.gotIt}</Button>
        </div>
      )}
      <ChoiceRail role="navigation" aria-label="分类" className="scroll-hidden flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-1.5">
        {(['all', ...FORUM_CATEGORIES] as Cat[]).map(c => {
          const active = category === c
          return (
            <button key={c} type="button" aria-pressed={active} onClick={() => { setCategory(c); closePost() }}
              className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors', active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
              <CategoryIcon category={c} size={15} />
              {c === 'all' ? F.all : FORUM_COPY.categories[c]}
              {c === 'feedback' && role.locked && pending > 0
                ? <span className="rounded-full bg-warn/15 px-1.5 text-[11px] font-medium leading-4 text-warn">{F.pending(pending)}</span>
                : counts[c] != null && <span className="num text-[11px] opacity-70">{counts[c]}</span>}
            </button>
          )
        })}
      </ChoiceRail>
      {category !== 'all' && <p className="shrink-0 border-b px-4 py-1.5 text-xs text-muted-foreground">{FORUM_COPY.categoryDesc[category]}</p>}
      {error && <div role="alert" className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-sm text-danger">{error}<Button size="sm" variant="ghost" onClick={refreshAll}>{FORUM_COPY.common.retry}</Button></div>}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <section className={cn('flex min-h-0 flex-col border-r', selected && 'hidden lg:flex')} aria-label={F.title}>
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3 text-xs text-muted-foreground">
            <span className="num">{loading ? '加载中…' : F.count(total)}</span>
            <Segmented size="sm" label="排序" value={sort} onChange={setSort} items={[['activity', F.sortActivity], ['created', F.sortCreated]]} />
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {!loading && rows.length === 0 && <div className="px-6 py-12 text-center text-sm text-muted-foreground"><ChatCircleText size={26} className="mx-auto mb-2" />{empty}</div>}
            {loading && rows.length === 0 && <div role="status" aria-busy="true" className="p-3"><span className="sr-only">{FORUM_COPY.common.loading}</span><div aria-hidden="true"><LoadingList /></div></div>}
            {rows.map(p => <PostRow key={p.id} post={p} showCategory={category === 'all'} active={selected === p.id} onOpen={() => openPost(p.id)} />)}
            {next != null && <div className="p-3 text-center"><Button size="sm" variant="ghost" onClick={() => void load(true, next)}>{F.loadMore}</Button></div>}
          </div>
        </section>
        <section className={cn('scroll-thin min-h-0 overflow-y-auto', !selected && 'hidden lg:block')}>
          {selected
            ? <PostDetail key={selected} id={selected} onBack={closePost} onEdit={post => setComposer({ post })} onDeleted={() => { setSelected(null); router.replace('/forum', { scroll: false }); refreshAll() }} onChanged={refreshAll} />
            : <div className="grid h-full place-items-center p-8 text-sm text-muted-foreground">{F.pick}</div>}
        </section>
      </div>
      {composer && <Composer post={composer.post} defaultCategory={composer.category} onClose={() => setComposer(null)} onSaved={id => { setComposer(null); if (!composer.post) { setCategory('all') } openPost(id); refreshAll() }} />}
    </div>
  )
}

function PostRow({ post, showCategory, active, onOpen }: { post: ForumPostSummary; showCategory: boolean; active: boolean; onOpen: () => void }) {
  const excerpt = plainText(post.excerpt)
  return (
    <button type="button" onClick={onOpen} aria-current={active} className={cn('grid w-full grid-cols-[28px_minmax(0,1fr)] gap-2.5 border-b px-3 py-2.5 text-left transition-colors hover:bg-accent/60', active && 'bg-primary/[.07] hover:bg-primary/10')}>
      <Avatar user={post.author} size={28} />
      <div className="min-w-0">
        <div className="flex items-start gap-1.5 text-[13.5px] font-medium leading-snug">
          {post.pinned && <PushPin size={13} className="mt-0.5 shrink-0 text-primary" aria-label={F.pinned} />}
          <span className="min-w-0 break-words">{post.title}</span>
          {post.unread && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label={F.unread} />}
        </div>
        {excerpt && <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{excerpt}</div>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-muted-foreground">
          {showCategory && <span className="inline-flex items-center gap-1"><CategoryIcon category={post.category} size={12} />{FORUM_COPY.categories[post.category]}</span>}
          {post.status && <StatusPill status={post.status} />}
          {post.feedbackKind && <span>{post.feedbackKind}</span>}
          {post.private && <PrivateChip />}
          <span>{post.author.name}</span>
          <span className="inline-flex items-center gap-0.5"><ChatCircleText size={12} /><span className="num">{post.replyCount}</span></span>
          {post.attachmentCount > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip size={12} /><span className="num">{post.attachmentCount}</span></span>}
          <span className="num">{relTime(post.lastActivityAt)}</span>
        </div>
      </div>
    </button>
  )
}
