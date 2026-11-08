import { cn } from '@/lib/utils'

export type UploadPhase = 'reading' | 'waiting' | 'uploading' | 'saving' | 'error' | 'uncertain' | 'uploaded'

const labels: Record<UploadPhase, string> = {
  reading: '读取中', waiting: '等待上传', uploading: '上传中', saving: '保存中',
  error: '上传失败', uncertain: '结果待确认', uploaded: '✓ 已上传',
}

/** 百分比来自已收到的字节；只让外层播报阶段，不逐百分比播报。 */
export function UploadState({ phase, progress = 0, className }: { phase: UploadPhase; progress?: number; className?: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100)
  return <div data-upload-state={phase} className={cn('min-h-6 text-[10px] leading-4', phase === 'error' ? 'text-danger' : phase === 'uploaded' ? 'text-ok' : 'text-muted-foreground', className)}>
    <div className="flex items-center justify-between gap-1"><span>{labels[phase]}</span>{phase === 'uploading' && <span aria-hidden="true" className="tabular-nums">{percent}%</span>}</div>
    {phase === 'uploading' && <div role="progressbar" aria-label="文件上传进度" aria-live="off" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-0.5 h-0.5 overflow-hidden rounded bg-muted">
      <div className="h-full origin-left bg-primary transition-transform duration-150 motion-reduce:transition-none" style={{ transform: `scaleX(${percent / 100})` }} />
    </div>}
  </div>
}
