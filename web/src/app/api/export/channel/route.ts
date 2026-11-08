import { channelAccessible } from '@/shared/channel-access'
import ExcelJS from 'exceljs'
import { z } from 'zod'
import { db } from '@/server/db'
import { audit } from '@/server/schema'
import { loadWorld, adminIdsOf } from '@/server/repo'
import { route, deny, bad, notFound } from '@/server/http'
import { can, project, rowVisible } from '@/shared/perm'
import { CHANNEL_EXPORT_SCOPES, channelExportData, channelExportScopeLabel, channelPaymentState, exportColumns, exportScopeOrders, RECEIPT_COLUMNS } from '@/shared/channel-export'
import { applyPaymentColors } from '@/server/export-payment-colors'
import { businessDate } from '@/shared/format'

export const POST = route(async (req,c) => {
  if (!can(c.role,'order.view') || !can(c.role,'channel.view') || !can(c.role,'order.export')) throw deny()
  const parsed = z.object({channelId:z.string(), columns:z.array(z.string()).min(1).max(20), language:z.enum(['zh','en','both']), scope:z.enum(CHANNEL_EXPORT_SCOPES).default('all'), orderIds:z.array(z.string().min(1)).min(1).refine(ids=>new Set(ids).size===ids.length).optional(), includeReceipts:z.boolean().default(true)}).safeParse(await req.json())
  if (!parsed.success) throw bad('请选择导出内容')
  const i=parsed.data, sales=c.role.locked || c.role.fields.sales
  if (!sales && i.scope!=='all') throw deny()
  const w=await loadWorld(db), ch=w.channels.find(x=>x.id===i.channelId)
  if (!ch || ch.deletedAt || !channelAccessible(ch, c.me, c.role)) throw notFound()
  const cols=exportColumns(i.columns,sales,c.role.locked || c.role.fields.channelNo,i.scope)
  if (!cols.length) throw bad('请选择可导出的列')
  const candidates=exportScopeOrders(w.orders.filter(o=>!o.deletedAt && o.salesMode !== 'cost' && o.channelId===i.channelId && rowVisible(o,c.me,c.role)).map(o=>project(o,c.me,c.role,adminIdsOf(w))),i.scope)
  const selectedIds=i.orderIds ? new Set(i.orderIds) : null
  const selected=selectedIds ? candidates.filter(o=>selectedIds.has(o.id)) : candidates
  if ((selectedIds && selected.length!==selectedIds.size) || !selected.length) throw bad('所选订单已变化，请刷新后重新选择')
  const data=channelExportData(selected)
  const wb=new ExcelJS.Workbook()
  const headers: (1|2)[]=i.language==='both' ? [1,2] : [i.language==='zh'?1:2]
  function sheet(name:string, columns:readonly (readonly string[])[], rows:unknown[][]) {
    const ws=wb.addWorksheet(name)
    ws.columns=columns.map(c=>({width:c[0]==='title'?46:c[0]==='note'?30:18}))
    for (const h of headers) { const row=ws.addRow(columns.map(c=>c[h])); row.font={bold:true,color:{argb:'FFFFFFFF'}}; row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF19715E'}}; row.height=24 }
    rows.forEach(r=>ws.addRow(r))
    ws.views=[{state:'frozen',ySplit:headers.length,xSplit:1}]
    ws.autoFilter={from:{row:headers.length,column:1},to:{row:headers.length,column:columns.length}}
    columns.forEach((c,index)=>{if(['sales','received','unpaid','amount'].includes(c[0])) ws.getColumn(index+1).numFmt='#,##0.00'})
    return ws
  }
  const ws=sheet('订单汇总',cols,data.orders.map(o=>cols.map(c=>c[0]==='paymentState' ? channelPaymentState(o) : o[c[0]]??'')))
  for (const [name,total] of [['有效订单合计',data.live],['退单合计',data.returned]] as const) {
    const values: (string | number)[]=cols.map((c,idx)=> ['sales','received','unpaid'].includes(c[0]) ? total[c[0] as 'sales'|'received'|'unpaid'] : '')
    const labelAt=cols.findIndex(c=>!['sales','received','unpaid'].includes(c[0]));
    if (labelAt < 0) ws.addRow([`${name}（${total.n}单）`]).font={bold:true}
    else values[labelAt]=`${name}（${total.n}单）`
    ws.addRow(values).font={bold:true}
  }
  if (i.scope==='all' && sales) applyPaymentColors(ws,data.orders,{businessColumnCount:cols.length,categoryColumn:cols.findIndex(c=>c[0]==='paymentState')+1,headers})
  if (i.includeReceipts && sales) sheet('逐笔收款',RECEIPT_COLUMNS,data.receipts.map(p=>RECEIPT_COLUMNS.map(c=>p[c[0]])))
  const buf=await wb.xlsx.writeBuffer()
  await db.insert(audit).values({actorId:c.me.id,action:'导出',objectType:'export',objectLabel:`${ch.name} · ${data.orders.length} 单`,ip:c.ip})
  return new Response(buf as ArrayBuffer,{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','cache-control':'no-store','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(`${ch.name}-${channelExportScopeLabel(i.scope)}-${businessDate(new Date())}.xlsx`)}`}})
})
