import { redirect, RedirectType } from 'next/navigation'
export default function Page() { redirect('/payroll', RedirectType.replace) }
