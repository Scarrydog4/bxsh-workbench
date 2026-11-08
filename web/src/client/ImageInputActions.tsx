import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { Clipboard, ImageSquare, Paperclip } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { IMAGE_INPUT_EMPTY_MESSAGE, imageFilesFromTransfer, preservePickedImages, readClipboardImages } from './image-input'
import { useImageReceiveFeedback } from './useImageReceiveFeedback'

export type ImageInputActionsProps = {
  onFiles: (files: File[]) => void | Promise<void>
  disabled?: boolean
  compact?: boolean
  multiple?: boolean
  ariaLabel?: string
  className?: string
  pasteTargetRef?: RefObject<HTMLElement | null>
  accept?: string
  pickLabel?: string
  onReading?: (reading: boolean) => void
  pickerOnly?: boolean
}

/** 同一组显式入口；剪贴板权限不可用时保留可见的键盘粘贴接收区。 */
export function ImageInputActions({ onFiles, disabled, compact, multiple = true, ariaLabel, className, pasteTargetRef, accept: acceptType = 'image/*', pickLabel = '选图片', onReading, pickerOnly = false }: ImageInputActionsProps) {
  const input = useRef<HTMLInputElement>(null), fallback = useRef<HTMLDivElement>(null), working = useRef(false)
  const [busy, setBusy] = useState(false), [hint, setHint] = useState('')
  const imageFeedback = useImageReceiveFeedback()
  useEffect(() => { if (hint) (pasteTargetRef?.current ?? fallback.current)?.focus() }, [hint, pasteTargetRef])
  useEffect(() => {
    const target = pasteTargetRef?.current
    if (!hint || !target) return
    const clearAfterImage = (event: ClipboardEvent) => {
      if (event.clipboardData && imageFilesFromTransfer(event.clipboardData).length) setHint('')
    }
    target.addEventListener('paste', clearAfterImage)
    return () => target.removeEventListener('paste', clearAfterImage)
  }, [hint, pasteTargetRef])
  async function accept(files: File[], fromPicker = false) {
    if (disabled || working.current) return
    if (!files.length) { setHint(IMAGE_INPUT_EMPTY_MESSAGE); return }
    working.current = true; setBusy(true); setHint(''); onReading?.(true)
    try {
      const picked = multiple ? files : files.slice(0, 1)
      const stable = fromPicker ? preservePickedImages(picked) : picked
      await onFiles(Array.isArray(stable) ? stable : await stable)
      imageFeedback.acknowledge()
    }
    catch { setHint('图片添加失败，请重新选择') }
    finally { working.current = false; setBusy(false); onReading?.(false) }
  }
  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const target = event.target
    const files = acceptType === '*' ? Array.from(target.files ?? []) : imageFilesFromTransfer({ files: target.files! } as DataTransfer)
    try { await accept(files, true) }
    finally { target.value = '' }
  }
  async function paste() {
    if (disabled || working.current) return
    working.current = true; setBusy(true); setHint(''); onReading?.(true)
    let files: File[]
    try { files = await readClipboardImages() }
    catch (error) {
      setHint(error instanceof Error ? error.message : '请按 ⌘V 粘贴，或选图片')
      working.current = false; setBusy(false); onReading?.(false)
      return
    }
    try { await onFiles(multiple ? files : files.slice(0, 1)); imageFeedback.acknowledge() }
    catch { setHint('图片添加失败，请重新选择') }
    finally { working.current = false; setBusy(false); onReading?.(false) }
  }
  if (pickerOnly) return <div className={cn('inline-flex items-center', className)}>
    <button type="button" disabled={disabled || busy} aria-label={ariaLabel ? `${ariaLabel}：${pickLabel}` : pickLabel} title={pickLabel}
      className={cn("grid h-7 w-7 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-40", imageFeedback.className)}
      onClick={event => { event.stopPropagation(); input.current?.click() }}>{acceptType === '*' ? <Paperclip size={18}/> : <ImageSquare size={18}/>}</button>
    <input ref={input} type="file" multiple={multiple} accept={acceptType === '*' ? undefined : acceptType} disabled={disabled || busy} aria-label={ariaLabel ? `${ariaLabel}图片文件` : '图片文件'} className="hidden" onChange={pick}/>
    {hint && <span role="status" className="ml-2 text-xs text-danger">{hint}</span>}
  </div>
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>
    <Button type="button" variant="outline" size="sm" disabled={disabled || busy} aria-label={ariaLabel ? `${ariaLabel}：${pickLabel}` : pickLabel} className={cn('border-primary/30 text-primary hover:border-primary/60 hover:bg-primary/5', compact && 'h-7 px-2 text-xs', imageFeedback.className)} onClick={event => { event.stopPropagation(); input.current?.click() }}>{acceptType === '*' ? <Paperclip size={15}/> : <ImageSquare size={15}/>}<span>{pickLabel}</span></Button>
    <Button type="button" variant="outline" size="sm" disabled={disabled || busy} aria-label={ariaLabel ? `${ariaLabel}：粘贴图片` : '粘贴图片'} className={cn('border-primary/30 text-primary hover:border-primary/60 hover:bg-primary/5', compact && 'h-7 px-2 text-xs', imageFeedback.className)} onClick={event => { event.stopPropagation(); void paste() }}><Clipboard size={15}/>{busy ? '读取中…' : '粘贴'}<kbd className="text-[10px] font-normal opacity-60">⌘V</kbd></Button>
    <input ref={input} type="file" multiple={multiple} accept={acceptType === '*' ? undefined : acceptType} disabled={disabled || busy} aria-label={ariaLabel ? `${ariaLabel}图片文件` : '图片文件'} className="sr-only" onChange={pick}/>
    {hint && <div ref={fallback} tabIndex={0} role="group" aria-label="粘贴图片区域" className="col-span-full w-full basis-full rounded-md border border-primary/40 bg-primary/5 px-2.5 py-2 text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      onPaste={event => { event.preventDefault(); event.stopPropagation(); void accept(imageFilesFromTransfer(event.clipboardData)) }}
      onDragOver={event => { event.preventDefault(); event.stopPropagation() }} onDrop={event => { event.preventDefault(); event.stopPropagation(); void accept(imageFilesFromTransfer(event.dataTransfer)) }}>
      <span role="status">{hint}</span><span className="ml-1 whitespace-nowrap">按 ⌘V 粘贴</span>
    </div>}
  </div>
}
