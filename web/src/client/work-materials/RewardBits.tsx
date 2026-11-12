import { Gift, WarningCircle } from '@phosphor-icons/react'
import { businessDate, businessDateTime, money } from '@/shared/format'
import { cn } from '@/lib/utils'
import { payable, REVIEW_KIND, type QualityReview, type ReviewKind } from '@/shared/work-materials'
import { sumMoney } from '@/shared/calc'
import { Tip } from '../Tip'
import { DataTable } from '../table-kit'
import { Empty } from '../ui'
import { useNav } from '../nav'
import { useSession } from '../store'
import { PageLoading } from '../PageLoading'
import { useWorkData } from './data'

export const KIND_TEXT: Record<ReviewKind, string> = { reward: 'text-gold', penalty: 'text-danger' }
export const KindIcon = ({ kind, size = 17 }: { kind: ReviewKind; size?: number }) => kind === 'reward' ? <Gift size={size}/> : <WarningCircle size={size}/>
const settleLabel = (r: QualityReview) => r.revokedAt ? '已撤销' : r.settledAt ? '已结清' : payable(r) ? '下次发工资结' : '确认后才扣'

/** 金额：悬停说明结算情况 */
export function AmountCell({ r }: { r: QualityReview }) {
  if (!r.amount) return <span className="text-muted-foreground">—</span>
  const label = r.revokedAt ? '已撤销，不算钱' : r.settledAt ? '已随工资结清 · ' + businessDateTime(r.settledAt) : payable(r) ? '下次发工资一起结' : '写手回复、老板确认后才扣'
  return <Tip label={label}><span className={cn('num whitespace-nowrap font-medium', r.revokedAt ? 'text-muted-foreground line-through' : r.settledAt ? 'text-muted-foreground' : KIND_TEXT[r.kind])}>{(r.kind === 'reward' ? '+' : '−') + money(r.amount)}</span></Tip>
}

/** 写手收入页里的奖惩：只列有金额的 */
export function RewardLedger() {
  const { me, s } = useSession()
  const { go } = useNav()
  const { data, error, reload } = useWorkData<QualityReview[]>('/api/reviews', me.id, s.version)
  if (!data) return <div className="p-3"><PageLoading page="reviews" error={!!error} onRetry={reload}/></div>
  const rows = data.filter(r => r.writerId === me.id && !!r.amount)
  const open = sumMoney(rows.filter(r => !r.revokedAt && !r.settledAt).map(r => (r.kind === 'reward' ? 1 : -1) * (r.amount ?? 0)))
  return <div className="flex min-h-0 flex-1 flex-col">
    {!!rows.length && <p className="px-4 py-2 text-sm text-muted-foreground">未结合计 <span className={cn('num font-medium', open < 0 ? 'text-danger' : open > 0 ? 'text-gold' : 'text-foreground')}>{open >= 0 ? '+' : '−'}{money(Math.abs(open))}</span></p>}
    <DataTable fill id="my-rewards" rows={rows} rowId={r => r.id} onRowClick={() => go('reviews')}
      empty={<Empty icon={<Gift size={22}/>} title="还没有奖惩"/>}
      cols={[
        { id: 'kind', header: '类型', size: 56, hideable: false, filterValue: r => REVIEW_KIND[r.kind], cell: r => <Tip label={REVIEW_KIND[r.kind]}><span role="img" aria-label={REVIEW_KIND[r.kind]} className={cn('inline-flex', r.revokedAt ? 'text-muted-foreground' : KIND_TEXT[r.kind])}><KindIcon kind={r.kind}/></span></Tip> },
        { id: 'amount', header: '金额', size: 96, align: 'right', sort: r => r.amount ?? 0, cell: r => <AmountCell r={r}/> },
        { id: 'settle', header: '结算', size: 110, filterValue: settleLabel, cell: r => <span className="text-muted-foreground">{settleLabel(r)}</span> },
        { id: 'category', header: '分类', size: 110, cell: r => r.category || '—' },
        { id: 'issue', header: '说明', size: 260, cell: r => <span className="block truncate" title={r.issue}>{r.issue.split('\n')[0]}</span> },
        { id: 'order', header: '订单', size: 180, cell: r => <span className="block truncate" title={r.orderTitle ?? ''}>{r.orderTitle ?? '—'}</span> },
        { id: 'date', header: '日期', size: 110, sort: r => r.createdAt, cell: r => <span className="num text-muted-foreground">{businessDate(r.createdAt)}</span> },
      ]}/>
  </div>
}
