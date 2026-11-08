import { fuzzyMatch } from '@/shared/search'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CaretDown, DownloadSimple, MagnifyingGlass, SlidersHorizontal } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { CHANNEL_COLUMNS, CHANNEL_PAYMENT_CATEGORIES, RECEIPT_COLUMNS, channelExportData, channelExportScopeLabel, channelPaymentCategory, channelPaymentState, exportColumns, exportScopeOrders, type ChannelColumn, type ChannelExportScope, type HeaderLanguage } from '@/shared/channel-export'
import type { Channel, OrderView } from '@/shared/types'
import { businessDate, money } from '@/shared/format'
import { receiptTotals } from '@/shared/receipts'
import { cn } from '@/lib/utils'
import { useSession } from './store'
import { usePref } from './prefs'
import { ChannelName, inputCls } from './ui'

const defaultColumns: ChannelColumn[] = ['title', 'paymentState', 'sales', 'received', 'unpaid']
const scopes: ChannelExportScope[] = ['unpaid', 'no_deposit', 'balance', 'paid', 'all']
const scopeHelp: Partial<Record<ChannelExportScope, string>> = {
  unpaid: '跨月份查看未付订单，暂不催款的订单可以取消勾选。',
  no_deposit: '尚无有效收款；待补金额是订单未收余额，不是约定定金。',
  balance: '已有收款但尚未收齐；暂不催款的订单可以取消勾选。',
}
const moneyColumns = ['sales', 'received', 'unpaid', 'amount']
const valueText = (key: string, value: unknown) => typeof value === 'number' && moneyColumns.includes(key) ? money(value) : String(value ?? '')

