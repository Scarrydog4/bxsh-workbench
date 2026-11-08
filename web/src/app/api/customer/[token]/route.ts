import { customerRoute, getCustomerPortal, submitCustomerRequest } from '@/server/customer-portal'
import { json } from '@/server/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = customerRoute<{ token: string }>(async (req, { token }) => json(await getCustomerPortal(req, token)))
export const POST = customerRoute<{ token: string }>(async (req, { token }) => json(await submitCustomerRequest(req, token)))
