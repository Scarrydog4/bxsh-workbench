import { redirect, RedirectType } from 'next/navigation'
export default function Page() { redirect('/admin/settings', RedirectType.replace) }
