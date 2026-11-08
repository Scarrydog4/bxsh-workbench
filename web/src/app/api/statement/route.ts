import ExcelJS from 'exceljs'
import { db } from '@/server/db'
import { audit } from '@/server/schema'
import { loadWorld } from '@/server/repo'
import { bad, json, notFound, route } from '@/server/http'
import { statement } from '@/server/statement'

/** 渠道对账单：?channelId=&month=2026-10，加 &format=xlsx 下载 Excel */
export const GET = route(async (req, c) => {
  const q = new URL(req.url).searchParams
  const month = q.get('month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('月份格式不对')
  const w = await loadWorld(db, { includeDeleted: true })
  const s = statement(w, c.me, c.role, q.get('channelId') ?? '', month)
  if (!s) throw notFound()
  if (q.get('format') !== 'xlsx') return json(s)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('对账单')
  ws.columns = [
    { header: '订单编号', width: 16 },
    { header: '订单名称', width: 40 },
    { header: '下单日期', width: 12 },
    { header: '渠道单号', width: 14 },
    { header: '状态', width: 10 },
    { header: '金额', width: 12 },
    { header: '已收', width: 12 },
    { header: '未收', width: 12 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const r of s.rows) ws.addRow([r.no, r.title, r.orderDate, r.channelNo, r.status, r.sales, r.received, r.unpaid])
  ws.addRow(['合计', '', '', '', '', s.total.sales, s.total.received, s.total.unpaid]).font = { bold: true }
  for (const i of [6, 7, 8]) ws.getColumn(i).numFmt = '¥#,##0.00'
  if (s.prepayments.length) {
    const prepayments = wb.addWorksheet('未分配预收')
    prepayments.columns = [{ header: '收款编号', width: 20 }, { header: '收款日期', width: 14 }, { header: '原收款', width: 14 }, { header: '已分配', width: 14 }, { header: '当前未分配', width: 16 }]
    prepayments.getRow(1).font = { bold: true }
    for (const receipt of s.prepayments) prepayments.addRow([receipt.no, receipt.date, receipt.amount, receipt.allocated, receipt.unallocated])
    prepayments.addRow(['未分配合计', '', '', '', s.prepaymentTotal]).font = { bold: true }
    prepayments.addRow(['按本月收款日期筛选，未分配金额为当前余额，未计入订单已收。'])
    for (const column of [3, 4, 5]) prepayments.getColumn(column).numFmt = '¥#,##0.00'
  }
  const buf = await wb.xlsx.writeBuffer()
  await db.insert(audit).values({ actorId: c.me.id, action: '导出', objectType: 'export', objectLabel: `对账单 · ${s.channel} · ${month}`, ip: c.ip })
  return new Response(buf as ArrayBuffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`对账单-${s.channel}-${month}.xlsx`)}`,
    },
  })
})
