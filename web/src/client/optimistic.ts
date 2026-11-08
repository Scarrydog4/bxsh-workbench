import { cents, sumMoney } from '@/shared/calc'
import type { OrderView, Payment } from '@/shared/types'
import type { AfterSaleTask } from '@/shared/aftersale-task'

type AfterSaleView=OrderView['afterSales'][number]
export type Preview={ids:Set<string>;order:(order:OrderView)=>OrderView;afterSale?:(a:AfterSaleView)=>AfterSaleView}
/** 只修改已获准下发的字段；服务端仍负责权限、金额和时效的最终判定。 */
export function previewChange(name:string,payload:unknown,actor:string,now=Date.now()):Preview|null {
 const i=payload as {id:string;ids?:string[];patch?:Record<string,unknown>;status:string;requestId:string;amount:number;date:string;tag:string;note:string;proof?:string;orderId:string;asId:string;hours?:number;due:string}
 if(name==='order.update'&&i.patch&&Object.keys(i.patch).length===1&&typeof i.patch.status==='string' || name==='order.bulkStatus'){
  return{ids:new Set(i.ids??[i.id]),order:o=>({...o,status:typeof i.patch?.status==='string'?i.patch.status:i.status})}
 }
 if(name==='order.addPayment')return{ids:new Set([i.id]),order:o=>{
  if(o.sales===undefined||!o.payments)return o
  const id=`pay_${i.requestId}`
  if(o.payments.some(p=>p.id===id))return o
  const payments:Payment[]=[...o.payments,{id,amount:i.amount,date:i.date,tag:i.tag,note:i.note,proof:i.proof,by:actor}]
  const received=sumMoney(payments.filter(p=>!p.revoked).map(p=>p.tag==='退款'?-p.amount:p.amount))
  return{...o,payments,received,unpaid:(cents(o.sales)-cents(received))/100,payStatus:received>=o.sales&&o.sales>0?'已收齐':received>0?'部分收款':'未收款',paymentCheckedAt:null,paymentCheckedBy:null}
 }}
 // 交付成功会移除待办并卸载截图表单，须等服务器确认，失败时才能原地重试。
 if(name==='aftersale.confirm'){
  const afterSale=(a:AfterSaleView):AfterSaleView=>{
   if(a.id!==i.asId||a.doneAt||a.cancelledAt)return a
   if(a.confirmedAt||!a.confirmBy)return a
   const expired=now>=Date.parse(a.confirmBy)
   return{...a,confirmedAt:new Date(now).toISOString(),chosenHours:expired?24:i.hours??null,due:expired?a.due:i.hours?new Date(now+i.hours*3600000).toISOString():i.due}
  }
  return{ids:new Set([i.orderId]),afterSale,order:o=>({...o,afterSales:o.afterSales.map(afterSale)})}
 }
 return null
}
export function previewTask(task:AfterSaleTask,preview:Preview):AfterSaleTask {
 return preview.ids.has(task.orderId)&&preview.afterSale?{...task,...preview.afterSale(task)}:task
}
