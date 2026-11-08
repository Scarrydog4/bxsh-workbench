import { route } from '@/server/http'
import { workImage } from '@/server/work-materials'
export const GET = route<{ id: string }>((req, c, { id }) => workImage(req, c, id, true))
export const HEAD = GET