export function ChannelExport({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { views, role } = useSession()
  const hasSales = role.locked || role.fields.sales
  const [keys, setKeys] = usePref<ChannelColumn[]>('channel-export-columns', defaultColumns)
  const [language, setLanguage] = usePref<HeaderLanguage>('channel-export-language', 'zh')
  const [includeReceipts, setIncludeReceipts] = usePref<boolean>('channel-export-receipts', false)
  const [scope, setScope] = useState<ChannelExportScope>(hasSales ? 'unpaid' : 'all')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null)
  const [customizing, setCustomizing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'orders' | 'receipts'>('orders')
  const available = exportColumns(CHANNEL_COLUMNS.map(c => c[0]), hasSales, role.locked || role.fields.channelNo, scope)
  const cols = exportColumns(keys, hasSales, role.locked || role.fields.channelNo, scope)
  const orders = useMemo(() => views.filter(v => v.channelId === channel.id && v.salesMode !== 'cost'), [views, channel.id])
  const scoped = exportScopeOrders(orders, hasSales ? scope : 'all')
  const query = search.trim().toLowerCase()
  const matching = scoped.filter(o => fuzzyMatch([o.title, o.channelNo, o.no], query))
  const shown = channelExportData(matching).orders
  const picked = matching.filter(o => selectedIds === null || selectedIds.has(o.id))
  const data = channelExportData(picked)
  const due = receiptTotals(picked).unpaid
  const checked = picked.length > 0 && picked.length === matching.length ? true : picked.length > 0 ? 'indeterminate' : false
  const showReceipts = tab === 'receipts' && includeReceipts && hasSales
  const colorCategories = hasSales && scope === 'all'
  const headerRows = language === 'both' ? [1, 2] : [language === 'zh' ? 1 : 2]

  function paymentLabel(order: OrderView) {
    const category = channelPaymentCategory(order)
    return colorCategories ? <span className="inline-flex whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium" style={{ color: category.color, backgroundColor: category.background }}>{category.label}</span> : channelPaymentState(order)
  }

  function selectOrder(id: string, value: boolean) {
    setSelectedIds(old => {
      const next = new Set(old ?? matching.map(o => o.id))
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function download() {
    if (busy || !cols.length || !picked.length) return
    setBusy(true)
    try {
      const response = await fetch('/api/export/channel', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channelId: channel.id, columns: keys, language, scope: hasSales ? scope : 'all', orderIds: picked.map(o => o.id), includeReceipts: hasSales && includeReceipts }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        toast.error(error?.error || '导出失败，请重试')
        return
      }
      const url = URL.createObjectURL(await response.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `${channel.name}-${channelExportScopeLabel(hasSales ? scope : 'all')}-${businessDate(new Date())}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success(`已导出 ${picked.length} 单`)
    } catch {
      toast.error('导出失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return <Dialog open onOpenChange={open => !open && !busy && onClose()}>
    <DialogContent className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-5xl flex-col gap-0 overflow-hidden p-0">
      <header className="shrink-0 border-b px-4 py-4 pr-10 sm:px-5">
        <DialogTitle className="flex flex-wrap items-center gap-2 text-base">导出订单 <ChannelName channel={channel}/></DialogTitle>
        <DialogDescription className="mt-1 text-xs">选择需要核对的订单，自定义导出内容。</DialogDescription>
      </header>
      <fieldset disabled={busy} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="space-y-3 border-b px-4 py-3 sm:px-5">
          {hasSales && <div className="flex flex-wrap gap-1.5" role="group" aria-label="收款情况">
            {scopes.map(value => <Button key={value} size="sm" variant={scope === value ? 'secondary' : 'ghost'} aria-pressed={scope === value} className={cn('gap-1.5', scope === value && 'text-primary')} onClick={() => { setScope(value); setSelectedIds(null); setTab('orders') }}>
              {channelExportScopeLabel(value)}<span className="num text-xs opacity-70">{exportScopeOrders(orders, value).length}</span>
            </Button>)}
          </div>}
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 basis-40"><MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/><input aria-label="搜索导出订单" className={cn(inputCls, 'h-9 w-full pl-9')} placeholder="订单名、渠道单号" value={search} onChange={e => { setSearch(e.target.value); setSelectedIds(null) }}/></label>
            <Button size="sm" variant="outline" className="h-9 gap-1.5" aria-expanded={customizing} aria-controls="channel-export-settings" onClick={() => setCustomizing(value => !value)}><SlidersHorizontal size={16}/>自定义<span className="num text-xs text-muted-foreground">{cols.length} 列</span><CaretDown size={12} className={customizing ? 'rotate-180' : ''}/></Button>
          </div>
          {scopeHelp[scope] && <p className="text-xs text-muted-foreground">{scopeHelp[scope]}</p>}
          {colorCategories && <div className="space-y-2 text-xs" aria-label="收款分类颜色说明">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-x-5">{CHANNEL_PAYMENT_CATEGORIES.map(category => <span key={category.label} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: category.color }}/>{category.label}</span>)}</div>
            <p className="text-muted-foreground">自动附带收款分类标注，Excel 右侧附颜色说明。</p>
          </div>}
          {customizing && <div id="channel-export-settings" className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">导出列</span><div className="flex gap-3 text-primary"><button type="button" onClick={() => setKeys(available.map(c => c[0]))}>全选</button><button type="button" onClick={() => setKeys(defaultColumns)}>恢复默认</button><button type="button" onClick={() => setKeys([])}>清空</button></div></div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">{available.map(c => <label key={c[0]} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm"><Checkbox checked={cols.some(col => col[0] === c[0])} disabled={colorCategories && c[0] === 'paymentState'} onCheckedChange={value => setKeys(value ? [...new Set([...keys, c[0]])] : keys.filter(key => key !== c[0]))}/>{c[1]}{colorCategories && c[0] === 'paymentState' && <span className="text-xs text-muted-foreground">自动</span>}</label>)}</div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t pt-3 text-xs">
              <div className="flex flex-wrap items-center gap-3" role="group" aria-label="表头语言"><span className="text-muted-foreground">表头</span>{(['zh', 'en', 'both'] as const).map((value, i) => <label key={value} className="flex items-center gap-1.5"><input type="radio" name="export-language" checked={language === value} onChange={() => setLanguage(value)}/>{['中文', '英文', '双语'][i]}</label>)}</div>
              {hasSales && <label className="flex items-center gap-2"><Checkbox checked={includeReceipts} onCheckedChange={value => { setIncludeReceipts(!!value); if (!value) setTab('orders') }}/>附逐笔收款明细（含备注）</label>}
            </div>
          </div>}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-xs sm:px-5">
          <label className="flex min-h-7 items-center gap-2"><Checkbox aria-label="全选当前订单" checked={checked} disabled={!matching.length} onCheckedChange={value => setSelectedIds(value ? null : new Set())}/>全选当前 {matching.length} 单</label>
          {hasSales && includeReceipts && <div className="ml-auto flex gap-1">{(['orders', 'receipts'] as const).map((value, i) => <Button key={value} size="sm" variant={tab === value ? 'secondary' : 'ghost'} className="h-7 px-2" onClick={() => setTab(value)}>{['订单预览', '收款明细'][i]}</Button>)}</div>}
        </div>
        {showReceipts ? <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="bg-muted/50">{headerRows.map(h => <tr key={h}>{RECEIPT_COLUMNS.map(c => <th key={c[0]} className="px-4 py-3 font-medium">{c[h as 1 | 2]}</th>)}</tr>)}</thead><tbody>{data.receipts.map((row, i) => <tr key={i} className="border-t">{RECEIPT_COLUMNS.map(c => <td key={c[0]} className="max-w-80 whitespace-normal break-words px-4 py-3">{valueText(c[0], row[c[0]])}</td>)}</tr>)}</tbody></table>{!data.receipts.length && <p className="p-8 text-center text-sm text-muted-foreground">所选订单暂无收款记录</p>}</div> : <>
          <div className="hidden overflow-x-auto sm:block"><table className="w-full text-left text-sm"><thead className="bg-muted/50">{headerRows.map((h, i) => <tr key={h}>{i === 0 && <th rowSpan={headerRows.length} className="w-12 px-4 py-3" aria-label="选择订单"/>}{cols.map(c => <th key={c[0]} className={cn('whitespace-nowrap px-4 py-3 font-medium text-muted-foreground', moneyColumns.includes(c[0]) && 'text-right')}>{c[h as 1 | 2]}</th>)}</tr>)}</thead><tbody>{shown.map(order => <tr key={order.id} className="border-t hover:bg-muted/30" style={colorCategories ? { backgroundColor: `${channelPaymentCategory(order).color}0A` } : undefined}><td className="px-4 py-3"><Checkbox aria-label={`导出 ${order.title}`} checked={selectedIds === null || selectedIds.has(order.id)} onCheckedChange={value => selectOrder(order.id, !!value)}/></td>{cols.map(c => <td key={c[0]} className={cn('px-4 py-3', c[0] === 'title' ? 'min-w-56 max-w-md break-words' : 'whitespace-nowrap', moneyColumns.includes(c[0]) && 'num text-right', c[0] === 'unpaid' && 'font-semibold')}>{c[0] === 'paymentState' ? paymentLabel(order) : valueText(c[0], order[c[0]])}</td>)}</tr>)}</tbody></table></div>
          <div className="divide-y sm:hidden">{shown.map(order => <div key={order.id} className={cn("px-4 py-3", colorCategories && "border-l-2")} style={colorCategories ? { borderLeftColor: channelPaymentCategory(order).color, backgroundColor: `${channelPaymentCategory(order).color}0A` } : undefined}><label className="flex items-start gap-3"><Checkbox className="mt-0.5 shrink-0" aria-label={`导出 ${order.title}`} checked={selectedIds === null || selectedIds.has(order.id)} onCheckedChange={value => selectOrder(order.id, !!value)}/><span className="min-w-0 break-words text-sm font-medium">{order.title}</span></label><dl className="ml-7 mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">{cols.filter(c => c[0] !== 'title').map(c => <div key={c[0]} className="min-w-0"><dt className="text-muted-foreground">{language === 'en' ? c[2] : c[1]}</dt><dd className={cn('mt-0.5 break-words', moneyColumns.includes(c[0]) && 'num', c[0] === 'unpaid' && 'font-semibold')}>{c[0] === 'paymentState' ? paymentLabel(order) : valueText(c[0], order[c[0]])}</dd></div>)}</dl></div>)}</div>
          {!shown.length && <p className="p-8 text-center text-sm text-muted-foreground">{query ? '没有匹配的订单' : scope === 'all' ? '暂无订单' : `没有${channelExportScopeLabel(scope)}订单`}</p>}
          {!cols.length && !!shown.length && <p className="px-4 pb-4 text-sm text-muted-foreground">请在「自定义」里勾选要导出的列。</p>}
        </>}
      </fieldset>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-card px-4 py-3 sm:px-5">
        <div aria-live="polite" className="min-w-0 text-sm"><span>已选 <strong className="num">{picked.length}</strong> 单</span>{hasSales && <span className="ml-3">待补 <strong className="num">{money(due)}</strong></span>}</div>
        <Button className="gap-2" disabled={busy || !cols.length || !picked.length} onClick={() => void download()}><DownloadSimple size={16}/>{busy ? '导出中…' : '导出'}</Button>
      </footer>
    </DialogContent>
  </Dialog>
}

/** 订单总表保留原有快捷导出；渠道统一使用上面的配置窗口。 */
export function downloadUnpaid(query: string, n: number) {
  const a = document.createElement('a')
  a.href = `/api/export/unpaid?${query}`
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
  toast.success(`正在导出未付 ${n} 单`)
}
