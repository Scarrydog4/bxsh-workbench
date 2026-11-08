import { fuzzyMatch } from '@/shared/search'
import { useDeleteOrders } from './useDeleteOrders'
import { OrderProgress } from './OrderProgress'
import { isInitialDeliveryPending, needsDeadline } from '@/shared/order-deadline'
import { Segmented } from './controls'
import { OrderBadges } from './OrderUrgency'
import { writerInitialDone, writerGroupDone } from '@/shared/writer-stages'
import { DeliverButton } from './DeliverButton'
import { VirtualTableBody } from './VirtualTableBody'
import { Due } from './Due'
import { isStale, takeOrdersView } from './orders-shortcut'
import { SalesModeBadge } from './SalesModeBadge'
import { PersonChoice } from './PersonChoice'
import { SelectField } from './SelectField'
import { orderListSummary } from '@/shared/order-list-summary'
import { ORDER_DEFAULT_COLUMNS, migrateOrderDefaultColumns } from '@/shared/table-default-layouts'
import { unpaidOrders } from '@/shared/unpaid-export'
import { downloadUnpaid } from './ChannelExport'
import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Cell,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { arrayMove } from '@dnd-kit/sortable'
import {
  MagnifyingGlass,
  ArrowUp,
  ArrowDown,
  DownloadSimple,
  Trash,
  CircleNotch,
  X,
  BookmarkSimple,
  ClipboardText,
  CaretDown,
  IdentificationCard,
  Hash,
  TextAa,
  CalendarBlank,
  UserCircle,
  Users,
  Storefront,
  CheckCircle,
  Chats,
  Wrench,
  Receipt,
  FileText,
  Tag,
  Table,
  Check,
  ArrowLeft,
  ArrowRight,
  ArrowLineLeft,
  ArrowsHorizontal,
  PushPin,
  PushPinSlash,
  EyeSlash,
} from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OrderView, Role, PermKey } from '@/shared/types'
import type { ChannelLabel } from '@/shared/channel-access'
import { AvatarStack, ChannelAvatar, ChannelName, Empty, Money, PayPill, StatusPill, Person, inputCls } from './ui'
import { useFreshOrders } from './orders-seen'
import { addAttachments, bulkStatus, bulkWriters, updateOrder, useOrderTableSession, useSession } from './store'
import { hasFiles } from './files'
import { AfterSaleChip, afterSaleRank, openAfterSale } from './AfterSale'
import { FreezeHandle, ResizeHandle, freezeHost, freezeLayout, frozenCell, useFreeze } from './table-kit'
import { ColumnDrag, MovableHeader } from './ColumnDrag'
import { ColumnSettings } from './ColumnSettings'
import { TableFilterPopover } from './TableFilterPopover'
import { tableFilterActive, type TableFilter, type TableFilterField } from './table-filters'
import { businessDate, daysUntil, money, shortDate } from '@/shared/format'
import { usePref, useDevicePref } from './prefs'
import { receiptMatches, type ReceiptFilter } from '@/shared/reconciliation'
import { Payments } from './OrderDrawer'
import { isFresh } from './fresh'
import dynamic from 'next/dynamic'
const KanbanBoard=dynamic(()=>import('./Kanban').then(m=>m.KanbanBoard))
const ManualList=dynamic(()=>import('./Kanban').then(m=>m.ManualList))
import { useNav } from './nav'

interface View {
  id: string
  name: string
  status?: string[]
  pay?: 'unpaid'
  due?: boolean
  missingDue?: boolean
  /** 下单超 30 天仍未交付 */
  stale?: boolean
  aftersale?: boolean
  payPending?: boolean
  /** 待结算：工资已到发放条件还没结清，或提成已收齐还没结清 */
  settle?: boolean
  custom?: boolean
  query?: string
  channelIds?: string[]
  receipt?: ReceiptFilter
}

const BUILTIN: View[] = [
  { id: 'all', name: '全部' },
  { id: 'undelivered', name: '未交付', status: ['未交付', '已发演示'] },
  { id: 'unpaid', name: '待收款', pay: 'unpaid' },
  { id: 'due', name: '即将截止', due: true },
  { id: 'missingDue', name: '截止未填', missingDue: true },
  { id: 'stale', name: '超 30 天未交付', stale: true },
  { id: 'aftersale', name: '跟进中', aftersale: true },
  { id: 'paypending', name: '工资未定', payPending: true },
  { id: 'settle', name: '待结算', settle: true },
]

const RECEIPT_FILTERS: [ReceiptFilter, string][] = [['all', '全部'], ['noRecord', '无收款记录'], ['unreceived', '尚未收到款'], ['partial', '部分收款'], ['paid', '已收齐'], ['overpaid', '多收']]

export function availableOrderViews(saved: View[], role: Role, allowed: (perm: PermKey) => boolean) {
  return [...BUILTIN, ...saved].filter(v => (!v.pay && (!v.receipt || v.receipt === 'all') || role.locked || role.fields.sales) && (!v.payPending || allowed('order.assign')) && (!v.settle || allowed('settle.manage')))
}

export function matchesOrderView(v: OrderView, filter: View, labels = '') {
  if (filter.status?.length && !filter.status.includes(v.status)) return false
  if (filter.channelIds?.length && !filter.channelIds.includes(v.channelId)) return false
  if (filter.receipt && filter.receipt !== 'all' && !receiptMatches(v, filter.receipt)) return false
  if (filter.pay === 'unpaid' && (!(v.unpaid && v.unpaid > 0) || v.status === '退单')) return false
  if (filter.missingDue && !needsDeadline(v)) return false
  if (filter.stale && !isStale(v)) return false
  if (filter.aftersale && !openAfterSale(v)) return false
  if (filter.payPending && (!v.payPending || v.status === '退单')) return false
  if (filter.due) { const d = daysUntil(v.dueDate); if (d === null || d > 7 || writerInitialDone(v) || ['已发演示', '已交付', '退单', '待发客户'].includes(v.status)) return false }
  if (filter.settle && (v.status === '退单' || !((v.writerAvailable ?? 0) > 0 || v.salesSettle !== undefined && v.salesSettle !== '已结算' && v.payStatus === '已收齐' && (v.commission ?? 0) > 0))) return false
  const query = filter.query?.trim().toLowerCase()
  return fuzzyMatch([v.no, v.title, v.channelNo, v.type, labels], query ?? '')
}

const DEFAULT_COLUMNS = ORDER_DEFAULT_COLUMNS
const DEFAULT_VISIBILITY:VisibilityState=Object.fromEntries(['progressNote','aftersale','type','owner','received','payStatus','writerTotal','myPay','commission','bossIncome','channelNo','wechatGroup','draftAt','creator'].map(id=>[id,false]))

const col = createColumnHelper<OrderView>()
const columnIcons: Record<string, typeof Hash> = {
  no: Hash, title: TextAa, status: CheckCircle, aftersale: Wrench,
  channel: Storefront, type: Tag, owner: UserCircle, assignees: Users,
  dueDate: CalendarBlank, orderDate: CalendarBlank, draftAt: FileText,
  payStatus: Receipt, channelNo: Hash,
  wechatGroup: Chats, creator: UserCircle, receiptAction: Receipt,
}

