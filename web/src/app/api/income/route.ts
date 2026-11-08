import { json,route,deny } from '@/server/http'
import { incomeRows } from '@/server/bootstrap'
import { can } from '@/shared/perm'
export const GET=route(async(req,c)=>{
 const q=new URL(req.url).searchParams,target=q.get('user')??c.me.id
 if(target!==c.me.id&&!can(c.role,'income.all'))throw deny()
 // 每页都要重算全部收入，客户端一次多取能省掉东京来回的几趟请求
 const ids=q.get('orders')?.split(','),offset=Math.max(0,Number(q.get('offset'))||0),limit=Math.min(2000,Math.max(1,Number(q.get('limit'))||100)),rows=(await incomeRows(c,target)).filter(r=>!ids||ids.includes(r.id))
 return json({rows:rows.slice(offset,offset+limit),next:offset+limit<rows.length?offset+limit:null,total:rows.length})
})
