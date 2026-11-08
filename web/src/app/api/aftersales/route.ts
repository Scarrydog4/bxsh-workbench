import { json, route } from '@/server/http'
import { afterSaleTasks } from '@/server/aftersales'
export const GET=route(async(req,c)=>{const ids=new URL(req.url).searchParams.get('orders')?.split(',');return json({tasks:(await afterSaleTasks(c)).filter(a=>!ids||ids.includes(a.orderId))})})
