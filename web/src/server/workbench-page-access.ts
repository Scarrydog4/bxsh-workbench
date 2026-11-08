import { headers } from 'next/headers'
import { redirect, RedirectType } from 'next/navigation'
import { getCtx } from './session'

/** Page-level checks preserve the exact destination when a shared admin URL needs login. */
export async function requireAdminPage(path: string) {
  const ctx = await getCtx(new Request(`http://workbench.local${path}`, { headers: await headers() }))
  if (!ctx) redirect(`/login?next=${encodeURIComponent(path)}`, RedirectType.replace)
  if (!ctx.role.locked) redirect('/', RedirectType.replace)
}
