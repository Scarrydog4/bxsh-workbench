import ExcelJS from 'exceljs'
import { route } from '@/server/http'
import { contractorReport } from '@/server/contractors'
const handler = route(async (req,c)=>{
  const body=req.method==='POST'?await req.json().catch(()=>null):null
  if(req.method==='POST'&&(!body||!Array.isArray(body.ids)||body.ids.length>5000||body.ids.some((id:unknown)=>typeof id!=='string'))) return new Response('筛选条件不正确',{status:400})
  const {rows}=await contractorReport(c), query=new URL(req.url).searchParams
  const selected=rows.filter(p=>p.id===(body?.id??query.get('id')))
  const book=new ExcelJS.Workbook(), sheet=book.addWorksheet('外包往来')
  sheet.columns=[{header:'合作方',key:'partner',width:24},{header:'日期',key:'date',width:15},{header:'类别',key:'kind',width:14},{header:'订单名称',key:'order',width:42},{header:'项目 / 付款依据',key:'note',width:35},{header:'成本',key:'cost',width:15},{header:'已付',key:'paid',width:15}]
  const from=query.get('from')||'',to=query.get('to')||'9999-12-31'
  for(const p of selected){
    const entries=[...p.lines.map(l=>({id:l.id,partner:p.name,date:l.date,kind:'订单成本',order:l.title,note:l.name+(l.note?' · '+l.note:''),cost:l.amount,paid:0})),...p.payments.map(l=>({id:l.id,partner:p.name,date:l.date,kind:l.revokedAt?'已撤销付款':'已付款',order:'',note:l.note+(l.revokeReason?' · '+l.revokeReason:''),cost:0,paid:l.amount}))].filter(l=>l.date>=from&&l.date<=to).sort((a,b)=>a.date.localeCompare(b.date))
    const ordered=body?.ids?body.ids.map((id:string)=>entries.find(l=>l.id===id)).filter(Boolean):entries
    ordered.forEach((l:typeof entries[number])=>{const row=sheet.addRow(l);if(l.kind==='已撤销付款')row.font={strike:true,color:{argb:'FF777777'}}})
  }
  sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}]
  sheet.getColumn('cost').numFmt=sheet.getColumn('paid').numFmt='¥#,##0.00'
  sheet.autoFilter={from:'A1',to:'G1'}
  return new Response(new Uint8Array(await book.xlsx.writeBuffer()),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent('外包往来明细.xlsx')}`,'cache-control':'no-store'}})
})

export const GET=handler
export const POST=handler
