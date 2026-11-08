import ExcelJS from 'exceljs'
import { db } from '@/server/db'
import { audit } from '@/server/schema'
import { adminIdsOf, loadWorld } from '@/server/repo'
import { route } from '@/server/http'
import { can, project, rowVisible } from '@/shared/perm'
import { businessDate } from '@/shared/format'
import { deny } from '@/server/http'
import { channelPaymentState } from '@/shared/channel-export'
import { applyPaymentColors } from '@/server/export-payment-colors'

/** 导出 Excel：列和行都按导出人的权限裁剪，和页面上看到的一致 */
export const GET = route(async (req, c) => {
  if (!can(c.role, 'order.view') || !can(c.role, 'order.export')) throw deny()
  const sales=c.role.locked || c.role.fields.sales
  const ids = new URL(req.url).searchParams.get('ids')?.split(',').filter(Boolean)
  const w = await loadWorld(db)
  const adminIds = adminIdsOf(w)
  const views = w.orders.filter((o) => rowVisible(o, c.me, c.role) && (!ids || ids.includes(o.id))).map((o) => project(o, c.me, c.role, adminIds))
  const name = (id: string) => w.users.find((u) => u.id === id)?.name ?? ''
  const ch = (id: string) => w.channels.find((x) => x.id === id)?.name ?? ''

  type Col = { header: string; get: (v: (typeof views)[number]) => unknown; width?: number; money?: boolean }
  const cols: Col[] = [
    { header: '订单编号', get: (v) => v.no, width: 16 },
    { header: '订单名称', get: (v) => v.title, width: 40 },
    { header: '结算方式', get: (v) => v.salesMode === 'cost' ? '底价结算（销售交老板）' : '提成分成', width: 24 },
    { header: '下单日期', get: (v) => v.orderDate, width: 12 },
    { header: '截止日期', get: (v) => v.dueDate ?? '', width: 12 },
    { header: '状态', get: (v) => v.status },
    { header: '渠道', get: (v) => ch(v.channelId), width: 14 },
    { header: '类型', get: (v) => v.type },
    { header: '归属销售', get: (v) => name(v.ownerId) },
    { header: '写手', get: (v) => v.assignees.map((a) => name(a.userId)).join('、') },
    { header: '群内交付日期', get: (v) => v.draftAt ? businessDate(v.draftAt) : '', width: 12 },
    { header: '微信群', get: (v) => v.wechatGroup, width: 30 },
  ]
  if (sales) cols.splice(2,0,{ header: '收款分类', get: channelPaymentState, width: 14 })
  const any = (k: keyof (typeof views)[number]) => views.some((v) => v[k] !== undefined)
  if (any('channelNo')) cols.push({ header: '渠道单号', get: (v) => v.channelNo })
  if (any('sales')) cols.push({ header: '应收金额', get: (v) => v.sales, money: true }, { header: '已收', get: (v) => v.received, money: true }, { header: '未收', get: (v) => v.unpaid, money: true })
  if (any('writerTotal')) cols.push({ header: '写手工资', get: (v) => (v.payPending ? '待定' : v.writerTotal), money: true })
  else if (any('myPay')) cols.push({ header: '我的工资', get: (v) => (v.myPay === null ? '未定' : v.myPay), money: true })
  if (any('commission')) cols.push({ header: '销售提成', get: (v) => (v.payPending && !v.isSelf && v.salesMode !== 'cost' ? '待定' : v.commission), money: true })
  if (any('extraCostTotal')) cols.push({ header: '额外成本', get: v => v.extraCostTotal, money: true }, { header: '扣成本后分成基数', get: v => v.allocationBase, money: true })
  if (any('profit')) cols.push({ header: '预计利润', get: (v) => (v.payPending ? '待定' : v.profit), money: true })
  cols.push({ header: '备注', get: (v) => v.note, width: 30 })

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('订单')
  ws.columns = cols.map((x) => ({ header: x.header, width: x.width ?? 12 }))
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  for (const v of views) ws.addRow(cols.map((x) => x.get(v) ?? ''))
  cols.forEach((x, i) => x.money && (ws.getColumn(i + 1).numFmt = '¥#,##0.00'))
  if (sales) applyPaymentColors(ws,views,{businessColumnCount:cols.length,categoryColumn:3,headers:[1]})
  const buf = await wb.xlsx.writeBuffer()
  await db.insert(audit).values({ actorId: c.me.id, action: '导出', objectType: 'export', objectLabel: `订单 Excel · ${views.length} 单`, ip: c.ip })
  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(buf as ArrayBuffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`订单-${stamp}.xlsx`)}`,
    },
  })
})
