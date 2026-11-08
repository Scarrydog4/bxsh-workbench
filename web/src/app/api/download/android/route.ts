import path from 'node:path'
import { env } from '@/server/env'
import { ANDROID_RELEASE } from '@/shared/company-resources'
import { fileResponse } from '@/server/range-response'
import { HttpError } from '@/server/http'

/** 只公开固定的安卓安装包；员工首次安装不必先登录。 */
export async function GET(req: Request) {
  try {
    return await fileResponse(req,{path:path.join(env.storageDir,'releases',ANDROID_RELEASE.filename),name:ANDROID_RELEASE.filename,mime:'application/vnd.android.package-archive',id:ANDROID_RELEASE.filename,cacheControl:'no-store'})
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error
    return new Response('安装包暂不可用，请稍后重试',{status:503,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})
  }
}
export const HEAD = GET
