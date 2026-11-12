'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { buildReward } from '@/shared/rewards'
import { money } from '@/shared/format'
import { getState } from '../store'
import { REWARD_EVENT, type RewardTrigger } from './celebrate'

/**
 * 录单、交付、发起跟进成功后撒一把花（开源的 canvas-confetti）。
 * 画在一层不接收鼠标的全屏画布上，约一秒半散完，不弹窗、不抢焦点，不耽误接着录下一单。
 * 有钱就在角落用一条提示带上金额；系统开了「减少动态效果」时只留提示，不撒花。
 */
const COLORS = ['#f5c451', '#3fbf9a', '#f29bb5', '#8fb8ff', '#f4f1e8']

async function burst(big: boolean) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const confetti = (await import('canvas-confetti')).default
  const base = { colors: COLORS, disableForReducedMotion: true, zIndex: 300, ticks: 150, gravity: 1.05, scalar: 0.95 }
  // 左右两侧向中间各喷一把，像礼花；有钱入账时中间再补一发
  confetti({ ...base, particleCount: big ? 70 : 45, angle: 60, spread: 62, startVelocity: 52, origin: { x: 0, y: 0.72 } })
  confetti({ ...base, particleCount: big ? 70 : 45, angle: 120, spread: 62, startVelocity: 52, origin: { x: 1, y: 0.72 } })
  if (big) window.setTimeout(() => confetti({ ...base, particleCount: 60, spread: 360, startVelocity: 28, gravity: 0.8, origin: { x: 0.5, y: 0.38 } }), 180)
}

export function RewardHost() {
  useEffect(() => {
    const onReward = (e: Event) => {
      const trigger = (e as CustomEvent<RewardTrigger>).detail
      const s = getState()
      const order = s?.orders.find((o) => o.id === trigger.orderId)
      if (!s || !order) return
      const followup = trigger.afterSaleId ? order.afterSales.find((a) => a.id === trigger.afterSaleId) : undefined
      const data = buildReward({ kind: trigger.kind, me: s.me, order, followup })
      void burst(data.amount !== null)
      if (data.amount !== null) toast.success(`${data.amountLabel} +${money(data.amount)}`, { description: data.thanks || undefined, duration: 3500 })
      else if (data.thanks) toast(data.thanks, { duration: 2500 })
    }
    window.addEventListener(REWARD_EVENT, onReward)
    return () => window.removeEventListener(REWARD_EVENT, onReward)
  }, [])
  return null
}
