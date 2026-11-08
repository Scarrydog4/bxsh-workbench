import path from 'node:path'
import { env } from '@/server/env'
import { fileResponse } from '@/server/range-response'
export async function GET(req:Request,{params}:{params:Promise<{name:string}>}) {
  const {name}=await params
  const missing=()=>new Response(null,{status:404,headers:{'x-content-type-options':'nosniff'}})
  if(!/^[a-f0-9]{64}(\.96)?\.webp$/.test(name))return missing()
  try {return await fileResponse(req,{path:path.join(env.storageDir,'avatars',name),name,mime:'image/webp',id:name,inline:true,cacheControl:'public, max-age=31536000, immutable',publicContent:true})}catch{return missing()}
}
export const HEAD = GET
