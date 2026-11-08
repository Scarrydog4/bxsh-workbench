/** 与附件 Word 预览共用渲染参数；稿件内容和颜色由 DOCX 自身提供。 */
export async function renderWordDocument(blob: Blob, body: HTMLElement, style: HTMLElement) {
  const { renderAsync } = await import('docx-preview')
  return renderAsync(blob, body, style, { className: 'docx', inWrapper: true, ignoreLastRenderedPageBreak: true, breakPages: true, experimental: true, useBase64URL: true })
}
