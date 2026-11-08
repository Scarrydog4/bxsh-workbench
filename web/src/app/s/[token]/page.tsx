import { eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { loadWorld } from '@/server/repo'
import { statement } from '@/server/statement'
import { hashToken } from '@/server/actions-p2'
import { money } from '@/shared/format'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: '对账单 · 笔下工单', robots: { index: false, follow: false } }

/**
 * 对账单只读分享页：不用登录。链接撤销、过期，或生成人已停用 / 失去对账权限，立即失效。
 * 内容按生成人现在的权限实时算（看不到的单不会出现）。每次打开都计数并记审计日志。
 */
export default async function SharedStatement({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [l] = await db.select().from(t.shareLinks).where(eq(t.shareLinks.tokenHash, hashToken(token)))
  const dead = !l || l.revokedAt || (l.expiresAt && new Date(l.expiresAt).getTime() < Date.now())
  const w = dead ? null : await loadWorld(db, { includeDeleted: true })
  const owner = w?.users.find((u) => u.id === l!.createdBy && u.active)
  const role = owner && w!.roles.find((r) => r.id === owner.roleId)
  const s = owner && role ? statement(w!, owner, role, l!.channelId, l!.month) : null
  if (!s) return <Gone />

  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || ''
  await db.update(t.shareLinks).set({ opens: sql`${t.shareLinks.opens} + 1` }).where(eq(t.shareLinks.id, l!.id))
  await db.insert(t.audit).values({ actorId: 'public', action: '打开分享链接', objectType: 'share', objectId: l!.id, objectLabel: `${s.channel} · ${s.month}`, ip })

  const [y, m] = s.month.split('-')
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
      <div className="mb-6">
        <div className="text-xs text-muted-foreground">笔下工单 · 对账单（只读）</div>
        <h1 className="mt-1 text-xl font-semibold">
          {s.channel} · {y} 年 {Number(m)} 月
        </h1>
        {l!.expiresAt && <div className="mt-1 text-xs text-muted-foreground">链接有效到 {new Date(l!.expiresAt).toLocaleDateString('zh-CN')}</div>}
      </div>
      <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-lg border">
        {(
          [
            ['金额', s.total.sales],
            ['已收', s.total.received],
            ['未收', s.total.unpaid],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="border-r px-4 py-3 last:border-r-0">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className={`num mt-0.5 text-lg font-medium ${k === '金额' ? 'text-gold' : 'text-foreground'}`}>{money(v)}</div>
          </div>
        ))}
      </div>
      {s.rows.length === 0 ? (
        <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">这个月没有订单</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">下单日期</th>
                <th className="px-3 py-2 font-medium">订单</th>
                <th className="px-3 py-2 font-medium">渠道单号</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 text-right font-medium">金额</th>
                <th className="px-3 py-2 text-right font-medium">已收</th>
                <th className="px-3 py-2 text-right font-medium">未收</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.no} className="border-t">
                  <td className="num px-3 py-2 text-muted-foreground">{r.orderDate.slice(5)}</td>
                  <td className="px-3 py-2">
                    <div>{r.title}</div>
                    <div className="num text-xs text-muted-foreground">{r.no}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.channelNo || '—'}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="num px-3 py-2 text-right text-gold">{money(r.sales)}</td>
                  <td className="num px-3 py-2 text-right">{money(r.received)}</td>
                  <td className={`num px-3 py-2 text-right ${r.unpaid < 0 ? 'text-danger' : 'text-foreground'}`}>{r.unpaid < 0 ? `多收 ${money(-r.unpaid)}` : money(r.unpaid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!s.prepayments.length && <section className="mt-4 overflow-hidden rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><div><h2 className="text-sm font-medium">未分配预收</h2><p className="mt-1 text-xs text-muted-foreground">本月收款 · 当前余额 · 未计入订单已收</p></div><span className="num font-medium text-primary">{money(s.prepaymentTotal)}</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>{['收款日期', '收款编号', '原收款', '已分配', '未分配'].map(label => <th key={label} className="px-3 py-2 font-normal">{label}</th>)}</tr></thead><tbody>{s.prepayments.map(receipt => <tr key={receipt.no} className="border-t"><td className="num px-3 py-2">{receipt.date}</td><td className="num px-3 py-2">{receipt.no}</td><td className="num px-3 py-2">{money(receipt.amount)}</td><td className="num px-3 py-2">{money(receipt.allocated)}</td><td className="num px-3 py-2 font-medium text-primary">{money(receipt.unallocated)}</td></tr>)}</tbody></table></div>
      </section>}
      <p className="mt-6 text-xs text-muted-foreground">数据为打开时的实时结果。有疑问请联系对接的销售。</p>
    </main>
  )
}

function Gone() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <div className="text-lg font-medium">链接已失效</div>
        <p className="mt-1 text-sm text-muted-foreground">可能已过期或被撤销，请联系对接的销售重新发一份。</p>
      </div>
    </main>
  )
}
