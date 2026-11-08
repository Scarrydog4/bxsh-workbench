import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const XML = 'http://www.w3.org/XML/1998/namespace'
export class WordPreservationError extends Error {
  constructor(public code: 'format_alignment' | 'no_safe_rewrite') { super(code) }
}
export interface WordPreservationSummary {
  changedParagraphs: number
  changedChineseParagraphs: number
  changedEnglishParagraphs: number
  protectedDataSentences: number
  protectedReferenceParagraphs: number
  protectedFormattingParagraphs: number
  keptForLayout: number
}
const fail = (): never => { throw new WordPreservationError('format_alignment') }
function parse(raw: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) return fail()
  return new DOMParser({ onError: (level) => { if (level !== 'warning') fail() } }).parseFromString(raw, 'application/xml') as unknown as Document
}
function elements(node: Element | Document, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS(W, name))
}
function textNodes(p: Element): Element[] { return elements(p, 't') }
function text(p: Element) { return textNodes(p).map((t) => t.textContent ?? '').join('') }
function attr(e: Element | undefined, name: string) { return e?.getAttributeNS(W, name) ?? '' }
function child(e: Element, name: string) { return Array.from(e.childNodes).find((n) => n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === name) as Element | undefined }
function inTable(p: Element) {
  for (let n = p.parentNode; n; n = n.parentNode) if (n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === 'tbl') return true
  return false
}
function styleId(p: Element) { const pr = child(p, 'pPr'); return pr ? attr(child(pr, 'pStyle'), 'val') : '' }
function protectedStyle(id: string, styles: Document | null) {
  if (/^(title|subtitle|heading|toc|caption)|标题|题注|目录/i.test(id)) return true
  const style = styles && elements(styles, 'style').find((s) => attr(s, 'styleId') === id)
  if (!style) return false
  const outline = elements(style, 'outlineLvl')[0]
  return !!outline && Number(attr(outline, 'val')) < 9
}
function specialContent(p: Element) {
  return ['fldChar', 'instrText', 'drawing', 'object', 'pict', 'footnoteReference', 'endnoteReference', 'tab', 'br', 'hyperlink', 'sdt', 'del', 'ins'].some((n) => elements(p, n).length) || p.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', '*').length > 0
}
function heading(p: Element, styles: Document | null) {
  const t = text(p).trim()
  const outline = elements(p, 'outlineLvl')[0]
  return protectedStyle(styleId(p), styles) || !!outline && Number(attr(outline, 'val')) < 9 || t.length < 70 && /^(?:第[一二三四五六七八九十百\d]+[章节]|\d+(?:\.\d+){0,3}\s+\S)/.test(t)
}
function referencesHeading(t: string) { return /^(?:\d+[.、\s]*)?(?:参考文献|参考资料|引用文献|references|bibliography|works\s+cited)$/i.test(t.trim().replace(/[:：]$/, '')) }
function caption(t: string) { return /^(?:表|图|附表|附图|table|figure)\s*[\d一二三四五六七八九十IVX]/i.test(t.trim()) }
function dataSentence(t: string) {
  return /[0-9０-９]|[一二三四五六七八九十百千万亿两]+(?:年|月|日|时|分|秒|个|次|份|人|项|例|组|倍|成|米|元|%|％)|数据|样本|问卷|回收|剔除|有效率|比例|比率|统计|测量|均值|标准差|显著|调查时段|数量|\b(?:data|sample|questionnaire|percent|ratio|statistic|measurement)\b/i.test(t)
}
function sentences(t: string) {
  const parts: string[] = []; let start = 0
  for (let i = 0; i < t.length; i++) {
    const end = /[。！？；]/.test(t[i]) || /[.!?;]/.test(t[i]) && (i === t.length - 1 || /\s/.test(t[i + 1]))
    if (end) { parts.push(t.slice(start, i + 1)); start = i + 1 }
  }
  if (start < t.length) parts.push(t.slice(start))
  return parts
}
function width(t: string) { return Array.from(t).reduce((n, c) => n + (/^[\x00-\x7f]$/.test(c) ? 0.5 : 1), 0) }
function layoutBudget(p: Element, document: Document, styles: Document | null) {
  const old = text(p), id = styleId(p)
  if (/list|列表/i.test(id)) return width(old)
  const sections = elements(document, 'sectPr')
  const widths = sections.map((section) => {
    const size = child(section, 'pgSz'), margins = child(section, 'pgMar')
    return Number(attr(size, 'w')) - Number(attr(margins, 'left')) - Number(attr(margins, 'right'))
  })
  if (!widths.length || widths.some((w) => !Number.isFinite(w) || w <= 0 || w !== widths[0])) return width(old)
  const style = styles && elements(styles, 'style').find((s) => attr(s, 'styleId') === (id || 'Normal'))
  const normal = styles && elements(styles, 'style').find((s) => attr(s, 'styleId') === 'Normal')
  const font = Math.max(0, ...elements(p, 'sz').map((e) => Number(attr(e, 'val'))), ...(style ? elements(style, 'sz').map((e) => Number(attr(e, 'val'))) : []), ...(normal ? elements(normal, 'sz').map((e) => Number(attr(e, 'val'))) : [])) || 24
  const properties = child(p, 'pPr')
  const indent = properties && child(properties, 'ind') || style && elements(style, 'ind')[0] || normal && elements(normal, 'ind')[0]
  const left = Number(attr(indent || undefined, 'left') || 0), right = Number(attr(indent || undefined, 'right') || 0), first = Number(attr(indent || undefined, 'firstLine') || 0)
  const capacity = (widths[0] - left - right) / (font * 10), firstUnits = first / (font * 10)
  if (capacity < 10) return width(old)
  const lines = Math.ceil((width(old) + firstUnits) / capacity)
  // Reuse the unused width of the original lines; do not shrink fonts or change spacing.
  return Math.max(width(old), lines * capacity - firstUnits - 2)
}
function meaning(t: string) { return t.replace(/[^\p{L}\p{N}]/gu, '') }
const negative = /不能|不得|不应|不可|未能|并未|没有|不足以|尚不足|不代表|不意味着|不一定|不直接|不构成|不能够|\b(?:not|no|cannot|without|neither)\b/i
function bold(t: Element, styles: Document | null) {
  let run: Element | undefined
  for (let n = t.parentNode; n && n.nodeType === 1; n = n.parentNode) if ((n as Element).namespaceURI === W && (n as Element).localName === 'r') { run = n as Element; break }
  if (!run) return false
  const pr = child(run, 'rPr'); const value = pr && (child(pr, 'b') ?? child(pr, 'bCs'))
  if (value) return !['0', 'false', 'off'].includes(attr(value, 'val'))
  const id = pr && child(pr, 'rStyle')
  const s = id && styles && elements(styles, 'style').find((x) => attr(x, 'styleId') === attr(id, 'val'))
  const b = s && elements(s, 'b')[0]
  return !!b && !['0', 'false', 'off'].includes(attr(b, 'val'))
}
/** Keep every original run and its formatting. Bold text must remain literal and in the same order. */
function assignments(p: Element, replacement: string, styles: Document | null): Array<[Element, string]> | null {
  const nodes = textNodes(p), out: Array<[Element, string]> = []
  const groups: Array<{ bold: boolean; nodes: Element[]; value: string }> = []
  for (const n of nodes) {
    const b = bold(n, styles), previous = groups.at(-1)
    if (previous?.bold === b) { previous.nodes.push(n); previous.value += n.textContent ?? '' }
    else groups.push({ bold: b, nodes: [n], value: n.textContent ?? '' })
  }
  let cursor = 0
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    if (g.bold) {
      if (!replacement.startsWith(g.value, cursor)) return null
      for (const n of g.nodes) out.push([n, n.textContent ?? ''])
      cursor += g.value.length
    } else {
      const anchor = groups[i + 1]
      const end = anchor ? replacement.indexOf(anchor.value, cursor) : replacement.length
      if (end < cursor) return null
      const value = replacement.slice(cursor, end)
      let at = 0, consumed = 0
      const length = g.value.length
      for (let j = 0; j < g.nodes.length; j++) {
        consumed += (g.nodes[j].textContent ?? '').length
        const next = j === g.nodes.length - 1 ? value.length : length ? Math.round(value.length * consumed / length) : 0
        out.push([g.nodes[j], value.slice(at, next)]); at = next
      }
      cursor = end
    }
  }
  return cursor === replacement.length ? out : null
}

