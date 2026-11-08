import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { Page } from './nav'

/** 单键快捷键只在没打字、没开弹窗时生效，输入法组字和长按连发都不算 */
export function plainKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.isComposing) return false
  const t = e.target as HTMLElement | null
  if (t?.closest?.('input, textarea, select, [contenteditable=true]')) return false
  return !document.querySelector('[role=dialog], [role=menu], [role=alertdialog]')
}

/** G 后面接一个字母跳页 */
export const GO_KEYS: { key: string; page: Page; label: string }[] = [
  { key: 'h', page: 'home', label: '工作台' },
  { key: 'o', page: 'orders', label: '订单' },
  { key: 'c', page: 'channels', label: '渠道' },
  { key: 'i', page: 'income', label: '收入' },
  { key: 'p', page: 'settle', label: '工资结算' },
  { key: 't', page: 'tasks', label: '任务' },
  { key: 'a', page: 'assistant', label: '智能助手' },
]
export const goKeyFor = (page: Page) => GO_KEYS.find((g) => g.page === page)?.key

export function Keys({ keys, className }: { keys: string[]; className?: string }) {
  return <span className={className ?? 'inline-flex gap-1'}>{keys.map((k, i) => <kbd key={i} className="kbd">{k}</kbd>)}</span>
}

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  { title: '常用', rows: [[['⌘', 'K'], '搜订单、跳页面'], [['N'], '录单'], [['A'], '新增跟进'], [['B'], '报销'], [['?'], '打开这张表']] },
  { title: '订单详情', rows: [[['↑'], '上一单'], [['↓'], '下一单'], [['Esc'], '关闭']] },
  { title: '智能助手', rows: [[['/'], '输入问题'], [['⌘', '↵'], '查询 / 识别']] },
]

export function ShortcutsDialog({ open, onOpenChange, pages }: { open: boolean; onOpenChange: (v: boolean) => void; pages: Page[] }) {
  const go = GO_KEYS.filter((g) => pages.includes(g.page))
  const Row = ({ keys, label }: { keys: string[]; label: string }) => (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm"><span>{label}</span><Keys keys={keys} /></div>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-0 p-0">
        <div className="border-b px-5 py-4">
          <DialogTitle className="text-base">快捷键</DialogTitle>
          <DialogDescription className="text-xs">Windows 上 ⌘ 换成 Ctrl</DialogDescription>
        </div>
        <div className="grid gap-x-8 gap-y-5 px-5 py-4 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">{g.title}</h3>
              <div className="divide-y divide-border/60">{g.rows.map(([keys, label]) => <Row key={label} keys={keys} label={label} />)}</div>
            </section>
          ))}
          {!!go.length && <section>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">跳页：先按 G，再按</h3>
            <div className="divide-y divide-border/60">{go.map((g) => <Row key={g.key} keys={[g.key.toUpperCase()]} label={g.label} />)}</div>
          </section>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
