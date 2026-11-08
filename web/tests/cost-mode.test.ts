import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { as, closeDb, resetDb, type Client } from './helpers'
import { sql } from '@/server/db'
import { getCtx } from '@/server/session'
import { calc } from '@/shared/calc'
import { dueItems } from '@/shared/settle'
import { buildIncomeReport, incomeReportSelection } from '@/shared/income-report'
import type { Order } from '@/shared/types'
import { GET as reportGet } from '@/app/api/reports/income/route'
import { GET as settleOrderGet } from '@/app/api/settle/order/route'
import { POST as channelExport } from '@/app/api/export/channel/route'
import { GET as statementGet } from '@/app/api/statement/route'
let boss: Client, sales: Client, writer: Client, channelId: string, hiddenChannel: string
beforeAll(async () => {
  await resetDb(); boss=await as('boss'); sales=await as('acheng'); writer=await as('xiaosenkai')
  channelId=(await boss.act('channel.create',{name:'底价测试渠道',ownerId:'u-acheng'})).body.id
  hiddenChannel=(await boss.act('channel.create',{name:'其他销售渠道',ownerId:'u-yang'})).body.id
})
afterAll(closeDb)
const base = () => ({title:'底价测试订单',ownerId:'u-acheng',orderDate:'2026-10-11',dueDate:null,basePrice:500,assignees:[{userId:'u-xiao',pay:80}]})
const view = async (id: string) => (await boss.boot()).body.orders.find((o: any) => o.id === id)
async function create(patch: Record<string, unknown> = {}, client = boss) {
  const response=await client.act('order.create',{...base(),salesMode:'cost',...patch})
  expect(response.status).toBe(200)
  return response.body.id as string
}
const fixture = (patch: Partial<Order> = {}): Order => ({
  id:'calc',no:'DD1',title:'计算',orderDate:'2026-10-11',dueDate:null,ownerId:'sales',creatorId:'sales',channelId:'',channelNo:'',wechatGroup:'',draftAt:'2026-10-11T00:00:00Z',type:'',basePrice:500,adjustments:[],assignees:[{userId:'writer',pay:80}],status:'已交付',note:'',commissionRate:0.5,salesMode:'cost',payments:[],attachments:[],afterSales:[],settlements:[],req:{},nodes:[],receivables:[],reviewFlag:null,deletedAt:null,...patch,
})
it('底价500外部写手80老板净420，销售提成为0；历史缺省模式仍分成', () => {
  const o=fixture()
  expect(calc(o,new Set(['boss']))).toMatchObject({sales:500,commission:0,profit:420,bossIncome:420,unpaid:500,payPending:false})
  expect(dueItems(o,'销售提成','sales',new Set(['boss']))).toEqual([])
  expect(calc({...o,salesMode:undefined},new Set(['boss']))).toMatchObject({commission:210,bossIncome:210})
})
it('底价老板自写无内部成本；外写工资未知仍待定；追加工资扣成本不产生提成', () => {
  expect(calc(fixture({assignees:[{userId:'boss',pay:null}]}),new Set(['boss']))).toMatchObject({bossIncome:500,payPending:false,commission:0})
  const internal=fixture({assignees:[{userId:'boss',pay:120}]})
  expect(calc(internal,new Set(['boss']))).toMatchObject({writerTotal:0,bossIncome:500,profit:500,commission:0})
  expect(calc({...internal,salesMode:'commission'},new Set(['boss']))).toMatchObject({writerTotal:120,commission:190})
  expect(calc(fixture({assignees:[{userId:'boss',pay:120},{userId:'writer',pay:80}]}),new Set(['boss']))).toMatchObject({writerTotal:80,bossIncome:420})
  expect(calc(fixture({assignees:[{userId:'writer',pay:null}]}),new Set(['boss']))).toMatchObject({payPending:true,commission:0})
  const o=fixture({afterSales:[{writerId:'writer',extra:20,doneAt:'2026-10-11T00:00:00Z',start:'2026-10-11T00:00:00Z'} as any]})
  expect(calc(o,new Set(['boss'])).bossIncome).toBe(400)
  expect(dueItems(o,'销售提成','sales',new Set(['boss']))).toEqual([])
})
it('底价真实收款只算销售交老板，退款扣减、撤销排除，跨期按付款日统计', () => {
  const o=fixture({orderDate:'2026-09-30',payments:[{id:'p',amount:500,date:'2026-10-11',tag:'全款',by:'sales',note:''},{id:'r',amount:50,date:'2026-10-11',tag:'退款',by:'boss',note:''},{id:'x',amount:500,date:'2026-10-11',tag:'全款',by:'sales',note:'',revoked:{at:'2026-10-11',by:'boss',reason:'重复'}}]})
  expect(calc(o,new Set(['boss']))).toMatchObject({received:450,unpaid:50,bossIncome:420})
  const r=buildIncomeReport({orders:[o],users:[],channels:[]},new Set(['boss']),incomeReportSelection({dates:['2026-10-11']}))
  expect(r.summary).toMatchObject({knownNetIncome:0,netReceipts:450,refunds:50})
  expect(r.orders[0].channelName).toBe('未填渠道')
})
it('cost允许省略或清空渠道，真实库字段NULL且未创建虚构渠道', async () => {
  const before=await sql`select count(*)::int as n from channels`
  for(const patch of [{},{channelId:''}]){
    const id=await create(patch)
    expect(await view(id)).toMatchObject({salesMode:'cost',channelId:'',sales:500,bossIncome:420,commission:0,unpaid:500})
    expect((await sql`select channel_id, sales_mode from orders where id=${id}`)[0]).toEqual({channel_id:null,sales_mode:'cost'})
  }
  expect(await sql`select count(*)::int as n from channels`).toEqual(before)
})
it('账号默认只影响新订单，显式每单模式优先，账号默认仅管理权限可改', async () => {
  const old=await create({salesMode:'commission',channelId})
  expect((await sales.act('user.update',{id:'u-acheng',patch:{salesMode:'cost'}})).status).toBe(403)
  expect((await boss.act('user.update',{id:'u-acheng',patch:{salesMode:'cost'}})).status).toBe(200)
  expect((await sales.boot()).body.me.salesMode).toBe('cost')
  expect((await getCtx(new Request('http://test.local',{headers:{cookie:sales.cookie}})))?.me.salesMode).toBe('cost')
  const inherited=await create({salesMode:undefined},sales)
  expect(await view(inherited)).toMatchObject({salesMode:'cost',channelId:''})
  const explicit=await create({salesMode:'commission',channelId},sales)
  expect((await view(explicit)).salesMode).toBe('commission')
  expect((await view(old)).salesMode).toBe('commission')
  expect((await boss.act('user.update',{id:'u-acheng',patch:{salesMode:'commission'}})).status).toBe(200)
  expect((await view(inherited)).salesMode).toBe('cost')
})
it('提成模式仍须合法渠道，底价填写渠道也不能越权；非法枚举拒绝', async () => {
  for(const patch of [{salesMode:'commission'},{salesMode:'bad'},{salesMode:'cost',channelId:'missing'}]) expect((await sales.act('order.create',{...base(),...patch})).status).not.toBe(200)
  expect((await sales.act('order.create',{...base(),salesMode:'cost',channelId:hiddenChannel})).status).toBe(404)
  expect((await boss.act('user.update',{id:'u-acheng',patch:{salesMode:'bad'}})).status).toBe(400)
  const id=await create()
  expect((await boss.act('order.update',{id,patch:{salesMode:'bad'}})).status).toBe(400)
  expect((await boss.act('order.update',{id,patch:{salesMode:'commission'}})).status).toBe(400)
  expect((await boss.act('order.update',{id,patch:{salesMode:'commission',channelId}})).status).toBe(200)
  expect((await boss.act('order.update',{id,patch:{channelId:''}})).status).toBe(400)
  expect((await boss.act('order.update',{id,patch:{salesMode:'cost',channelId:''}})).status).toBe(200)
})
it('逐单切换保持price/assign与工资权限，不能通过模式变更归属或工资', async () => {
  const id=await create({channelId,salesMode:'commission'})
  expect((await writer.act('order.update',{id,patch:{salesMode:'cost'}})).status).toBe(403)
  expect((await sales.act('order.update',{id,patch:{salesMode:'cost',ownerId:'u-boss'}})).status).toBe(403)
  expect((await sales.act('order.update',{id,patch:{salesMode:'cost'}})).status).toBe(400)
  expect((await sales.act('order.update',{id,reason:'按老板底价结算',patch:{salesMode:'cost',channelId:''}})).status).toBe(200)
  expect((await sales.act('order.setWriters',{id,writers:[{userId:'u-xiao',pay:1}]})).status).toBe(403)
  const salesView=(await sales.boot()).body.orders.find((o:any)=>o.id===id)
  expect(salesView.salesMode).toBe('cost'); expect(salesView.assignees[0].pay).toBeUndefined(); expect(salesView.bossIncome).toBeUndefined()
})
it('已有销售提成草稿或确认结算的订单不能切换，作废草稿后可切换', async () => {
  const id=await create({channelId,salesMode:'commission'})
  const draft=await boss.act('settle.save',{kind:'销售提成',payeeId:'u-acheng',lines:[{orderId:id,amount:100}],note:''})
  expect(draft.status).toBe(200)
  expect((await boss.act('order.update',{id,patch:{salesMode:'cost'}})).status).toBe(400)
  expect((await boss.act('settle.void',{id:draft.body.id,reason:'改为底价'})).status).toBe(200)
  expect((await boss.act('order.update',{id,patch:{salesMode:'cost'}})).status).toBe(200)
  const paidId=await create({channelId,salesMode:'commission'})
  const paid=await boss.act('settle.pay',{requestId:randomUUID(),orderId:paidId,kind:'销售提成',payeeId:'u-acheng',amount:100})
  expect(paid.status).toBe(200)
  expect((await boss.act('order.update',{id:paidId,patch:{salesMode:'cost'}})).status).toBe(400)
  expect((await view(paidId)).salesMode).toBe('commission')
})
it('底价单默认无应得提成，老板仍可自由发放，收款500后未收为0且老板净420', async () => {
  const id=await create()
  expect((await sales.act('order.addPayment',{id,amount:500,date:'2026-10-11',tag:'全款',note:'销售上交底价'})).status).toBe(200)
  expect(await view(id)).toMatchObject({received:500,unpaid:0,bossIncome:420,commission:0})
  const boot=(await boss.boot()).body
  expect(boot.income['u-acheng']?.some((r:any)=>r.id===id)).not.toBe(true)
  expect(boot.income['u-boss'].find((r:any)=>r.id===id).amount).toBe(420)
  expect((await boss.act('settle.pay',{requestId:randomUUID(),orderId:id,kind:'销售提成',payeeId:'u-acheng',amount:1})).status).toBe(200)
  expect((await boss.act('settle.save',{kind:'销售提成',payeeId:'u-acheng',lines:[{orderId:id,amount:1}]})).status).toBe(200)
})
it('空渠道底价订单通用导出和收入报表可用，渠道对账空参数返回404不报500', async () => {
  const id=await create()
  const result=await boss.exportXlsx([id]); expect(result.status).toBe(200)
  const wb=new ExcelJS.Workbook(); await wb.xlsx.load(result.buf as any)
  expect(JSON.stringify(wb.worksheets[0].getRow(2).values)).toContain('底价结算')
  const report=await reportGet(new Request('http://test.local/api/reports/income?from=2026-10-11&to=2026-10-11',{headers:{cookie:boss.cookie}}),{params:Promise.resolve({})})
  expect(report.status).toBe(200)
  const data=await report.json(); expect(data.orders.find((o:any)=>o.id===id)).toMatchObject({netIncome:420,commissionCost:0,channelId:''})
  const statement=await statementGet(new Request('http://test.local/api/statement?channelId=&month=2026-10',{headers:{cookie:boss.cookie}}),{params:Promise.resolve({})})
  expect(statement.status).toBe(404)
})

