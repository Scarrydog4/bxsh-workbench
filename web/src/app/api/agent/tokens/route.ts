import { z } from 'zod'
import { route,json } from '@/server/http'
import { readBody } from '@/server/work-materials'
import { issueAgentToken,listAgentTokens,revokeAgentToken } from '@/server/agent-access'
export const GET=route(async(_req,c)=>json({rows:await listAgentTokens(c)}))
export const POST=route(async(req,c)=>{
 const body=await readBody(req,z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),name:z.string().trim().min(1).max(80),scopes:z.array(z.enum(['orders','income'])).min(1).max(2),days:z.number().int().min(1).max(90)}),
  z.object({action:z.literal('revoke'),id:z.uuid()}),
 ]))
 if(body.action==='revoke'){await revokeAgentToken(c,body.id);return json({ok:true})}
 return json(await issueAgentToken(c,body.name,[...new Set(body.scopes)],body.days))
})
