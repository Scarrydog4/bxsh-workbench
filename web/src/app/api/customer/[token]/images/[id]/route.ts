import { customerRoute, getPublicCustomerImage } from '@/server/customer-portal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = customerRoute<{ token: string; id: string }>((req, { token, id }) => getPublicCustomerImage(req, token, id))
export const HEAD = GET
