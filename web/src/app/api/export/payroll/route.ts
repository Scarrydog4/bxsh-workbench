import ExcelJS from 'exceljs'
import { z } from 'zod'
import { db } from '@/server/db'
import { audit } from '@/server/schema'
import { incomeRows } from '@/server/bootstrap'
import { adminIdsOf, loadWorld } from '@/server/repo'
import { bad, deny, route } from '@/server/http'
import { can, project, rowVisible } from '@/shared/perm'
import { businessDate } from '@/shared/format'
import { payLedger } from '@/shared/income'
import { payrollExportColumns, payrollExportKey, payrollExportValues, type PayrollExportRow } from '@/shared/payroll-export'

const input = z.object({
  rows: z.array(z.object({ payeeId: z.string().min(1).max(100), orderId: z.string().min(1).max(100), kind: z.enum(['写手工资', '销售提成']) }).strict()).min(1).max(10000),
  columns: z.array(z.string().max(50)).min(1).max(40),
}).strict()

/** 客户端只指定当前表格的行序与列序；金额始终从正式收入规则重新计算。 */
export const POST = route(async (req, c) => {
  if (!can(c.role, 'settle.manage') || !can(c.role, 'income.all') || !can(c.role, 'order.view') || !can(c.role, 'order.export')) throw deny()
  const parsed = input.safeParse(await req.json())
  if (!parsed.success) throw bad('请选择要导出的工资明细')
  const { rows: requested, columns } = parsed.data
  if (new Set(requested.map(payrollExportKey)).size !== requested.length) throw bad('导出明细重复，请刷新后重试')
  const world = await loadWorld(db, { includeDeleted: true }), admins = adminIdsOf(world)
  const people = new Map(world.users.map(user => [user.id, user])), orders = new Map(world.orders.map(order => [order.id, order]))
  const incomes = new Map<string, Awaited<ReturnType<typeof incomeRows>>>()
  const ledger = new Map<string, ReturnType<typeof payLedger>>()
  for (const payeeId of new Set(requested.map(row => row.payeeId))) {
    if (!people.has(payeeId) || admins.has(payeeId)) throw deny('这些明细已变化或不在你的可见范围，请刷新后重试')
    const rows = await incomeRows(c, payeeId, world)
    incomes.set(payeeId, rows); ledger.set(payeeId, payLedger(rows))
  }
  const result: PayrollExportRow[] = requested.map(ref => {
    const order = orders.get(ref.orderId), person = people.get(ref.payeeId)!
    const line = ledger.get(ref.payeeId)?.find(row => row.id === ref.orderId && row.kind === ref.kind)
    if (!order || !rowVisible(order, c.me, c.role) || !line) throw deny('这些明细已变化或不在你的可见范围，请刷新后重试')
    const records = new Map<string, string | null>()
    for (const batch of world.batches) if (batch.status === '已确认' && batch.payeeId === ref.payeeId && batch.kind === ref.kind && batch.lines.some(item => item.orderId === order.id)) records.set(batch.id, batch.confirmedAt)
    for (const item of order.settlements) if (!item.batchId && item.status === '已确认' && item.payeeId === ref.payeeId && item.kind === ref.kind) records.set(`history:${item.id}`, item.confirmedAt ?? null)
    const dates = [...records.values()].filter((date): date is string => !!date).map(businessDate).sort()
    return { ...line, payee: { id: person.id, name: person.name },
      order: order.deletedAt ? undefined : project(order, c.me, c.role, admins),
      date: order.deletedAt ? incomes.get(ref.payeeId)?.find(row => row.id === order.id && row.kind !== '追加工资')?.date ?? '' : order.orderDate,
      paidRecords: records.size, paidDate: dates.at(-1) ?? '', undatedPayment: [...records.values()].some(date => !date),
    }
  })
  const selected = payrollExportColumns(columns), book = new ExcelJS.Workbook(), sheet = book.addWorksheet('工资明细')
  sheet.columns = selected.map(column => ({ header: column.header, width: column.width ?? 16 }))
  const header = sheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF19715E' } }
  header.height = 25
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: selected.length } }
  const labels = { user: (id: string) => people.get(id)?.name ?? '', channel: (id: string) => world.channels.find(channel => channel.id === id)?.name ?? '' }
  for (const row of result) {
    const excelRow = sheet.addRow(payrollExportValues(row, selected, labels))
    excelRow.alignment = { vertical: 'middle', wrapText: true }
    const dateColumn = selected.findIndex(column => column.id === 'paidDate')
    if (dateColumn >= 0 && row.undatedPayment) excelRow.getCell(dateColumn + 1).note = '另有历史结算未记录日期；未使用导入时间代替。'
  }
  selected.forEach((column, index) => { if (column.money) sheet.getColumn(index + 1).numFmt = '¥#,##0.00'; else if (column.date) sheet.getColumn(index + 1).numFmt = '@' })
  const buffer = await book.xlsx.writeBuffer()
  await db.insert(audit).values({ actorId: c.me.id, action: '导出', objectType: 'export', objectLabel: `工资明细 Excel · ${result.length} 条`, ip: c.ip })
  return new Response(buffer as ArrayBuffer, { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`工资明细-${businessDate(new Date())}.xlsx`)}`,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
  } })
})
