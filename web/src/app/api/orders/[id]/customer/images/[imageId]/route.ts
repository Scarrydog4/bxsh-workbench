import { getInternalCustomerImage } from '@/server/customer-portal'
import { route } from '@/server/http'

export const runtime = 'nodejs'
export const GET = route<{ id: string; imageId: string }>((req, ctx, { id, imageId }) => getInternalCustomerImage(req, id, imageId, ctx))
export const HEAD = GET
