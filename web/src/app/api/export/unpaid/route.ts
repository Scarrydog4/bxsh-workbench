import ExcelJS from 'exceljs'
import { db } from '@/server/db'
import { audit } from '@/server/schema'
import { adminIdsOf, loadWorld } from '@/server/repo'
import { route, deny, notFound } from '@/server/http'
import { can, project, rowVisible } from '@/shared/perm'
import { channelAccessible } from '@/shared/channel-access'
import { businessDate } from '@/shared/format'
import { sumMoney } from '@/shared/calc'
import { unpaidOrders, unpaidState } from '@/shared/unpaid-export'

/** 一键导出未付：?channel= 导一个渠道，?ids= 导订单页当前筛选；行和金额按导出人权限裁剪 */
export const GET = route(async (req, c) => {
  if (!can(c.role, 'order.view') || !can(c.role, 'order.export') || !(c.role.locked || c.role.fields.sales)) throw deny()
  const params = new URL(req.url).searchParams
  const channelId = params.get('channel')
  const ids = params.get('ids')?.split(',').filter(Boolean)
  const w = await loadWorld(db)
  const ch = channelId ? w.channels.find(x => x.id === channelId) : undefined
  if (channelId && (!ch || ch.deletedAt || !channelAccessible(ch, c.me, c.role))) throw notFound()
  const adminIds = adminIdsOf(w)
  const rows = unpaidOrders(w.orders
    .filter(o => !o.deletedAt && rowVisible(o, c.me, c.role) && (ch ? o.channelId === ch.id && o.salesMode !== 'cost' : !ids || ids.includes(o.id)))
    .map(o => project(o, c.me, c.role, adminIds)))
  const chName = (id: string) => w.channels.find(x => x.id === id)?.name ?? ''
  const multi = new Set(rows.map(r => r.channelId)).size > 1

  type Col = { header: string; get: (v: (typeof rows)[number]) => unknown; width: number; money?: boolean }
  const cols: Col[] = [
    ...(multi ? [{ header: '渠道', get: (v: (typeof rows)[number]) => chName(v.channelId), width: 14 }] : []),
    { header: '订单名称', get: v => v.title, width: 36 },
    { header: '下单日期', get: v => v.orderDate, width: 12 },
    { header: '总价', get: v => v.sales, width: 12, money: true },
    { header: '已收', get: v => v.received, width: 12, money: true },
    { header: '未收', get: v => v.unpaid, width: 12, money: true },
    { header: '情况', get: v => unpaidState(v), width: 12 },
  ]
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('未付')
  ws.columns = cols.map(x => ({ header: x.header, width: x.width }))
  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF19715E' } }
  head.height = 24
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  for (const v of rows) ws.addRow(cols.map(x => x.get(v) ?? ''))
  const total: (string | number)[] = cols.map(x => x.header === '总价' ? sumMoney(rows.map(r => r.sales ?? 0)) : x.header === '已收' ? sumMoney(rows.map(r => r.received ?? 0)) : x.header === '未收' ? sumMoney(rows.map(r => r.unpaid ?? 0)) : '')
  total[0] = `合计 ${rows.length} 单`
  ws.addRow(total).font = { bold: true }
  cols.forEach((x, i) => x.money && (ws.getColumn(i + 1).numFmt = '#,##0.00'))

  const label = ch ? ch.name : '订单'
  const buf = await wb.xlsx.writeBuffer()
  await db.insert(audit).values({ actorId: c.me.id, action: '导出', objectType: 'export', objectLabel: `${label} 未付 · ${rows.length} 单`, ip: c.ip })
  const file = `${ch ? `${ch.name}-未付` : '未付订单'}-${businessDate(new Date())}.xlsx`
  return new Response(buf as ArrayBuffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file)}`,
    },
  })
})
