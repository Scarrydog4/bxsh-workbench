import { redirect, RedirectType } from 'next/navigation'
export default function Page() { redirect('/tools', RedirectType.replace) }
