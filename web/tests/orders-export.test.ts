import ExcelJS from 'exceljs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CHANNEL_PAYMENT_CATEGORIES } from '@/shared/channel-export'
import type { Order, Payment, Role } from '@/shared/types'

const h=vi.hoisted(()=>({ctx:null as any,world:{} as any,audit:vi.fn()}))
vi.mock('@/server/session',()=>({getCtx:async()=>h.ctx}))
vi.mock('@/server/repo',()=>({loadWorld:async()=>h.world,adminIdsOf:()=>new Set(['boss'])}))
vi.mock('@/server/db',()=>({db:{insert:()=>({values:h.audit})}}))
import { GET } from '@/app/api/export/orders/route'

const payment=(id:string,amount:number,patch:Partial<Payment>={}):Payment=>({id,amount,date:'2026-11-02',tag:'定金',note:'内部收款备注',by:'sales',...patch})
const order=(id:string,patch:Partial<Order>={}):Order=>({id,no:`DD-${id}`,title:`订单-${id}`,orderDate:'2026-11-01',dueDate:null,channelId:'c1',ownerId:'sales',creatorId:'boss',channelNo:`渠道号-${id}`,wechatGroup:`群-${id}`,draftAt:null,type:'论文',basePrice:1000,adjustments:[],assignees:[{userId:'writer',pay:100}],commissionRate:.2,status:'未交付',note:`备注-${id}`,payments:[],attachments:[],afterSales:[],settlements:[],req:{},nodes:[],receivables:[],reviewFlag:null,deletedAt:null,...patch})
const role=(patch:Partial<Role>={}):Role=>({id:'r',name:'角色',preset:false,locked:false,perms:['order.view','order.export'],rowScope:'owned',fields:{sales:true,channelNo:false,writerPay:'none',commission:'own',profit:false},...patch})
const request=(ids?:string[])=>GET(new Request(`http://test/api/export/orders${ids ? `?ids=${ids.join(',')}` : ''}`),{params:Promise.resolve({})})
const workbook=async(response:Response)=>{const book=new ExcelJS.Workbook();await book.xlsx.load(await response.arrayBuffer());return book}
const headers=(sheet:ExcelJS.Worksheet)=>{const cells=(sheet.getRow(1).values as unknown[]).slice(1),gap=cells.findIndex(value=>value==null);return cells.slice(0,gap<0 ? undefined : gap) as string[]}
const value=(sheet:ExcelJS.Worksheet,row:number,header:string)=>sheet.getCell(row,headers(sheet).indexOf(header)+1).value
const fillColor=(cell:ExcelJS.Cell)=>cell.fill?.type==='pattern' ? cell.fill.fgColor?.argb : undefined

beforeEach(()=>{
  h.ctx={me:{id:'boss',mustChangePassword:false},role:{locked:true,perms:[],fields:{},rowScope:'all'},ip:'test'}
  h.world={orders:[
    order('none'),order('partial',{payments:[payment('deposit',300)]}),order('full',{payments:[payment('full',1000)]}),
    order('extra',{payments:[payment('extra',1200)]}),order('returned',{status:'退单',payments:[payment('returned',200)]}),
    order('cost',{salesMode:'cost',basePrice:400,assignees:[{userId:'writer',pay:80}]}),
  ],channels:[{id:'c1',name:'测试渠道',ownerId:'sales'}],users:[{id:'boss',name:'老板'},{id:'sales',name:'销售'},{id:'writer',name:'写手'}]}
})
afterEach(()=>vi.clearAllMocks())

