import { getInternalCustomerPortal, manageCustomerPortal } from '@/server/customer-portal'
import { json, route } from '@/server/http'

export const runtime = 'nodejs'
export const GET = route<{ id: string }>(async (req, ctx, { id }) => json(await getInternalCustomerPortal(id, ctx, Number(new URL(req.url).searchParams.get('offset') ?? 0))))
export const POST = route<{ id: string }>(async (req, ctx, { id }) => json(await manageCustomerPortal(req, id, ctx)))
