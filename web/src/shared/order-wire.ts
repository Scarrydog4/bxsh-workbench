import type { OrderView } from './types'
// 只省略可无损恢复的空字段；金额的缺失代表权限，绝不补成 0。
const defaults={note:'',wechatGroup:'',type:'',dueDate:null,draftAt:null,attachments:[],afterSales:[],nodes:[],req:{}}
export function compactOrder(order:OrderView) {
  const wire={...order} as Partial<OrderView>
  for(const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    if(JSON.stringify(order[key])===JSON.stringify(defaults[key]))delete wire[key]
  }
  return wire
}
export function expandOrder(wire:Partial<OrderView>):OrderView {return {...defaults,...wire} as OrderView}
