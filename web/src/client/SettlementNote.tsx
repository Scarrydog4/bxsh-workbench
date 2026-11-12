import { useRef, useState } from 'react'
import { ImageSquare, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { inputCls } from './ui'
import { hasFiles, thumb } from './files'
import { Thumbs } from './ImageViewer'
import { IMAGE_INPUT_EMPTY_MESSAGE, imageFilesFromTransfer } from './image-input'
import { imageArrivalClass, useImageReceiveFeedback } from './useImageReceiveFeedback'

export function SettlementNote({ note, shots, onNote, onShots, disabled, onReading, label = '结算备注', placeholder = '备注（可选）', maxImages = 9, maxLength = 2000, anonymous = false, compact = false }: {
  note: string; shots: string[]; onNote: (value: string) => void; onShots: (value: string[]) => void; disabled?: boolean; onReading: (value: boolean) => void; label?: string; placeholder?: string; maxImages?: number; maxLength?: number; anonymous?: boolean; compact?: boolean
}) {
  const reading = useRef(false)
  const pasteTarget = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const imageFeedback = useImageReceiveFeedback()
  async function add(files: File[]) {
    if (disabled || reading.current) return
    const images = files.filter(f => f.type.startsWith('image/'))
    if (!images.length) { toast.error(IMAGE_INPUT_EMPTY_MESSAGE); return }
    if (images.length + shots.length > maxImages) { toast.error(`最多 ${maxImages} 张截图`); return }
    reading.current = true; onReading(true)
    try {
      const urls = await Promise.all(images.map(f => thumb(f, 1800)))
      if (urls.some(url => !url || url.length > 1_500_000)) { toast.error('图片过大或无法读取'); return }
      onShots([...shots, ...urls as string[]])
      imageFeedback.acknowledge()
    } catch { toast.error('截图读取失败，请重试') }
    finally { reading.current = false; onReading(false) }
  }
  const shotOccurrences = new Map<string, number>()
  const shotKeys = shots.map(src => { const occurrence = shotOccurrences.get(src) ?? 0; shotOccurrences.set(src, occurrence + 1); return `${src}:${occurrence}` })
  return <div className={cn('relative rounded-lg border bg-background p-2 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15', over && 'border-primary bg-primary/5', imageFeedback.className)}
    onClick={e => { if (!(e.target as HTMLElement).closest('button, input, textarea')) pasteTarget.current?.focus() }}
    onPaste={e => { e.stopPropagation(); const files = imageFilesFromTransfer(e.clipboardData); if (files.length) { e.preventDefault(); void add(files) } }}
    onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); setOver(true) } }} onDragLeave={() => setOver(false)}
    onDrop={e => { const files = imageFilesFromTransfer(e.dataTransfer); if (hasFiles(e) || files.length) { e.preventDefault(); e.stopPropagation(); setOver(false); void add(files) } }}>
    <textarea ref={pasteTarget} aria-label={label} rows={compact ? 1 : 3} maxLength={maxLength} disabled={disabled} className={cn(inputCls, 'h-auto resize-y border-0 bg-transparent p-1 pr-9 shadow-none focus-visible:ring-0', compact ? 'min-h-6' : 'min-h-20', anonymous && 'text-base sm:text-sm')} placeholder={placeholder} value={note} onChange={e => onNote(e.target.value)} />
    <button type="button" aria-label={`${label}：上传截图`} title="上传截图" disabled={disabled || reading.current} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary disabled:opacity-40" onClick={() => picker.current?.click()}><ImageSquare size={18}/></button>
    <input ref={picker} type="file" accept="image/*" multiple={maxImages > 1} aria-label={`${label}截图文件`} className="hidden" disabled={disabled || reading.current} onChange={e => { const files = imageFilesFromTransfer({ files: e.target.files! } as DataTransfer); e.target.value = ''; if (files.length) void add(files) }}/>

    {!!shots.length && <div className="flex flex-wrap gap-2 pt-2">{shots.map((src, i) => <div key={shotKeys[i]} className={cn("relative", imageArrivalClass)}>
      <Thumbs pics={[{ src, thumb: src.startsWith('/api/') ? `${src}${src.includes('?')?'&':'?'}thumb=1` : src, name: `${label}截图${i + 1}.webp` }]} imgClass="h-16 w-16" anonymous={anonymous} />
      <button type="button" disabled={disabled || reading.current} aria-label={`移除截图 ${i + 1}`} className="absolute -right-1 -top-1 rounded-full border bg-card p-0.5 text-muted-foreground hover:text-danger" onClick={() => onShots(shots.filter((_, n) => n !== i))}><X size={12}/></button>
    </div>)}</div>}
  </div>
}

export function SettlementNoteView({ note, shots = [], label = '结算截图' }: { note: string; shots?: string[]; label?: string }) {
  return <div className="space-y-2">
    {note && <p className="whitespace-pre-wrap break-words text-sm">{note}</p>}
    {!!shots.length && <Thumbs pics={shots.map((src, i) => ({ src, thumb: `${src}?thumb=1`, name: `${label}${i + 1}.webp` }))} imgClass="h-16 w-16"/>}
  </div>
}
