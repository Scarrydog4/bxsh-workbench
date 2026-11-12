import { route, json } from '@/server/http'
import { contractorReport, contractorInput, saveContractor, contractorPaymentInput, payContractor, revokeContractorPayment } from '@/server/contractors'
import { readBody } from '@/server/work-materials'
import { z } from 'zod'
export const GET = route(async (_req,c)=>json(await contractorReport(c)))
export const POST = route(async (req,c)=>{
  const body = await readBody(req,z.discriminatedUnion('action',[
    contractorInput.extend({action:z.literal('save')}),
    contractorPaymentInput.extend({action:z.literal('pay')}),
    z.object({action:z.literal('revoke'),id:z.uuid(),reason:z.string().trim().min(1).max(500)}),
  ]))
  if(body.action==='save') await saveContractor(c,body)
  else if(body.action==='pay') await payContractor(c,body)
  else await revokeContractorPayment(c,body.id,body.reason)
  return json({ok:true})
})