it('总表用唯一收款分类紧邻订单名称，订单顺序、原字段和数值金额保留，四类颜色与图例一致',async()=>{
  const response=await request()
  expect(response.status).toBe(200)
  const book=await workbook(response),sheet=book.worksheets[0],columns=headers(sheet)
  expect(columns).toEqual(['订单编号','订单名称','收款分类','结算方式','下单日期','截止日期','状态','渠道','类型','归属销售','写手','群内交付日期','微信群','渠道单号','应收金额','已收','未收','写手工资','销售提成','额外成本','扣成本后分成基数','预计利润','备注'])
  expect(book.worksheets).toHaveLength(1)
  const expected=[['none','未收定金',1000,0,1000],['partial','未付尾款',1000,300,700],['full','已收齐',1000,1000,0],['extra','已收齐',1000,1200,-200],['returned','退单',1000,200,800],['cost','未收定金',400,0,400]] as const
  for(const [index,[id,label,sales,received,unpaid]] of expected.entries()) {
    const row=index+2,category=CHANNEL_PAYMENT_CATEGORIES.find(item=>item.label===label)!
    expect(value(sheet,row,'订单编号')).toBe(`DD-${id}`)
    expect(value(sheet,row,'订单名称')).toBe(`订单-${id}`)
    expect(value(sheet,row,'收款分类')).toBe(label)
    expect(value(sheet,row,'应收金额')).toBe(sales)
    expect(value(sheet,row,'已收')).toBe(received)
    expect(value(sheet,row,'未收')).toBe(unpaid)
    expect(value(sheet,row,'备注')).toBe(`备注-${id}`)
    for(let column=1;column<=columns.length;column++) expect(fillColor(sheet.getCell(row,column))).toBe(`FF${category.background.slice(1)}`)
    expect(sheet.getCell(row,3).font).toMatchObject({bold:true,color:{argb:`FF${category.color.slice(1)}`}})
  }
  expect(value(sheet,2,'写手工资')).toBe(100)
  expect(value(sheet,2,'销售提成')).toBe(180)
  expect(value(sheet,2,'预计利润')).toBe(720)
  expect(value(sheet,7,'结算方式')).toBe('底价结算（销售交老板）')
  expect(value(sheet,7,'写手工资')).toBe(80)
  expect(value(sheet,7,'销售提成')).toBe(0)
  expect(value(sheet,7,'预计利润')).toBe(320)
  expect(sheet.getColumn(columns.indexOf('未收')+1).numFmt).toBe('¥#,##0.00')
  for(let column=1;column<=columns.length;column++) expect(fillColor(sheet.getCell(1,column))).toBeUndefined()
  expect(sheet.getCell(1,columns.length+2).value).toBe('收款分类')
  expect(sheet.getCell(1,columns.length+3).value).toBe('说明')
  for(const [index,category] of CHANNEL_PAYMENT_CATEGORIES.entries()) {
    expect(sheet.getCell(index+2,columns.length+2).value).toBe(category.label)
    expect(sheet.getCell(index+2,columns.length+3).value).toBe(category.description)
    expect(fillColor(sheet.getCell(index+2,columns.length+2))).toBe(`FF${category.background.slice(1)}`)
  }
  expect(sheet.views[0]).toMatchObject({state:'frozen',ySplit:1,xSplit:2})
  expect(sheet.autoFilter).toBe('A1:W1')
  expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({objectLabel:'订单 Excel · 6 单'}))
})

it('没有销售额权限的写手总表不出现分类、底色、图例或财务字段，本人工资和可见订单仍保留',async()=>{
  h.ctx={...h.ctx,me:{id:'writer'},role:role({rowScope:'assigned',fields:{sales:false,channelNo:false,writerPay:'own',commission:'none',profit:false}})}
  h.world.orders.push(order('hidden',{assignees:[{userId:'other',pay:700}]}))
  const sheet=(await workbook(await request())).worksheets[0],columns=headers(sheet)
  expect(columns).toContain('我的工资')
  for(const title of ['收款分类','收款状态','应收金额','已收','未收','写手工资','销售提成','预计利润','渠道单号','说明']) expect(columns).not.toContain(title)
  expect(sheet.columnCount).toBe(columns.length)
  expect(sheet.rowCount).toBe(7)
  expect(value(sheet,2,'我的工资')).toBe(100)
  expect(value(sheet,7,'我的工资')).toBe(80)
  for(let row=2;row<=sheet.rowCount;row++) for(let column=1;column<=columns.length;column++) expect(fillColor(sheet.getCell(row,column))).toBeUndefined()
  expect(JSON.stringify(sheet.model)).not.toContain('订单-hidden')
  expect(JSON.stringify(sheet.model)).not.toContain('尚无有效收款')
})

it('销售勾选只导可见行并维持原顺序，新增图例不扩大工资权限，退款与撤销仍按净已收分类',async()=>{
  h.ctx={...h.ctx,me:{id:'sales'},role:role()}
  h.world.orders.push(order('hidden',{ownerId:'other'}))
  h.world.orders[0].payments=[payment('refund',30,{tag:'退款'}),payment('revoked',100,{revoked:{at:'2026-11-02',by:'boss',reason:'撤销'}})]
  const sheet=(await workbook(await request(['partial','none','hidden']))).worksheets[0],columns=headers(sheet)
  expect(value(sheet,2,'订单名称')).toBe('订单-none')
  expect(value(sheet,3,'订单名称')).toBe('订单-partial')
  expect(value(sheet,2,'收款分类')).toBe('未收定金')
  expect(value(sheet,2,'已收')).toBe(-30)
  expect(value(sheet,2,'未收')).toBe(1030)
  expect(value(sheet,2,'销售提成')).toBe(180)
  for(const title of ['写手工资','我的工资','预计利润','渠道单号']) expect(columns).not.toContain(title)
  expect(JSON.stringify(sheet.model)).not.toContain('订单-hidden')
  expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({objectLabel:'订单 Excel · 2 单'}))
})

it('总表继续要求登录及订单查看和导出权限',async()=>{
  h.ctx=null
  expect((await request()).status).toBe(401)
  for(const perms of [['order.view'],['order.export']] as const) {
    h.ctx={me:{id:'sales'},role:role({perms:[...perms]})}
    expect((await request()).status).toBe(403)
  }
  expect(h.audit).not.toHaveBeenCalled()
})
