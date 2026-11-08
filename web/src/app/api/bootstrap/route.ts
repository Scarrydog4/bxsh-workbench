import { compactOrder } from '@/shared/order-wire'
import { buildBoot, buildBootShell } from '@/server/bootstrap'
import { json, route } from '@/server/http'

export const GET = route(async (req, c) => {
  const started = performance.now()
  const shell = new URL(req.url).searchParams.get('phase') === 'shell'
  const boot = shell ? await buildBootShell(c) : await buildBoot(c, true)
  return json({ ...boot, orders: boot.orders.map(compactOrder) }, { headers: { 'server-timing': `bootstrap;dur=${(performance.now() - started).toFixed(1)}` } })
})
