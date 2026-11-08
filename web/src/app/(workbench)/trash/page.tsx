import { redirect, RedirectType } from 'next/navigation'
export default function Page() { redirect('/admin/trash', RedirectType.replace) }
