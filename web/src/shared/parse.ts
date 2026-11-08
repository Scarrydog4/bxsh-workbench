import type { Channel, SalesMode } from './types'
import { addDays, iso, today } from './format'

/** 录单时可预先填好的字段（粘贴识别、照某单再录一单都用它）。 */
export interface Prefill {
  title?: string
  salesMode?: SalesMode
  ownerId?: string
  channelId?: string
  type?: string
  basePrice?: string
  dueDate?: string
  channelNo?: string
  note?: string
  shots?: string[]
  source?: string
}

const TYPE_WORDS: [RegExp, string][] = [
  [/毕设|毕业设计|系统设计|程序/, '毕业设计'],
  [/开题/, '开题报告'],
  [/降重|查重|改重/, '降重修改'],
  [/ppt|答辩/i, '答辩 PPT'],
  [/课程论文|课设|小论文/, '课程论文'],
  [/论文|毕业论文|本科/, '本科论文'],
]

function parseDate(text: string): string | undefined {
  const t0 = today()
  let m = text.match(/(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*[日号]?/)
  if (m) {
    const d = new Date(t0.getFullYear(), Number(m[1]) - 1, Number(m[2]))
    if (d < addDays(t0, -30)) d.setFullYear(d.getFullYear() + 1)
    return iso(d)
  }
  m = text.match(/(\d{1,2})\s*[号日]\s*(之?前|截止|交)/)
  if (m) {
    const d = new Date(t0.getFullYear(), t0.getMonth(), Number(m[1]))
    if (d < t0) d.setMonth(d.getMonth() + 1)
    return iso(d)
  }
  m = text.match(/(\d{1,2})\s*天(内|之内|后)/)
  if (m) return iso(addDays(t0, Number(m[1])))
  m = text.match(/下(周|星期)([一二三四五六日天])/)
  if (m) {
    const want = '日一二三四五六'.indexOf(m[2] === '天' ? '日' : m[2])
    const d = addDays(t0, 7 - t0.getDay() + (want === 0 ? 7 : want))
    return iso(d)
  }
  if (/明天/.test(text)) return iso(addDays(t0, 1))
  if (/后天/.test(text)) return iso(addDays(t0, 2))
  return undefined
}

/**
 * 把渠道发来的一段话拆成订单字段。原型用规则；正式版交给 DeepSeek（文字和截图都行），
 * 结果同样只填进录单弹窗，人看一眼再保存。
 */
export function parseOrderText(raw: string, channels: Channel[], types: string[]): Prefill {
  const text = raw.replace(/\r/g, '')
  const out: Prefill = { source: '粘贴识别' }

  const ch = [...channels].sort((a, b) => b.name.length - a.name.length).find((c) => text.includes(c.name))
  if (ch) out.channelId = ch.id

  const direct = types.find((t) => text.includes(t))
  out.type = direct ?? TYPE_WORDS.find(([re]) => re.test(text))?.[1]

  const price =
    text.match(/(?:价格|报价|价钱|费用|总价|金额|收费)[:：\s]*[¥￥]?\s*(\d{2,6})/) ??
    text.match(/[¥￥]\s*(\d{2,6})/) ??
    text.match(/(\d{2,6})\s*(?:元|块|r\b|RMB)/i)
  if (price) out.basePrice = price[1]

  const no = text.match(/(?:单号|订单号|编号)[:：\s]*([A-Za-z0-9-]{3,})/)
  if (no) out.channelNo = no[1]

  const due = text.match(/(?:截止|交稿|交付|ddl|DDL|deadline|要求)[^\n，,。]*/)
  out.dueDate = parseDate(due?.[0] ?? '') ?? parseDate(text)

  const titled = text.match(/(?:题目|论文题目|课题|标题)[:：\s]*[《「“"]?([^\n》」”"]{4,60})/) ?? text.match(/[《「]([^》」]{4,60})[》」]/)
  if (titled) out.title = titled[1].trim()
  else {
    // 没有明确题目时，取最像题目的一行：最长、且不是价格 / 日期 / 寒暄
    const lines = text
      .split(/\n|。|；/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 6 && !/^(老师|您好|你好|在吗|麻烦|谢谢)/.test(l) && !/[¥￥]|\d+\s*元|截止|单号|价格/.test(l))
    if (lines.length) out.title = lines.sort((a, b) => b.length - a.length)[0].slice(0, 60)
  }

  const used = [out.title, ch?.name].filter(Boolean) as string[]
  const rest = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !used.some((u) => l.includes(u)))
  if (rest.length) out.note = rest.join('；').slice(0, 200)
  return out
}
