/** 去掉 Markdown 符号只留文字：列表摘要、提醒正文用。 */
export function plainText(md: string) {
  return md
    .replace(/^\s*\|?\s*:?-{3,}[\s|:-]*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`|_~]+/g, ' ')
    .replace(/(^|\s):?-{3,}:?(?=\s|$)/g, '$1')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/ ([，。：；！？、」）])/g, '$1')
    .trim()
}
/** 按字（不是 UTF-16 单元）截取 */
export const takeChars = (text: string, n: number) => [...text].slice(0, n).join('')
