import { z } from 'zod'
import { json,HttpError } from '@/server/http'
import { trustedWriteRequest } from '@/server/request-security'
import { agentContext,queryAgent } from '@/server/agent-access'
const input=z.object({tool:z.enum(['orders_search','income_rows']),query:z.string().max(200).optional(),from:z.iso.date().optional(),to:z.iso.date().optional(),targetId:z.string().max(100).optional(),offset:z.number().int().min(0).max(100000).default(0),limit:z.number().int().min(1).max(50).default(20)}).refine(v=>!v.from||!v.to||v.from<=v.to,'日期范围无效')
export async function POST(req:Request){
 try{
  if(!trustedWriteRequest(req))return json({error:'请使用平台授权的连接'}, {status:403})
  const {c,scopes}=await agentContext(req),body=input.safeParse(await req.json().catch(()=>null))
  if(!body.success)return json({error:'查询条件不正确'}, {status:400})
  return json(await queryAgent(c,scopes,body.data))
 }catch(e){if(e instanceof HttpError)return json({error:e.message},{status:e.status});console.error('Agent query failed');return json({error:'查询暂时不可用'},{status:500})}
}
