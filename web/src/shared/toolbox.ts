export type RewriteLanguage = 'CN' | 'EN' | 'RU' | 'JA'
export const REWRITE_LANGUAGES: Record<RewriteLanguage, string> = { CN: '中文', EN: '英文', RU: '俄语', JA: '日语' }
export interface WordStats { chinese: number; english: number; paragraphs: number; total: number }
export interface RewritePlatform {
  id: string
  name: string
  languages: RewriteLanguage[]
  platform?: string
  preset?: string
  presetZh?: string
  presetEn?: string
  modeName?: string
  service?: RewriteService
  permissionLevel?: number
}

export type RewriteService = '降重' | '降AI' | '双降'
export interface RewriteOptions {
  service: RewriteService | 'AI预测' // 兼容已结束的历史测试，新任务不提供检测
  platform: string
  preset: string
  presetZh?: string
  presetEn?: string
  whitelist: string
  inputKind: 'file' | 'text'
}
export interface RewriteProviderState {
  formatPreserved?: boolean
  preservation?: { changedParagraphs: number; changedChineseParagraphs: number; changedEnglishParagraphs: number; protectedDataSentences: number; protectedReferenceParagraphs: number; protectedFormattingParagraphs: number; keptForLayout: number }
  recordId?: string
  resultUrl?: string
  diffUrl?: string
  progress?: number
  text?: string
  stats?: Record<string, unknown>
  detection?: Record<string, any>
  resultFormat?: 'html' | 'json'
  reportFiles?: { html_detail_url?: string; preview_url?: string; pdf_summary_url?: string; pdf_enabled?: boolean; pdf_available?: boolean }
}

export type RewriteStatus = 'draft' | 'queued' | 'submitting' | 'processing' | 'unknown' | 'saving' | 'completed' | 'failed'

export interface RewriteJobView {
  id: string
  name: string
  platform: string
  language: RewriteLanguage
  status: RewriteStatus
  message: string | null
  createdAt: string
  updatedAt: string
  orderId: string | null
  orderNo: string | null
  orderTitle: string | null
  userId: string
  actorName: string
  resultName: string | null
  resultAttachmentId: string | null
  batchId: string | null
  points: number
  inputKind?: 'file' | 'text'
  service?: RewriteService | 'AI预测'
  progress?: number
  hasDiff?: boolean
  resultSize?: number
  sourceSize?: number
  hasReport?: boolean
  hasPdf?: boolean
}

export const REWRITE_LABELS: Record<RewriteStatus, string> = {
  draft: '等待确认下单', queued: '等待处理', submitting: '正在提交', processing: '处理中', unknown: '正在确认状态',
  saving: '正在保存结果', completed: '已完成', failed: '处理失败',
}

export const MAX_REWRITE_INPUT = 10 * 1024 * 1024
export const MAX_REWRITE_RESULT = 40 * 1024 * 1024
export const MAX_REWRITE_BATCH = 20
export const MAX_REWRITE_TEXT = 100_000
