import { redirect } from 'next/navigation'

/**
 * 卡片二维码的落地页：/o/<单号>[?as=<轮次>] → 首页打开这单。
 * 没登录时首页会带着这个地址去登录，登录完再回来；看不到这单的会提示「找不到」。
 */
export default async function OrderLink({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ as?: string }> }) {
  const { no } = await params
  const { as } = await searchParams
  const q = new URLSearchParams({ o: no })
  if (as && /^\d+$/.test(as)) q.set('as', as)
  redirect(`/?${q}`)
}
