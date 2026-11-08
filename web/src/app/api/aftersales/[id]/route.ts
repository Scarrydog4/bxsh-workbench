import { json, notFound, route } from '@/server/http'
import { afterSaleTimeline } from '@/server/aftersales'
export const GET=route<{id:string}>(async(_req,c,p)=>{const result=await afterSaleTimeline(c,p.id);if(!result)throw notFound();return json(result)})