/** Preserve the input OPC package; only safe text nodes in the original main document can change. */
export async function preserveWordRewrite(source: Buffer, rewritten: Buffer, language: 'CN' | 'EN' = 'CN', whitelist = ''): Promise<{ bytes: Buffer; summary: WordPreservationSummary }> {
  let original: JSZip, result: JSZip
  try { [original, result] = await Promise.all([JSZip.loadAsync(source), JSZip.loadAsync(rewritten)]) } catch { return fail() }
  const sourcePart = original.file('word/document.xml'), resultPart = result.file('word/document.xml')
  if (!sourcePart || !resultPart) return fail()
  const [sourceXml, resultXml, styleXml] = await Promise.all([sourcePart.async('string'), resultPart.async('string'), original.file('word/styles.xml')?.async('string')])
  const doc = parse(sourceXml), output = parse(resultXml), styles = styleXml ? parse(styleXml) : null
  const before = elements(doc, 'p'), after = elements(output, 'p')
  // A changed paragraph/table scaffold cannot be paired safely by position.
  if (before.length !== after.length || elements(doc, 'tbl').length !== elements(output, 'tbl').length || before.some((p, i) => inTable(p) !== inTable(after[i]))) return fail()
  const summary: WordPreservationSummary = { changedParagraphs: 0, changedChineseParagraphs: 0, changedEnglishParagraphs: 0, protectedDataSentences: 0, protectedReferenceParagraphs: 0, protectedFormattingParagraphs: 0, keptForLayout: 0 }
  let referenceSection = false
  for (let i = 0; i < before.length; i++) {
    const p = before[i], r = after[i], sourceText = text(p), resultText = text(r)
    if (!sourceText.trim() || inTable(p)) continue
    if (referencesHeading(sourceText)) { referenceSection = true; summary.protectedReferenceParagraphs++; continue }
    if (referenceSection && heading(p, styles)) referenceSection = false
    if (referenceSection || /^\s*\[\d+\]/.test(sourceText)) { summary.protectedReferenceParagraphs++; continue }
    if (heading(p, styles) || caption(sourceText)) {
      if (sourceText !== resultText) return fail()
      continue
    }
    if (language === 'CN' && !/[\p{Script=Han}]/u.test(sourceText) || language === 'EN' && !/[A-Za-z]/.test(sourceText)) continue
    if (specialContent(p)) { summary.protectedFormattingParagraphs++; continue }
    const sourceSentences = sentences(sourceText), resultSentences = sentences(resultText)
    if (sourceSentences.length !== resultSentences.length) { summary.protectedFormattingParagraphs++; continue }
    const chosen = [...sourceSentences]
    const budget = layoutBudget(p, doc, styles)
    for (let n = 0; n < sourceSentences.length; n++) {
      const old = sourceSentences[n], next = resultSentences[n]
      if (dataSentence(old)) { summary.protectedDataSentences++; continue }
      if (dataSentence(next) || negative.test(old) && !negative.test(next)) continue
      const proposed = chosen.map((sentence, i) => i === n ? next : sentence).join('')
      if (width(proposed) > budget) { summary.keptForLayout++; continue }
      chosen[n] = next
    }
    const accepted = chosen.join('')
    if (meaning(accepted) === meaning(sourceText)) continue
    const terms = whitelist.replace(/，/g, ',').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)
    if (terms.some((term) => sourceText.includes(term) && sourceText.split(term).length !== accepted.split(term).length)) { summary.protectedFormattingParagraphs++; continue }
    if (width(accepted) > budget) { summary.keptForLayout++; continue }
    const changes = assignments(p, accepted, styles)
    if (!changes) { summary.protectedFormattingParagraphs++; continue }
    for (const [node, value] of changes) {
      node.textContent = value
      if (/^\s|\s$/.test(value)) node.setAttributeNS(XML, 'xml:space', 'preserve')
    }
    summary.changedParagraphs++
    if (sourceText.replace(/[^\p{Script=Han}]/gu, '') !== accepted.replace(/[^\p{Script=Han}]/gu, '')) summary.changedChineseParagraphs++
    if (sourceText.replace(/[^A-Za-z]/g, '') !== accepted.replace(/[^A-Za-z]/g, '')) summary.changedEnglishParagraphs++
  }
  if (!summary.changedParagraphs || language === 'CN' && !summary.changedChineseParagraphs || language === 'EN' && !summary.changedEnglishParagraphs) throw new WordPreservationError('no_safe_rewrite')
  original.file('word/document.xml', new XMLSerializer().serializeToString(doc as unknown as Parameters<XMLSerializer['serializeToString']>[0]), { createFolders: false })
  return { bytes: await original.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), summary }
}