function OrderProgressCell({ row }: { row: { original: OrderView } }) { return <OrderProgress v={row.original}/> }

// 固定组件身份：刷新订单时保留交付面板及尚未确认的截图。
function OrderDeliveryCell({ row }: { row: { original: OrderView } }) {
  const { can, me, role } = useSession()
  const [deliveryBusy, setDeliveryBusy] = useState(false)
  const v = row.original
  const mine = role.locked || v.assignees.some(a => a.userId === me.id)
  return <div className="flex items-center gap-1"><StatusPill status={v.status} />{can('order.draft') && mine && (deliveryBusy || (!writerGroupDone(v, role.locked ? undefined : me.id) && v.status !== '退单' && !openAfterSale(v))) && <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover/tr:opacity-100 has-[[data-state=open]]:opacity-100"><DeliverButton kind="draft" orderId={v.id} no={v.no} onBusyChange={setDeliveryBusy} variant="ghost" className={ROW_ACTION} /></span>}</div>
}

/** 筛选只用当前可见订单的渠道标签；写手不需要渠道库访问权限。 */
export function orderFilterChannels(orders: readonly Pick<OrderView, 'channelId'>[], labels: readonly ChannelLabel[]): ChannelLabel[] {
  const ids = new Set(orders.map(order => order.channelId))
  return [...new Map(labels.filter(label => ids.has(label.id)).map(({ id, name, avatar }) => [id, { id, name, avatar }])).values()]
}

export function OrdersPage() {
  const deletion = useDeleteOrders()
  const reduceMotion = useReducedMotion()
  const { views, s, can, me, user, channel } = useOrderTableSession()
  const filterChannels = useMemo(() => orderFilterChannels(views, s.orderChannels ?? []), [views, s.orderChannels])
  const { openOrder: open, cards } = useNav()
  const [savedViews, setSavedViews] = usePref<View[]>(`views:${me.id}`, [])
  const [viewId, setViewId] = useState('all')
  const [specialF, setSpecialF] = useState<Partial<View>>({})
  const [headerMenu, setHeaderMenu] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<ReceiptFilter>('all')
  const [query, setQuery] = useState('')
  const [statusF, setStatusF] = useState<string[]>([])
  const [channelF, setChannelF] = useState<string[]>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [dropRow, setDropRow] = useState<string | null>(null)
  const [freeze, setFreeze] = useFreeze(`orders:${me.roleId}`, 4)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [display, setDisplay] = useDevicePref<'auto' | 'overview' | 'table'>(`orders-display:${me.id}`, 'auto')
  const [density, setDensity] = useDevicePref<'compact' | 'comfortable'>(`orders-density:v3:${me.id}`, 'comfortable')
  const overview = display === 'overview' || (display === 'auto' && availableWidth < 640)
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const measure = () => setAvailableWidth(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const { fresh: freshIds, seen } = useFreshOrders(me.id, views)
  const openOrder: typeof open = (id, ...rest) => { seen(id); open(id, ...rest) }
  const [order, setOrder] = usePref<ColumnOrderState>(`cols-order:v3:${me.roleId}`, DEFAULT_COLUMNS)
  const [receiptOrder, setReceiptOrder] = usePref<ColumnOrderState>(`cols-order:receipts:${me.roleId}`, [])
  const [visibility, setVisibility] = usePref<VisibilityState>(`cols-vis:v3:${me.roleId}`, DEFAULT_VISIBILITY)
  const [sizing, setSizing] = usePref<ColumnSizingState>(`cols-size:v3:${me.roleId}`, {})
  useEffect(() => {
    const next = migrateOrderDefaultColumns(order)
    if (next !== order) setOrder(next)
  }, [order, setOrder])

  // 「工资未定」只给能定写手工资的人看
  const allViews = availableOrderViews(savedViews, s.role, can)
  const [mode, setMode] = useDevicePref<'table' | 'board' | 'manual'>('orders-mode', 'table')
  const view = allViews.find((v) => v.id === viewId) ?? BUILTIN[0]

  function chooseView(id: string) {
    const next = allViews.find(v => v.id === id) ?? BUILTIN[0]
    setViewId(next.id)
    setSpecialF({ pay: next.pay, due: next.due, missingDue: next.missingDue, stale: next.stale, aftersale: next.aftersale, payPending: next.payPending, settle: next.settle })
    setStatusF(next.status ?? [])
    setChannelF(next.channelIds ?? [])
    setQuery(next.query ?? '')
    setReceipt(next.receipt ?? 'all')
    setSelected({})
  }
  // 首页等处点「超 30 天」直接带着视图进来
  const chooseRef = useRef(chooseView)
  chooseRef.current = chooseView
  useEffect(() => {
    const queued = takeOrdersView()
    if (queued) chooseRef.current(queued)
    const onView = (e: Event) => { takeOrdersView(); chooseRef.current((e as CustomEvent<string>).detail) }
    window.addEventListener('bxsh:orders-view', onView)
    return () => window.removeEventListener('bxsh:orders-view', onView)
  }, [])
  const clearFilters = () => chooseView('all')
  const rows = useMemo(() => views.filter(v => matchesOrderView(v, { id: 'active', name: '', ...specialF, status: statusF, channelIds: channelF, query, receipt: s.role.locked || s.role.fields.sales ? receipt : 'all' }, `${channel(v.channelId)?.name ?? ''} ${user(v.ownerId)?.name ?? ''}`))
    .sort((a, b) => a.orderDate === b.orderDate ? a.no < b.no ? 1 : -1 : a.orderDate < b.orderDate ? 1 : -1), [views, query, statusF, channelF, specialF, channel, user, receipt, s.role])

  const unpaidRows = useMemo(() => unpaidOrders(rows), [rows])
  const canStatus = can('order.status')
  const canDeliver = can('order.draft')
  const columns = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: ColumnDef<OrderView, any>[] = [
      col.display({
        id: 'select',
        size: 36,
        enableResizing: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="全选"
            checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false}
            onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
          />
        ),
        cell: ({ row, table }) => <span className="relative flex h-7 items-center justify-center">
          <span aria-hidden="true" className={cn('text-[12px] tabular-nums text-muted-foreground group-hover/tr:invisible group-focus-within/tr:invisible', row.getIsSelected() && 'invisible')}>{(table.options.meta as {rowNumbers:Map<string,number>})?.rowNumbers?.get(row.id)}</span>
          <span className={cn('absolute inset-0 flex items-center justify-center opacity-0 group-hover/tr:opacity-100 group-focus-within/tr:opacity-100', row.getIsSelected() && 'opacity-100')}><Checkbox aria-label={`选择订单 ${row.original.no}`} checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} onClick={(e) => e.stopPropagation()} /></span>
        </span>,
      }),
      col.accessor('title', {
        header: '订单名称',
        size: 220,
        cell: (c) => <span title={c.getValue()} className="flex min-w-0 items-center gap-1.5 font-medium leading-5">{(c.table.options.meta as GridMeta | undefined)?.fresh?.has(c.row.original.id) && <span role="img" aria-label="新单" className="size-1.5 shrink-0 rounded-full bg-info" />}<OrderBadges v={c.row.original}/><span className="truncate">{c.getValue()}</span></span>,
      }),
      col.accessor('progressNote', { header: '当前进度', size: 200, cell: OrderProgressCell }),
      col.accessor('status', {
        header: '状态',
        size: canDeliver ? 156 : 96,
        minSize: canDeliver ? 148 : 80,
        cell: OrderDeliveryCell,
      }),
      col.accessor((v) => afterSaleRank(v), {
        id: 'aftersale',
        header: '跟进',
        size: 150,
        cell: (c) => <AfterSaleChip v={c.row.original} />,
      }),
      col.accessor((v) => channel(v.channelId)?.name ?? '', { id: 'channel', header: '渠道', size: 112, cell: (c) => <ChannelName channel={channel(c.row.original.channelId)} /> }),
      col.accessor('type', { header: '类型', size: 96, cell: (c) => <span className="truncate text-muted-foreground">{c.getValue() || '—'}</span> }),
      col.accessor((v) => user(v.ownerId)?.name ?? '', {
        id: 'owner',
        header: '归属销售',
        size: 180,
        cell: (c) => <span className="inline-flex items-center gap-2"><Person user={user(c.row.original.ownerId)} size={20} />{!c.row.original.isSelf && <SalesModeBadge mode={c.row.original.salesMode}/>}</span>,
      }),
      col.accessor((v) => v.assignees.map((a) => user(a.userId)?.name).join(','), {
        id: 'assignees',
        header: '写手',
        size: 112,
        cell: (c) => <AvatarStack users={c.row.original.assignees.map((a) => user(a.userId))} />,
      }),
      col.accessor((v) => v.dueDate ?? '9999', {
        id: 'dueDate',
        header: '截止',
        size: 100,
        cell: (c) => <Due date={c.row.original.dueDate} status={c.row.original.status} start={c.row.original.orderDate} />,
      }),
      col.accessor('orderDate', { header: '下单', size: 128, cell: (c) => <OrderDay date={c.getValue()} day={(c.table.options.meta as GridMeta | undefined)?.days?.get(c.row.id)} /> }),
    ]
    const money_ = (id: keyof OrderView, header: string, extra?: (v: OrderView) => string | undefined) =>
      col.accessor((v) => (v[id] as number | undefined) ?? 0, {
        id: id as string,
        header,
        size: 88,
        meta: { align: 'right' },
        // 写手工资没定时，合计、提成、利润都还算不出来
        cell: (c) => {
          const v = c.row.original
          return <Money value={v[id] as number | null | undefined} plain={id === 'sales'} out={id === 'writerTotal' || id === 'commission'} pending={v.payPending && !(id === 'commission' && v.salesMode === 'cost') && ['writerTotal', 'commission', 'profit', 'bossIncome'].includes(id as string)} className={cn(id === 'sales' && 'text-gold', extra?.(v))} />
        },
      })
    const sample = views[0]
    const has = (k: keyof OrderView) => !!sample && sample[k] !== undefined
    if (has('sales')) list.push(money_('sales', '销售额'), money_('received', '已收'))
    if (has('unpaid'))
      list.push(
        col.accessor((v) => v.unpaid ?? 0, {
          id: 'unpaid',
          header: '未收',
          size: 88,
          meta: { align: 'right' },
          // 收多了（比如减免后没退差价）不显示负数，直接写「多收」
          cell: (c) => {
            const v = c.row.original
            if (v.unpaid !== undefined && v.unpaid < 0) return <span className="num text-danger">多收 {money(-v.unpaid)}</span>
            // 收齐了不再显示 ¥0，换成一个安静的绿色对勾
            if (v.unpaid === 0 && (v.sales ?? 0) > 0 && v.status !== '退单') return <span className="relative block"><span className={cn('inline-flex items-center justify-end gap-1 text-ok/80', can('payment.create') && 'group-hover/tr:invisible')} title="已收齐"><Check size={14} weight="bold" /></span></span>
            return <span className="relative block"><span className={can('payment.create')?'group-hover/tr:invisible group-focus-within/tr:invisible group-has-[[data-state=open]]/tr:invisible':''}><Money value={v.unpaid} plain className="text-foreground"/></span>{can('payment.create')&&<span className="absolute inset-y-0 right-0 hidden items-center group-hover/tr:flex group-focus-within/tr:flex has-[[data-state=open]]:flex"><InlineReceipt v={v}/></span>}</span>
          },
        }),
      )
    if (has('payStatus')) list.push(col.accessor((v) => v.payStatus ?? '', { id: 'payStatus', header: '收款', size: 100, cell: (c) => <PayPill status={c.row.original.payStatus} /> }))
    if (has('writerTotal')) list.push(money_('writerTotal', '写手工资'))
    else if (views.some((v) => v.myPay !== undefined)) list.push(money_('myPay', '我的工资'))
    if (views.some((v) => v.commission !== undefined)) list.push(money_('commission', '销售提成'))
    if (views.some((v) => v.bossIncome !== undefined)) list.push(money_('bossIncome', '预计收入'))
    if (has('channelNo')) list.push(col.accessor((v) => v.channelNo ?? '', { id: 'channelNo', header: '渠道单号', size: 100, cell: (c) => <span className="num text-muted-foreground">{c.getValue() || '—'}</span> }))
    list.push(col.accessor((v) => v.wechatGroup, { id: 'wechatGroup', header: '微信群', size: 200, cell: (c) => <span className="truncate text-muted-foreground">{c.getValue() || '—'}</span> }))
    list.push(col.accessor((v) => v.draftAt ?? '', { id: 'draftAt', header: '交付日期', size: 92, cell: (c) => <span className="num text-muted-foreground">{c.getValue() ? shortDate(businessDate(String(c.getValue()))) : '未交'}</span> }))
    list.push(col.accessor((v) => user(v.creatorId)?.name ?? '', { id: 'creator', header: '录单人', size: 96, cell: (c) => <Person user={user(c.row.original.creatorId)} size={18} muted /> }))
    return list
  }, [views, s.statuses, canStatus, canDeliver, channel, user, density])

  const columnOrder = useMemo(() => {
    const saved = receipt === 'all' ? order : receiptOrder.length ? receiptOrder : ['select', 'title', 'sales', 'received', 'unpaid', 'channel', ...order.filter(id => !['select', 'no', 'title', 'sales', 'received', 'unpaid', 'channel'].includes(id))]
    if (saved.includes('progressNote')) return saved
    const next = [...saved]
    next.splice(Math.max(1, next.indexOf('status') + 1), 0, 'progressNote')
    return next
  }, [receipt, order, receiptOrder])
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    state: { sorting, columnOrder, columnVisibility: { ...DEFAULT_VISIBILITY, ...visibility }, columnSizing: sizing, rowSelection: selected },
    onSortingChange: setSorting,
    onColumnOrderChange: receipt === 'all' ? setOrder : setReceiptOrder,
    onColumnVisibilityChange: setVisibility,
    onColumnSizingChange: setSizing,
    onRowSelectionChange: setSelected,
    enableRowSelection: true,
    columnResizeMode: 'onChange',
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const tableRows = table.getRowModel().rows
  const sortedIds = useMemo(() => tableRows.map((r) => r.original.id), [tableRows])
  // 按下单日期排时（默认就是），同一天的单归成一组：第一行写日期和当天单数
  const byDay = !sorting.length || sorting[0].id === 'orderDate'
  const days = useMemo(() => byDay ? groupDays(tableRows.map((r) => r.original)) : undefined, [tableRows, byDay])
  const gridMeta = useMemo(() => ({ rowNumbers: new Map(sortedIds.map((id, i) => [id, i + 1])), days, fresh: freshIds } satisfies GridMeta), [sortedIds, days, freshIds])
  table.options.meta = gridMeta
  const leafs = table.getVisibleLeafColumns()
  const pinReceipt = false
  // 冻结区不能占满窗口，给右侧滚动内容至少留出半屏。
  let pinWidth = 0
  let fittingPins = 0
  for (const leaf of leafs) {
    if (pinWidth + leaf.getSize() > availableWidth * 0.5) break
    pinWidth += leaf.getSize()
    fittingPins++
  }
  const n = Math.max(0, Math.min(freeze, leafs.length - 1, fittingPins))
  const layout = freezeLayout(leafs, n)
  const selIds = Object.keys(selected).filter((k) => selected[k] && rows.some((r) => r.id === k))
  const filterCount = statusF.length + channelF.length + Object.values(specialF).filter(Boolean).length + Number(receipt !== 'all') + Number(!!query)
  const filtersOn = filterCount > 0
  const filterSummary = [
    ...statusF,
    specialF.pay === 'unpaid' && '待收款',
    receipt !== 'all' && RECEIPT_FILTERS.find(([id]) => id === receipt)?.[1],
    specialF.due && '即将截止', specialF.missingDue && '截止未填', specialF.stale && '超 30 天未交付',
    specialF.aftersale && '跟进中', specialF.payPending && '工资未定', specialF.settle && '待结算',
    ...channelF.map(id => channel(id)?.name ?? '渠道'),
    query.trim() && `搜索：${query.trim()}`,
  ].filter(Boolean).join(' · ')

  const totals = useMemo(() => orderListSummary(rows), [rows])
  const selectedTotals = useMemo(() => selIds.length ? orderListSummary(rows.filter(row => selected[row.id])) : totals, [rows, selected, selIds.length, totals])

  function saveView() {
    const name = query.trim() || [...statusF, ...channelF.map((c) => channel(c)?.name)].filter(Boolean).join('、') || '我的视图'
    const v: View = { ...specialF, id: `v-${Date.now()}`, name: name.slice(0, 30), custom: true, query: query || undefined, status: statusF, channelIds: channelF, receipt }
    setSavedViews([...savedViews, v])
    setViewId(v.id)
    toast.success(`已保存视图「${v.name}」`)
  }

  function exportExcel(ids: string[]) {
    if (!can('order.export')) return toast.error('当前账号没有导出权限')
    // 服务端按你的权限生成 .xlsx，并记一条导出留痕
    const a = document.createElement('a')
    a.href = `/api/export/orders?ids=${ids.join(',')}`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success(`正在导出 ${ids.length} 单`)
  }

  return (
    <div ref={pageRef} className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 sm:px-4">
        <h1 className="text-base font-semibold">订单</h1>
        <span className="flex flex-wrap gap-x-2 text-xs tabular-nums text-muted-foreground"><span>{rows.length} 单</span>{totals.hasSales && <><span>销售额 {money(totals.sales)}</span><span>未收 {money(totals.unpaid)}</span>{totals.overpaid > 0 && <span>多收 {money(totals.overpaid)}</span>}</>}</span>
      </div>

      {/* 工具条 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-4 py-2">
        <div className="relative w-full min-w-0 basis-full sm:w-auto sm:min-w-[150px] sm:max-w-[220px] sm:flex-1 sm:basis-auto">
          <MagnifyingGlass size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input id="order-search" className={cn(inputCls, 'h-8 pl-8')} placeholder="名称、渠道、单号" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <FilterPopover
          statuses={s.statuses} channels={filterChannels} statusF={statusF} channelF={channelF}
          setStatusF={value => { setStatusF(value); setSelected({}); setViewId('all') }}
          setChannelF={value => { setChannelF(value); setSelected({}); setViewId('all') }}
          views={allViews} viewId={view.id} chooseView={chooseView}
          special={specialF} setSpecial={value => { setSpecialF(value); setSelected({}); setViewId('all') }}
          receipt={receipt} canSeeSales={s.role.locked || s.role.fields.sales}
          setReceipt={value => { setReceipt(value); setSelected({}); setViewId('all'); scrollRef.current?.scrollTo({left:0}) }}
          count={filterCount} matching={rows.length} totalRows={views.length} clear={clearFilters} save={filtersOn ? saveView : undefined}
          rename={name => setSavedViews(old => old.map(v => v.id === view.id ? { ...v, name } : v))}
          remove={() => { setSavedViews(old => old.filter(v => v.id !== view.id)); clearFilters() }}
          move={(from, to) => setSavedViews(old => arrayMove(old, old.findIndex(v => v.id === from), old.findIndex(v => v.id === to)))}
        />
        {filtersOn && <button type="button" className="flex h-8 max-w-[180px] items-center gap-1 rounded-md bg-primary/10 px-2 text-xs text-primary" aria-label="清除订单筛选" title={filterSummary} onClick={clearFilters}>
          <span className="truncate">{view.custom ? view.name : filterSummary}</span><X size={12} className="shrink-0"/>
        </button>}
        <div className="ml-auto flex items-center gap-2">
          <ColumnSettings table={table} defaultOrder={DEFAULT_COLUMNS} defaultVisibility={DEFAULT_VISIBILITY}>          {!overview && <SelectField aria-label="行高" value={density} onChange={e=>setDensity(e.target.value as typeof density)} className={cn(inputCls,'h-8 w-auto text-xs')}><option value="compact">紧凑行高</option><option value="comfortable">宽松行高</option></SelectField>}
          <SelectField aria-label="订单展示方式" value={display} onChange={(e) => setDisplay(e.target.value as typeof display)} className={cn(inputCls, 'h-8 w-auto text-xs')}>
            <option value="auto">自动布局</option><option value="overview">卡片概览</option><option value="table">完整表格</option>
          </SelectField>
          <Segmented size="sm" label="显示方式" value={mode} onChange={setMode} items={[['table', '表格'], ['board', '看板'], ['manual', '手动排序']]} />
</ColumnSettings>
          {can('order.export') && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => exportExcel(rows.map((r) => r.id))}>
              <DownloadSimple size={15} /> <span className="hidden sm:inline">导出</span>
            </Button>
          )}
          {can('order.export') && (s.role.locked || s.role.fields.sales) && unpaidRows.length > 0 && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" title={`导出当前筛选中未付的 ${unpaidRows.length} 单`} onClick={() => downloadUnpaid(`ids=${unpaidRows.map(r => r.id).join(',')}`, unpaidRows.length)}>
              <DownloadSimple size={15} /> 未付<span className="hidden sm:inline"> · {unpaidRows.length}</span>
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <Empty
            icon={<ClipboardText size={22} />}
            title={views.length ? '没有符合条件的订单' : '还没有你能看到的订单'}
            hint={views.length ? undefined : can('order.create') ? '粘贴一段渠道消息，或手动录一单' : '订单分给你后会出现在这里'}
            action={
              views.length ? (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  清空筛选
                </Button>
              ) : can('order.create') ? (
                <Button size="sm" onClick={() => window.dispatchEvent(new CustomEvent('bxsh:ai-intake', { detail: {} }))}>AI 录单</Button>
              ) : undefined
            }
          />
        </div>
      ) : mode === 'board' ? (
        <KanbanBoard rows={rows} />
      ) : mode === 'manual' ? (
        <ManualList rows={rows} />
      ) : (
        <>
          {/* 桌面表格 */}
          <ColumnDrag ids={table.getAllLeafColumns().map(c => c.id)} visibleIds={leafs.filter(c => c.id !== 'select').map(c => c.id)} onChange={ids => table.setColumnOrder(ids)}>
          <div ref={scrollRef} hidden={overview} tabIndex={0} aria-label="订单表格，可横向滚动" className="order-grid-scroll relative min-h-0 flex-1 overflow-auto bg-card outline-none">
            <table className="workbench-grid table-fixed border-separate border-spacing-0" style={{ width: table.getTotalSize(), minWidth: '100%' }}>
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const right = (h.column.columnDef.meta as { align?: string } | undefined)?.align === 'right'
                      const sorted = h.column.getIsSorted()
                      const fz = frozenCell(h.id, layout, true)
                      if (h.id === 'select') return <th key={h.id} style={{width:h.getSize(),...fz.style}} className={cn('sticky top-0 z-10 h-9 border-b bg-card px-0 text-center', fz.className)}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
                      return (
                        <MovableHeader
                          key={h.id}
                          id={h.id}
                          label={String(h.column.columnDef.header)}
                          onSort={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined}
                          resize={<ResizeHandle header={h} />}
                          menu={<HeaderMenu table={table} id={h.id} right={right} frozen={n} maxFreeze={Math.min(leafs.length - 1, fittingPins)} setFreeze={setFreeze} open={headerMenu === h.id} onOpenChange={(o) => setHeaderMenu(o ? h.id : null)} />}
                          onContextMenu={(e) => { e.preventDefault(); setHeaderMenu(h.id) }}
                          style={{ width: h.getSize(), ...fz.style, ...(h.id === 'receiptAction' && pinReceipt ? {right:0,zIndex:25} : {}) }}
                          className={cn(
                            'group/th sticky top-0 z-10 h-9 border-b bg-card px-3 text-left text-[13px] font-normal text-muted-foreground',
                            right && 'text-right',
                            h.id === 'receiptAction' && pinReceipt && 'sticky border-l',
                            fz.className,
                          )}
                        >
                              <span className="truncate">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                              {sorted === 'asc' && <ArrowUp size={11} />}
                              {sorted === 'desc' && <ArrowDown size={11} />}
                        </MovableHeader>
                      )
                    })}
                  </tr>
                ))}
              </thead>
              <VirtualTableBody rows={overview ? [] : table.getRowModel().rows} scrollRef={scrollRef} rowHeight={density === 'compact' ? 32 : 40} enabled={!overview && rows.length > 100} colSpan={leafs.length}>
                {(r, index, measure) => {
                  const sel = r.getIsSelected()
                  const drop = dropRow === r.original.id
                  return (
                    <tr
                      key={r.id}
                      data-index={index}
                      ref={measure}
                      onClick={() => openOrder(r.original.id, sortedIds, 'overview', view.payPending ? '写手' : undefined)}
                      onDragOver={(e) => {
                        if (!hasFiles(e)) return
                        e.preventDefault()
                        setDropRow(r.original.id)
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropRow((x) => (x === r.original.id ? null : x))
                      }}
                      onDrop={async (e) => {
                        if (!hasFiles(e)) return
                        e.preventDefault()
                        setDropRow(null)
                        const o = r.original
                        await addAttachments(o.id, Array.from(e.dataTransfer.files))
                      }}
                      className={cn('group/tr cursor-pointer', isFresh(r.original.id) && 'row-fresh', rowMark(r.original))}
                    >
                      {r.getVisibleCells().map((c) => {
                        const right = (c.column.columnDef.meta as { align?: string } | undefined)?.align === 'right'
                        const fz = frozenCell(c.column.id, layout)
                        return (
                          <td
                            key={c.id}
                            onClick={e=>{if (['select','receiptAction'].includes(c.column.id)) return; const target:Record<string,string>={channel:'渠道',owner:'归属销售',type:'订单类型',assignees:'写手',writerTotal:'写手',myPay:'写手',orderDate:'下单日期',dueDate:'截止日期',wechatGroup:'微信群',channelNo:'渠道单号',draftAt:'初稿',sales:'价格',commission:'写手',bossIncome:'价格',received:'收款',unpaid:'收款',payStatus:'收款',aftersale:'售后'}; const field=target[c.column.id]; if(field){e.stopPropagation();openOrder(r.original.id,sortedIds,field==='收款'?'payments':field==='跟进'?'aftersale':'overview',field)}}}
                            style={{ width: c.column.getSize(), maxWidth: c.column.getSize(), ...fz.style, ...(c.column.id === 'receiptAction' && pinReceipt ? {right:0,zIndex:20} : {}) }}
                            className={cn(
                              'relative overflow-hidden border-b px-3 align-middle',
                              days?.get(r.id)?.last ? 'border-border' : 'border-border/60',
                              density === 'compact' ? 'h-8' : 'h-10',
                              // 冻结列吸在左边，底色必须不透明
                              drop
                                ? 'bg-[color-mix(in_srgb,hsl(var(--primary))_16%,hsl(var(--card)))]'
                                : sel
                                  ? 'bg-[color-mix(in_srgb,hsl(var(--primary))_7%,hsl(var(--card)))] group-hover/tr:bg-[color-mix(in_srgb,hsl(var(--primary))_11%,hsl(var(--card)))]'
                                  : 'bg-card group-hover/tr:bg-accent',
                              r.original.status === '退单' && 'text-muted-foreground [&>*]:opacity-50 [&_.money]:line-through',
                              right && 'text-right',
                              c.column.id === 'select' && 'px-0',
                              c.column.id === 'receiptAction' && pinReceipt && 'sticky border-l',
                              fz.className,
                            )}
                          >
                            <OrderCellContent cell={c} selected={sel} meta={gridMeta} />
                            {c.column.id === freezeHost(layout, leafs[0].id) && <FreezeHandle layout={layout} count={n} setCount={setFreeze} max={leafs.length - 1} scrollRef={scrollRef} />}
                          </td>
                        )
                      })}
                    </tr>
                  )
                }}
              </VirtualTableBody>
            </table>
          </div>
          </ColumnDrag>

          {!overview && <div className="flex h-8 shrink-0 items-center justify-between border-t px-4 text-xs tabular-nums text-muted-foreground"><span>{selIds.length ? `已选 ${selIds.length} / ` : ''}{rows.length} 条记录{totals.hasSales && ` · ${selIds.length ? '已选销售额' : '销售额'} ${money(selectedTotals.sales)}`}</span></div>}
          {overview && <div className="scroll-thin min-h-0 flex-1 overflow-auto overscroll-y-contain p-3 pb-20 sm:pb-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <label className="flex cursor-pointer items-center gap-2"><Checkbox aria-label="全选当前结果" checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? 'indeterminate' : false} onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)} />全选当前结果</label>
            </div>
            <div className="grid gap-2 sm:gap-3" style={{ gridTemplateColumns: availableWidth >= 760 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' }}>
              {table.getRowModel().rows.map((r) => {
                const v = r.original
                const day = days?.get(r.id)
                return <Fragment key={v.id}>{day?.first && <h3 className="col-span-full mt-1 flex items-baseline gap-2 px-1 text-xs first:mt-0"><span className="font-semibold text-foreground">{dayLabel(v.orderDate)}</span><span className="tabular-nums text-muted-foreground">{day.count} 单</span></h3>}<article className={cn('order-card relative min-w-0 rounded-xl border bg-card transition-colors hover:border-primary/40', r.getIsSelected() && 'border-primary bg-primary/5', dropRow === v.id && 'ring-2 ring-primary')}
                  onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setDropRow(v.id) } }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropRow(null) }}
                  onDrop={async (e) => { if (!hasFiles(e)) return; e.preventDefault(); setDropRow(null); await addAttachments(v.id, Array.from(e.dataTransfer.files)) }}>
                  <label className="absolute left-1 top-1 z-10 grid h-10 w-10 cursor-pointer place-items-center sm:left-2 sm:top-2"><Checkbox aria-label={`选择订单 ${v.no}`} checked={r.getIsSelected()} onCheckedChange={(value) => r.toggleSelected(!!value)} /></label>
                  <button onClick={() => openOrder(v.id, sortedIds)} aria-label={`查看订单 ${v.no} ${v.title}`} className="block w-full rounded-xl p-3 text-left focus-visible:outline-primary sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pl-8 sm:pl-7"><span /><span className="inline-flex items-center gap-2"><OrderBadges v={v}/><StatusPill status={v.status} /></span></div>
                    <h2 className="mt-1.5 line-clamp-2 break-words text-[15px] font-semibold leading-5 sm:mt-3 sm:line-clamp-none sm:text-[14px] sm:leading-6">{v.title}</h2>
                    <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-xs"><span className="inline-flex min-w-0 items-center gap-1.5"><ChannelAvatar channel={channel(v.channelId)} size={18}/><span className="truncate">{channel(v.channelId)?.name ?? (v.salesMode === 'cost' ? '底价订单' : '未关联渠道')}</span></span><span className="inline-flex shrink-0 items-center gap-1"><span className="text-muted-foreground">销售</span><Person user={user(v.ownerId)} size={18}/></span></div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                      <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5"><span className="text-muted-foreground">写手</span>{v.assignees.length ? v.assignees.map((a) => <Person key={a.userId} user={user(a.userId)} size={18} />) : <AvatarStack users={[]} />}</span>
                      <span className="inline-flex items-center gap-1.5"><span className="text-muted-foreground">截止</span>{v.dueDate ? <Due date={v.dueDate} status={v.status} /> : needsDeadline(v) ? '未设置' : '—'}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-2 text-xs">
                      {v.sales !== undefined && <span className="inline-flex items-center gap-1.5"><span className="text-muted-foreground">销售额</span><Money value={v.sales} plain className="font-semibold text-gold" /></span>}
                      {v.unpaid !== undefined && <span className="inline-flex items-center gap-1.5"><span className="text-muted-foreground">{v.unpaid < 0 ? '多收' : '未收'}</span><Money value={Math.abs(v.unpaid)} plain className={cn('font-semibold', v.unpaid < 0 ? 'text-danger' : 'text-foreground')} /></span>}
                      {v.sales === undefined && v.myPay !== undefined && <span className="inline-flex items-center gap-1.5"><span className="text-muted-foreground">我的工资</span><Money value={v.myPay} /></span>}
                    </div>
                    {openAfterSale(v) && <div className="mt-2"><AfterSaleChip v={v} /></div>}
                  </button>
                </article></Fragment>
              })}
            </div>
          </div>}

        </>
      )}

      {/* 批量操作条 */}
      <AnimatePresence>
        {selIds.length > 0 && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
            transition={{ type: 'tween', duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
            style={{ x: '-50%' }}
            className="fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 pl-3.5 shadow-xl shadow-black/10"
          >
            <span className="num mr-2 whitespace-nowrap text-sm" aria-live="polite" aria-atomic="true">已选 {selIds.length} 单</span>
            {can('order.assign')&&<Popover><PopoverTrigger asChild><Button variant="ghost" size="sm">改写手</Button></PopoverTrigger><PopoverContent className="w-80"><PersonChoice people={s.users.filter(u=>u.canWrite&&u.active!==false)} value="" label="批量改写手" onChange={async id=>{const result=await bulkWriters(selIds,id);if(result){toast.success(`已更新 ${result.count} 单写手`);setSelected({})}}}/></PopoverContent></Popover>}
            {canStatus && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1">
                    改状态 <CaretDown size={12} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {s.statuses.map((st) => (
                    <DropdownMenuItem key={st} onSelect={async () => { const n = await bulkStatus(selIds, st); if (n) toast.success(`${n} 单已改为「${st}」`) }}>
                      <StatusPill status={st} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => cards(selIds)}>
              <IdentificationCard size={15} /> 订单卡
            </Button>
            {can('order.export') && (
              <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => exportExcel(selIds)}>
                <DownloadSimple size={15} /> 导出
              </Button>
            )}
            {can('order.delete') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-danger hover:text-danger"
                disabled={deletion.busy}
                aria-busy={deletion.busy}
                onClick={() => void deletion.remove(selIds, () => setSelected({}))}
              >
                {deletion.busy ? <CircleNotch size={15} className="animate-spin motion-reduce:animate-none" /> : <Trash size={15} />}
                {deletion.busy ? '删除中' : '删除'}
              </Button>
            )}
            <button onClick={() => setSelected({})} className="ml-1 grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent" aria-label="取消选择">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export { Due } from './Due'

type OrderFilterProps = {
  statuses: string[]; channels: ChannelLabel[]; statusF: string[]; channelF: string[]
  setStatusF: (v: string[]) => void; setChannelF: (v: string[]) => void
  views: View[]; viewId: string; chooseView: (id: string) => void
  special: Partial<View>; setSpecial: (value: Partial<View>) => void
  receipt: ReceiptFilter; canSeeSales: boolean; setReceipt: (v: ReceiptFilter) => void
  count: number; matching?: number; totalRows?: number; clear: () => void; save?: () => void
  rename: (name: string) => void; remove: () => void; move: (from: string, to: string) => void
}
const ORDER_SPECIAL_FILTERS = [['aftersale', '跟进中', 'aftersale'], ['paypending', '工资未定', 'payPending'], ['settle', '待结算', 'settle']] as const
const ORDER_DEADLINES = { due: '即将截止', missingDue: '截止未填', stale: '超 30 天未交付' }

/** 只适配共享筛选控件，订单是否命中仍统一由 matchesOrderView 判断。 */
export function orderFilterFields(p: OrderFilterProps): TableFilterField<never>[] {
  const labels = new Map(p.channels.map(c => [c.id, c.name]))
  const field = (id: string, label: string, options: string[], multiple = false): TableFilterField<never> => ({ id, label, options, multiple, numeric: false, date: false, operators: [multiple ? 'one-of' : 'equals'], value: () => undefined })
  return [
    field('status', '交付状态', p.statuses, true),
    ...(p.canSeeSales ? [{ ...field('receipt', '收款情况', ['unpaid', ...RECEIPT_FILTERS.filter(([id]) => id !== 'all').map(([id]) => id)]), optionLabel: (value: string) => value === 'unpaid' ? '待收款' : RECEIPT_FILTERS.find(([id]) => id === value)?.[1] ?? value }] : []),
    { ...field('deadline', '截止', Object.keys(ORDER_DEADLINES)), optionLabel: (value: string) => ORDER_DEADLINES[value as keyof typeof ORDER_DEADLINES] ?? value },
    { ...field('channel', '渠道', p.channels.map(c => c.id), true), optionLabel: (value: string) => labels.get(value) ?? '未知渠道' },
    ...ORDER_SPECIAL_FILTERS.filter(([id]) => p.views.some(v => v.id === id)).map(([, label, key]) => field(key, label, [label])),
  ]
}

export function orderFilterValues(p: OrderFilterProps): TableFilter[] {
  const selected: TableFilter[] = []
  if (p.statusF.length) selected.push({ field: 'status', operator: 'one-of', value: '', values: p.statusF })
  if (p.channelF.length) selected.push({ field: 'channel', operator: 'one-of', value: '', values: p.channelF })
  const receipt = p.special.pay === 'unpaid' ? 'unpaid' : p.receipt
  if (p.canSeeSales && receipt !== 'all') selected.push({ field: 'receipt', operator: 'equals', value: receipt })
  const deadline = p.special.stale ? 'stale' : p.special.missingDue ? 'missingDue' : p.special.due ? 'due' : ''
  if (deadline) selected.push({ field: 'deadline', operator: 'equals', value: deadline })
  for (const [id, label, key] of ORDER_SPECIAL_FILTERS) if (p.special[key] && p.views.some(v => v.id === id)) selected.push({ field: key, operator: 'equals', value: label })
  return selected
}

export function applyOrderFilters(p: OrderFilterProps, filters: TableFilter[]) {
  const allowed = new Set(orderFilterFields(p).map(f => f.id))
  const active = filters.filter(f => allowed.has(f.field) && tableFilterActive(f))
  const get = (id: string) => active.find(f => f.field === id)
  const values = (id: string) => get(id)?.values ?? (get(id)?.value ? [get(id)!.value] : [])
  const statuses = values('status'), channels = values('channel')
  if (statuses.join('\0') !== p.statusF.join('\0')) p.setStatusF(statuses)
  if (channels.join('\0') !== p.channelF.join('\0')) p.setChannelF(channels)
  const receipt = get('receipt')?.value ?? 'all'
  const nextReceipt = receipt === 'unpaid' ? 'all' : receipt as ReceiptFilter
  if (nextReceipt !== p.receipt) p.setReceipt(nextReceipt)
  const deadline = get('deadline')?.value
  const nextSpecial: Partial<View> = { ...p.special, pay: receipt === 'unpaid' ? 'unpaid' : undefined, due: deadline === 'due', missingDue: deadline === 'missingDue', stale: deadline === 'stale' }
  for (const [, , key] of ORDER_SPECIAL_FILTERS) nextSpecial[key] = !!get(key)
  if (p.special.pay !== nextSpecial.pay || (['due', 'missingDue', 'stale', 'aftersale', 'payPending', 'settle'] as const).some(key => !!p.special[key] !== !!nextSpecial[key])) p.setSpecial(nextSpecial)
}

export function FilterPopover(p: OrderFilterProps) {
  const [renaming, setRenaming] = useState(false)
  const [dragView, setDragView] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<TableFilter[]>([])
  const current = p.views.find(v => v.id === p.viewId)
  const fields = orderFilterFields(p)
  const active = orderFilterValues(p)
  // 添加条件时先显示空编辑器；选中值后再映射回已有订单状态，切换视图不改业务规则。
  const filters = [...active, ...drafts.filter(draft => fields.some(f => f.id === draft.field) && !active.some(filter => filter.field === draft.field))]
  const customViews = p.views.filter(v => v.custom)
  return <TableFilterPopover fields={fields} filters={filters}
    onFiltersChange={next => { setDrafts(next.filter(f => !tableFilterActive(f))); applyOrderFilters(p, next) }}
    preferredFilterFields={['status', 'receipt', 'deadline', 'channel']}
    matching={p.matching ?? 0} totalRows={p.totalRows ?? 0} ariaLabel="筛选订单"
    onClear={() => { setDrafts([]); p.clear() }}
    renderOption={(fieldId, value) => fieldId === 'channel' ? <ChannelName channel={p.channels.find(c => c.id === value)} size={18}/> : fields.find(f => f.id === fieldId)?.optionLabel?.(value) ?? value}
    footer={<>
      {customViews.length > 0 && <details className="w-full text-xs"><summary className="cursor-pointer py-1.5 text-muted-foreground">已存视图 · {customViews.length}</summary><div className="flex flex-wrap gap-1 pb-2" aria-label="已存视图">{customViews.map(v => <button key={v.id} type="button" draggable onDragStart={() => setDragView(v.id)} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragView) p.move(dragView, v.id); setDragView(null) }} onClick={() => { setDrafts([]); p.chooseView(v.id); setRenaming(false) }} className={cn('rounded border px-2 py-1.5 text-xs', v.id === p.viewId && 'border-primary text-primary')}>{v.name}</button>)}</div></details>}
      {renaming && current?.custom && <input key={current.id} aria-label="视图名称" className={cn(inputCls, 'h-8 w-full')} defaultValue={current.name} autoFocus onBlur={e => { const name = e.target.value.trim(); if (name) p.rename(name.slice(0, 30)); setRenaming(false) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}/>}
      {p.save && <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={p.save}><BookmarkSimple size={13}/>存为视图</Button>}
      {current?.custom && <><Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setRenaming(!renaming)}>重命名</Button><Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-danger" onClick={() => { setDrafts([]); p.remove() }}>删除视图</Button></>}
    </>}/>
}

/** 表头菜单：悬停出现小三角，右键也能打开；像飞书一样就地挪列、冻结、隐藏。 */
function HeaderMenu({ table, id, right, frozen, maxFreeze, setFreeze, open, onOpenChange }: {
  table: ReturnType<typeof useReactTable<OrderView>>
  id: string
  right: boolean
  frozen: number
  maxFreeze: number
  setFreeze: (n: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const column = table.getColumn(id)
  if (!column) return null
  const label = String(column.columnDef.header)
  const leafs = table.getVisibleLeafColumns()
  const at = leafs.findIndex((c) => c.id === id)
  const movable = leafs.filter((c) => c.id !== 'select').map((c) => c.id)
  const mi = movable.indexOf(id)
  const move = (to: string | undefined) => {
    if (!to) return
    const ids = table.getAllLeafColumns().map((c) => c.id)
    table.setColumnOrder(arrayMove(ids, ids.indexOf(id), ids.indexOf(to)))
  }
  const sorted = column.getIsSorted()
  const resized = table.getState().columnSizing[id] !== undefined
  const item = 'gap-2 text-[13px]'
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        aria-label={`「${label}」列菜单`}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          'absolute top-1/2 z-20 grid h-6 w-5 -translate-y-1/2 place-items-center rounded bg-card text-muted-foreground opacity-0 outline-none hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/th:opacity-100 data-[state=open]:opacity-100',
          right ? 'left-1' : 'right-2',
        )}
      >
        <CaretDown size={11} weight="bold" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={right ? 'end' : 'start'} className="w-44">
        {column.getCanSort() && (
          <>
            <DropdownMenuItem className={item} onSelect={() => column.toggleSorting(false)}><ArrowUp size={14} />升序{sorted === 'asc' && <Check size={13} className="ml-auto" />}</DropdownMenuItem>
            <DropdownMenuItem className={item} onSelect={() => column.toggleSorting(true)}><ArrowDown size={14} />降序{sorted === 'desc' && <Check size={13} className="ml-auto" />}</DropdownMenuItem>
            {sorted && <DropdownMenuItem className={item} onSelect={() => column.clearSorting()}><X size={14} />取消排序</DropdownMenuItem>}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem className={item} disabled={mi <= 0} onSelect={() => move(movable[mi - 1])}><ArrowLeft size={14} />左移一列</DropdownMenuItem>
        <DropdownMenuItem className={item} disabled={mi < 0 || mi >= movable.length - 1} onSelect={() => move(movable[mi + 1])}><ArrowRight size={14} />右移一列</DropdownMenuItem>
        <DropdownMenuItem className={item} disabled={mi <= 0} onSelect={() => move(movable[0])}><ArrowLineLeft size={14} />移到最前</DropdownMenuItem>
        <DropdownMenuSeparator />
        {at + 1 === frozen ? (
          <DropdownMenuItem className={item} onSelect={() => setFreeze(0)}><PushPinSlash size={14} />取消冻结</DropdownMenuItem>
        ) : (
          <DropdownMenuItem className={item} disabled={at + 1 > maxFreeze} title={at + 1 > maxFreeze ? '左边几列太宽了，冻结后会占满半屏' : undefined} onSelect={() => setFreeze(at + 1)}><PushPin size={14} />冻结到这一列</DropdownMenuItem>
        )}
        {resized && <DropdownMenuItem className={item} onSelect={() => column.resetSize()}><ArrowsHorizontal size={14} />恢复列宽</DropdownMenuItem>}
        <DropdownMenuItem
          className={item}
          disabled={movable.length <= 1}
          onSelect={() => {
            column.toggleVisibility(false)
            toast(`已隐藏「${label}」，在「列」里能再打开`, { action: { label: '撤销', onClick: () => column.toggleVisibility(true) } })
          }}
        >
          <EyeSlash size={14} />隐藏这一列
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 表格行内的操作统一长这样：无边框、主色字、悬停浅底 */
const ROW_ACTION = 'h-7 px-2 text-primary hover:bg-primary/10 hover:text-primary'
/** 记款使用正文色，悬停和按下显示浅灰底 */
const ROW_ACTION_MONEY = 'h-7 px-2 text-foreground hover:bg-foreground/5 hover:text-foreground active:bg-foreground/10'

function InlineReceipt({v}:{v:OrderView}) {
  return <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className={ROW_ACTION_MONEY} aria-label={`记收款 ${v.no}`} onClick={e=>e.stopPropagation()}>记款</Button></PopoverTrigger><PopoverContent align="end" className="max-h-[70dvh] w-[min(480px,calc(100vw-24px))] overflow-auto" onClick={e=>e.stopPropagation()}><div className="mb-3 text-sm"><p className="truncate font-medium">{v.title}</p></div><Payments key={v.id} v={v}/></PopoverContent></Popover>
}

type DayInfo = { first: boolean; last: boolean; count: number }
type GridMeta = { rowNumbers: Map<string, number>; days?: Map<string, DayInfo>; fresh?: Set<string> }

/** 逾期的行左边一道红线，加急的一道橙线；两样都有只画红线。画在第一格里侧，不占宽度。 */
function rowMark(v: OrderView) {
  const open = v.status === '未交付' || v.status === '已发演示'
  if (isInitialDeliveryPending(v) && (daysUntil(v.dueDate) ?? 0) < 0) return '[&>td:first-child]:shadow-[inset_3px_0_0_hsl(var(--danger))]'
  if (open && v.urgency) return '[&>td:first-child]:shadow-[inset_3px_0_0_hsl(var(--warn))]'
  return undefined
}

// 拖列宽时仍实时更新单元格尺寸；内容仅随数据、选择或分组信息变化重画。
const OrderCellContent = memo(function OrderCellContent({ cell }: { cell: Cell<OrderView, unknown>; selected: boolean; meta: GridMeta }) {
  return flexRender(cell.column.columnDef.cell, cell.getContext())
})

function groupDays(list: OrderView[]) {
  const counts = new Map<string, number>()
  for (const v of list) counts.set(v.orderDate, (counts.get(v.orderDate) ?? 0) + 1)
  return new Map(list.map((v, i): [string, DayInfo] => [v.id, {
    first: list[i - 1]?.orderDate !== v.orderDate,
    last: list[i + 1]?.orderDate !== v.orderDate,
    count: counts.get(v.orderDate)!,
  }]))
}

const WEEK = '日一二三四五六'
function dayLabel(date: string) {
  const t = businessDate(new Date())
  const y = businessDate(new Date(Date.now() - 864e5))
  const w = WEEK[new Date(`${date}T00:00:00`).getDay()]
  return `${shortDate(date)} ${date === t ? '今天' : date === y ? '昨天' : `周${w}`}`
}

// 同一天的第一行写日期和单数，后面几行淡掉，一眼看出每天接了几单
function OrderDay({ date, day }: { date: string; day?: DayInfo }) {
  if (!day) return <span className="num text-muted-foreground">{shortDate(date)}</span>
  if (!day.first) return <span className="num text-muted-foreground/35">{shortDate(date)}</span>
  return <span className="flex items-baseline gap-1.5 whitespace-nowrap" title={dayLabel(date)}>
    <span className="num font-medium text-foreground">{shortDate(date)}</span>
    <span className="text-[11px] tabular-nums text-muted-foreground">{day.count}单</span>
  </span>
}
