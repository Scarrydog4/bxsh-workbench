import type { Metadata } from 'next'
import { CustomerPortal } from '@/client/CustomerPortal'

export const metadata: Metadata = {
  title: '订单服务 · 笔下工单',
  description: '查看订单进度、发送催办与补充要求。',
  robots: { index: false, follow: false, noarchive: true, nocache: true },
  referrer: 'no-referrer',
}

export default async function CustomerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <CustomerPortal key={token} token={token}/>
}
