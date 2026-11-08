import { z } from 'zod'
import type { SalesMode } from './types'

export const calendarDate = z.iso.date()
const maybeText = (max: number) => z.string().max(max).default('')
export const draftSchema = z.object({
  title: maybeText(200), channelName: maybeText(100), writerName: maybeText(100), type: maybeText(50),
  basePrice: z.number().min(0).max(10_000_000).nullable().default(null),
  costPrice: z.number().min(0).max(10_000_000).nullable().default(null),
  costPriceEvidence: maybeText(300),
  writerPay: z.number().min(0).max(1_000_000).nullable().default(null),
  orderDate: calendarDate.nullable().default(null), dueDate: calendarDate.nullable().default(null),
  channelNo: maybeText(100), note: maybeText(5000),
  warnings: z.array(z.string().max(300)).max(10).default([]),
  imageIndexes: z.array(z.number().int().min(0).max(5)).max(6).default([]),
})
export type OrderDraft = Omit<z.infer<typeof draftSchema>, 'costPrice' | 'costPriceEvidence'> & { channelId: string; writerId: string; salesMode: SalesMode }
export const parsedOrdersSchema = z.object({ orders: z.array(draftSchema).max(20), message: z.string().max(500).default('') })
export const parseInput = z.object({
  text: z.string().max(16000).default(''),
  images: z.array(z.string().max(6_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)).max(6).default([]),
  salesMode: z.enum(['commission', 'cost']).optional(),
}).refine((i) => i.text.trim() || i.images.length, '请粘贴渠道消息或添加截图')
export const confirmInput = z.object({
  batchId: z.uuid(),
  orders: z.array(z.object({
    title: z.string().trim().min(1, '请填写订单名称').max(200),
    channelId: z.string().default(''), newChannelName: z.string().trim().max(50).default(''), ownerId: z.string().min(1),
    salesMode: z.enum(['commission', 'cost']),
    orderDate: calendarDate, dueDate: calendarDate.nullable(),
    type: maybeText(50), basePrice: z.number().min(0).max(10_000_000),
    assignees: z.array(z.object({ userId: z.string().min(1), pay: z.number().min(0).max(1_000_000).nullable() })).max(10),
    channelNo: maybeText(100), note: maybeText(5000),
  })).min(1).max(20),
})
export type ConfirmBatch = z.infer<typeof confirmInput>
export type CreatedOrder = { id: string; no: string }
export type Usage = { calls: number; inputTokens: number; outputTokens: number; estimatedCny: number }
export const conversationHistory = z.array(z.object({ question: z.string().max(1500), answer: z.string().max(8000) }).strict()).max(12)
export type ConversationHistory = z.infer<typeof conversationHistory>
export type AssistantAnswer = { answer: string; scopes: string[]; orders: { id: string; no: string; title: string }[] }
