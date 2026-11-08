import { route } from '@/server/http'
import { downloadCaseGallery } from '@/server/work-materials'

export const GET = route<{id:string}>((_,c,{id})=>downloadCaseGallery(c,id))
