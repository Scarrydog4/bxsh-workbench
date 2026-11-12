import { route,json } from '@/server/http'
import { inquiryInput,listInquiries,saveInquiry,archiveInquiry } from '@/server/inquiries'
import { readBody } from '@/server/work-materials'
import { z } from 'zod'
export const GET=route(async(_req,c)=>json({rows:await listInquiries(c)}))
export const POST=route(async(req,c)=>{
  const input=await readBody(req,z.discriminatedUnion('action',[inquiryInput.extend({action:z.literal('save')}),z.object({action:z.literal('archive'),id:z.uuid(),status:z.enum(['active','archived'])})]))
  if(input.action==='save')await saveInquiry(c,input);else await archiveInquiry(c,input.id,input.status)
  return json({ok:true})
})