it('无渠道报表分组和筛选使用独立标记，交叉筛选不混入其他渠道', async () => {
  const empty=await create(), named=await create({channelId})
  const response=await reportGet(new Request('http://test.local/api/reports/income?from=2026-10-11&to=2026-10-11&channelId=__none__&ownerId=u-acheng',{headers:{cookie:boss.cookie}}),{params:Promise.resolve({})})
  expect(response.status).toBe(200)
  const result=await response.json()
  expect(result.orders.some((o:any)=>o.id===empty)).toBe(true)
  expect(result.orders.some((o:any)=>o.id===named)).toBe(false)
  expect(result.orders.every((o:any)=>o.channelId===''&&o.ownerId==='u-acheng')).toBe(true)
  expect(result.channels.map((c:any)=>c.id)).toEqual(['__none__'])
  expect(result.options.channels).toContainEqual({id:'__none__',name:'未填渠道'})
})
it('即使工资未定，底价销售结算与导出的提成都明确为0', async () => {
  const id=await create({assignees:[{userId:'u-xiao',pay:null}]})
  const response=await settleOrderGet(new Request(`http://test.local/api/settle/order?order=${id}&payee=u-acheng&kind=${encodeURIComponent('销售提成')}`,{headers:{cookie:boss.cookie}}),{params:Promise.resolve({})})
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({amount:0,unpaid:0,available:0})
  const result=await boss.exportXlsx([id]);const wb=new ExcelJS.Workbook();await wb.xlsx.load(result.buf as any)
  const ws=wb.worksheets[0], cols=ws.getRow(1).values as any[]
  expect(ws.getRow(2).getCell(cols.indexOf('销售提成')).value).toBe(0)
})
it('渠道对账与渠道专用导出不向渠道混入内部底价订单', async () => {
  const cost=await create({channelId,title:'内部底价不可发给渠道'}), normal=await create({channelId,salesMode:'commission',title:'正常渠道单'})
  const response=await statementGet(new Request(`http://test.local/api/statement?channelId=${channelId}&month=2026-10`,{headers:{cookie:boss.cookie}}),{params:Promise.resolve({})})
  expect(response.status).toBe(200)
  const data=await response.json()
  expect(data.rows.some((row:any)=>row.title==='内部底价不可发给渠道')).toBe(false)
  expect(data.rows.some((row:any)=>row.title==='正常渠道单')).toBe(true)
  const exported=await channelExport(new Request('http://test.local/api/export/channel',{method:'POST',headers:{cookie:boss.cookie,'content-type':'application/json'},body:JSON.stringify({channelId,columns:['no','title','sales'],language:'zh'})}),{params:Promise.resolve({})})
  expect(exported.status).toBe(200)
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await exported.arrayBuffer()) as any)
  const output=JSON.stringify(wb.worksheets[0].getSheetValues())
  expect(output).not.toContain('内部底价不可发给渠道');expect(output).toContain('正常渠道单')
})
