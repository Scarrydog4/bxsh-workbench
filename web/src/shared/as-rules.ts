import type { AfterSaleReason } from './types'

const HOUR = 3600_000

export const CONFIRM_WINDOW = HOUR
export const DEFAULT_DELIVERY = 24 * HOUR

type Confirmation = { cancelledAt?: string | null; deliveredLateMin?: number; confirmBy?: string | null; confirmedAt?: string | null }
export function confirmationState(a: Confirmation, now = Date.now()): 'legacy' | 'waiting' | 'confirmed' | 'default' {
  if (!a.confirmBy) return 'legacy'
  if (a.confirmedAt && new Date(a.confirmedAt).getTime() < new Date(a.confirmBy).getTime()) return 'confirmed'
  return now >= new Date(a.confirmBy).getTime() ? 'default' : 'waiting'
}

/** 跟进进行状态：期限色调 + 一句话。表格、详情、待办都用它。 */
export function afterSaleState(a: { due: string; doneAt: string | null; start: string } & Confirmation, now = Date.now()) {
  if (a.cancelledAt) return { tone: 'done' as const, label: '已撤回' }
  if (a.doneAt && (a.deliveredLateMin ?? 0) > 0) return { tone: 'late' as const, label: `逾期 ${dur(a.deliveredLateMin! * 60_000)}交付` }
  if (a.doneAt) return { tone: 'done' as const, label: `用时 ${dur(new Date(a.doneAt).getTime() - new Date(a.start).getTime())}` }
  const confirmation = confirmationState(a, now)
  if (confirmation === 'waiting') { const sec=Math.max(0,Math.ceil((new Date(a.confirmBy!).getTime()-now)/1000));return {tone:'soon' as const,label:`待确认 ${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`} }
  const prefix = confirmation === 'default' ? '默认交付 · ' : confirmation === 'confirmed' ? '已确认 · ' : ''
  const left = new Date(a.due).getTime() - now
  if (left < 0) return { tone: 'late' as const, label: `${prefix}逾期 ${dur(-left)}` }
  return { tone: left <= HOUR ? ('soon' as const) : ('ok' as const), label: `${prefix}剩 ${dur(left)}` }
}

/** 颜色分主次：宽裕不上色，快到期橙，逾期红。 */
export const TONE_VAR = { ok: 'var(--muted-foreground)', soon: 'var(--warn)', late: 'var(--danger)', done: 'var(--muted-foreground)' }

export function dur(ms: number) {
  const h = ms / HOUR
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分钟`
  if (h < 48) return `${Math.round(h)} 小时`
  return `${Math.floor(h / 24)} 天`
}

// ---------- 快速填写：一段聊天 → 要求、期限、原因（原型用规则；正式版交给 DeepSeek，截图也能认） ----------

const CN: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }

export function parseDue(text: string): { ts: number; phrase: string } | null {
  const hours = text.match(/(\d{1,2})\s*个?小时内/)
  if (hours) return { ts: Date.now() + Number(hours[1]) * HOUR, phrase: hours[0] }
  const m = text.match(/(今天|今晚|明天|明早|明晚|后天)?\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2}|十一|十二|[一二两三四五六七八九十])\s*[点:：]\s*(\d{1,2}|半)?\s*(分)?\s*(之?前|以前)?/)
  const day = text.match(/(今天|今晚|明天|明早|明晚|后天)/)?.[1]
  if (!m && !day) return null
  const d = new Date()
  const key = m?.[1] ?? day ?? ''
  d.setDate(d.getDate() + (({ 明天: 1, 明早: 1, 明晚: 1, 后天: 2 } as Record<string, number>)[key] ?? 0))
  let h = m ? (CN[m[3]] ?? Number(m[3])) : 23
  const part = m?.[2] ?? ''
  if ((part === '下午' || part === '晚上' || key.includes('晚')) && h < 12) h += 12
  if (part === '中午' && h < 6) h += 12
  d.setHours(h, m ? (m[4] === '半' ? 30 : Number(m[4] ?? 0)) : 59, 0, 0)
  return { ts: d.getTime(), phrase: m ? m[0] : (day as string) }
}

export function guessReason(text: string): AfterSaleReason {
  if (/新增|增加|加一[节章段部]|补充一[节章]|再加|多加/.test(text)) return '新增需求'
  if (/写错|错误|不对|漏了|没按|不一致|对不上|有误|抄错/.test(text)) return '写手返工'
  return '正常修改'
}

const POLITE = /^(老师们?好?|您好|你好|在吗|麻烦了?|辛苦了?|谢谢|感谢|好的|收到|嗯+|哈+|ok|OK)[，,！!。~～\s]*/
const PLACE = /[，,]\s*(?=第[一二三四五六七八九十\d]+[章节]|图\s?\d|表\s?\d|参考文献|摘要|目录|致谢|结论|附录)/

export function tidy(raw: string) {
  const due = parseDue(raw)
  let text = raw
  if (due) text = text.replace(due.phrase, '')
  const items = text
    .replace(/(另外|还有|然后|再就是|以及)[，,]?/g, '\n')
    .split(/[\n；;。]|(?=\s*\d+\s*[.、)）])|(?=[①②③④⑤⑥⑦⑧⑨])/)
    .flatMap((x) => x.split(PLACE))
    .map((x) => {
      let t = x.replace(/^\s*(\d+\s*[.、)）]|[①②③④⑤⑥⑦⑧⑨]|[-·•])\s*/, '').trim()
      for (let i = 0; i < 3; i++) t = t.replace(POLITE, '').trim()
      return t
        .replace(/[，,]?\s*(谢谢|辛苦了?|感谢)[！!~～。]*$/, '')
        .replace(/[，,]?\s*(改好|改一下|改掉|弄一下|处理一下)?(发我|给我|发过来)?[！!~～。]*$/, '')
        .replace(/[，,！!~～]+$/, '')
        .trim()
    })
    .filter((t) => t.length >= 4 && !/^(学生那边|导师看过了|导师意见如下|意见如下|如下)/.test(t))
  return { items, due, reason: guessReason(raw) }
}

export const PHRASES = ['按导师批注逐条修改', '降重到 15% 以下', '格式按学校模板', '参考文献换成近 5 年', '摘要压到 300 字以内', '图表补单位和来源', '补充数据分析', '目录和页码更新']
