import { useEffect, useRef, useState } from 'react'
import { AndroidLogo, ArrowUpRight, ArrowClockwise, Check, CopySimple, DownloadSimple, PencilSimple, Plus, QrCode, SpinnerGap, WechatLogo, CreditCard } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ANDROID_RELEASE, PAYMENT_CODES, PAYMENT_CODE_LABELS, type PaymentCodeKind, type PaymentCodeView } from '@/shared/company-resources'
import { useSession } from './store'
import { imageFilesFromTransfer } from './image-input'
import { ImageViewer } from './ImageViewer'
import { AndroidUpdateButton } from './AndroidUpdateButton'
import { useCopyFeedback } from './copy-feedback'

const empty: PaymentCodeView = { wechat: null, alipay: null }
const resourceCard = 'grid min-w-0 grid-cols-[48px_minmax(0,1fr)] items-stretch gap-2.5 rounded-lg border bg-card px-3 py-2.5'
const resourceContent = 'grid min-h-[76px] min-w-0 grid-rows-[auto_1fr_auto]'
const resourceTitle = 'flex items-start gap-1.5 text-sm font-medium leading-5'
const resourceActions = '-ml-1 flex min-h-8 flex-wrap items-center gap-0.5'
const resourceAction = 'grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function CompanyResources() {
  const { s, me, role, can } = useSession()
  const visible = role.locked || can('order.create')
  const [codes, setCodes] = useState<PaymentCodeView>(empty)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!visible) return
    let active = true
    void fetch('/api/resources/payments', { cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '读取收款码失败')
      if (active) { setCodes(data); setError('') }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : '读取收款码失败') })
    return () => { active = false }
  }, [visible, me.id, s.version])
  async function copyDownload() {
    try { await navigator.clipboard.writeText(new URL(ANDROID_RELEASE.page, location.href).href); toast.success('下载链接已复制') }
    catch { toast.error('复制失败，请打开下载页后复制网址') }
  }
  return <section aria-label="常用资源" className="grid gap-2">
    <div className={cn('grid gap-3 sm:grid-cols-2')}>
      <article className={resourceCard}>
        <a href={ANDROID_RELEASE.page} target="_blank" rel="noreferrer" aria-label="下载安装" className="grid h-[76px] w-12 self-center place-items-center rounded-md bg-primary/5 outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring"><img src="/icon.svg?v=flower-20261026" alt="笔下" className="h-9 w-9"/></a>
        <div className={resourceContent}>
          <a href={ANDROID_RELEASE.page} target="_blank" rel="noreferrer" className={cn(resourceTitle, 'hover:text-primary')}><AndroidLogo size={15} className="mt-0.5 shrink-0 text-primary"/><span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">安卓客户端</span><ArrowUpRight size={15} className="mt-0.5 shrink-0 text-muted-foreground"/></a>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">v{ANDROID_RELEASE.version} · Android {ANDROID_RELEASE.minimumAndroid}+</p>
          <div className={resourceActions}>
            <button type="button" aria-label="复制安卓下载链接" title="复制下载链接" onClick={() => void copyDownload()} className={resourceAction}><CopySimple size={17}/></button>
            <a href={ANDROID_RELEASE.page} target="_blank" rel="noreferrer" aria-label="打开安卓下载页" title="下载安装" className={resourceAction}><DownloadSimple size={17}/></a>
            <AndroidUpdateButton/>
          </div>
        </div>
      </article>
      {visible && PAYMENT_CODES.map(kind => <PaymentCode key={kind} kind={kind} src={codes[kind]} editable={role.locked} onSaved={setCodes}/>)}
    </div>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>
}

function PaymentCode({ kind, src, editable, onSaved }: { kind: PaymentCodeKind; src: string | null; editable: boolean; onSaved: (codes: PaymentCodeView) => void }) {
  const [busy, setBusy] = useState(false), [over, setOver] = useState(false), [open, setOpen] = useState<number | null>(null)
  const [thumbReady, setThumbReady] = useState(false)
  useEffect(() => setThumbReady(false), [src])
  const working = useRef(false), input = useRef<HTMLInputElement>(null)
  const label = PAYMENT_CODE_LABELS[kind]
  const png = useRef<{ src: string; blob: Blob } | null>(null)
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reload, setReload] = useState(0)
  const feedback = useCopyFeedback(`${src ?? ''}:${reload}`)
  const copyState = imageState === 'ready' && feedback.state !== 'idle' ? feedback.state : imageState
  useEffect(() => {
    png.current = null
    setImageState(src ? 'loading' : 'ready')
    if (!src) return
    const controller = new AbortController()
    void fetch(src, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('图片读取失败')
      const blob = await response.blob()
      if (!blob.size || blob.type !== 'image/png') throw new Error('图片格式不正确')
      if (!controller.signal.aborted) { png.current = { src, blob }; setImageState('ready') }
    }).catch(() => { if (!controller.signal.aborted) setImageState('error') })
    return () => controller.abort()
  }, [src, reload])
  async function take(files: File[]) {
    if (!editable || working.current) return
    if (files.length !== 1) { toast.error('每种收款码请选择一张图片'); return }
    const file = files[0]
    if (!file.size || file.size > 8_000_000 || !/^image\/(png|jpe?g|webp)$/.test(file.type)) { toast.error('请选择 8MB 以内的 PNG、JPG 或 WebP 图片'); return }
    working.current = true; setBusy(true)
    try {
      const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file) })
      const response = await fetch('/api/resources/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, image }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '收款码保存失败')
      onSaved(data); toast.success(`${label}已更新`)
    } catch (error) { toast.error(error instanceof Error ? error.message : '收款码保存失败，请重试') }
    finally { working.current = false; setBusy(false) }
  }
  async function copyImage() {
    if (copyState === 'error') { setReload(value => value + 1); return }
    const ready = png.current
    if (!ready || ready.src !== src || copyState === 'copying') return
    const ok = await feedback.copy(() => {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('unsupported')
      // 点击时直接写入已经读好的 PNG，避免安卓在异步取图时仍保留上一张。
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': ready.blob })])
    })
    if (ok === false) toast.error('复制失败，请保存图片后发送')
  }
  const download = src ? `${src}&download=1` : ''
  return <article tabIndex={editable ? 0 : undefined} aria-label={label} aria-busy={busy}
    onPaste={editable ? event => { event.preventDefault(); event.stopPropagation(); void take(imageFilesFromTransfer(event.clipboardData)) } : undefined}
    onDragOver={editable ? event => { event.preventDefault(); setOver(true) } : undefined}
    onDragLeave={() => setOver(false)}
    onDrop={editable ? event => { event.preventDefault(); event.stopPropagation(); setOver(false); void take(imageFilesFromTransfer(event.dataTransfer)) } : undefined}
    onClick={event => { if (editable && !(event.target instanceof Element && event.target.closest('button,a,input'))) event.currentTarget.focus() }}
    className={cn(resourceCard, 'outline-none transition-shadow focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20', over && 'border-primary ring-2 ring-primary/30')}>
    <div className={cn('relative flex h-[76px] w-12 self-center items-center justify-center overflow-hidden rounded-md border bg-white', !src && 'border-dashed bg-muted/20')}>
      {src ? <button type="button" aria-label={`查看${label}`} title="放大查看" onClick={() => setOpen(0)} className="flex h-full w-full items-center justify-center outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
        {!thumbReady && <span aria-hidden className="absolute inset-1 animate-pulse rounded bg-muted"/>}
        <img src={`${src}&thumb=1`} alt={label} decoding="async" onLoad={() => setThumbReady(true)} className={cn('h-full w-full object-contain transition-opacity duration-200', thumbReady ? 'opacity-100' : 'opacity-0')}/>
      </button> : editable ? <button type="button" aria-label={`上传${label}`} title="上传收款码" disabled={busy} onClick={() => input.current?.click()} className="grid h-full w-full place-items-center text-muted-foreground outline-none hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"><Plus size={23}/></button>
        : <QrCode size={25} className="text-muted-foreground"/>}
      {busy && <span className="absolute inset-0 grid place-items-center bg-background/85"><SpinnerGap size={24} className="animate-spin"/></span>}
    </div>
    <div className={resourceContent}>
      <div className={resourceTitle}>{kind === 'wechat' ? <WechatLogo size={15} className="mt-0.5 shrink-0 text-primary"/> : <CreditCard size={15} className="mt-0.5 shrink-0 text-sky-600"/>}<span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{label}</span></div>
      <div>{!src && <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{editable ? '粘贴或拖入图片' : '暂未设置'}</p>}</div>
      {src ? <div className={resourceActions}>
        <button type="button" aria-label={copyState === 'copied' ? `${label}已复制` : copyState === 'loading' ? `正在加载${label}` : copyState === 'copying' ? `正在复制${label}` : copyState === 'error' ? `重新加载${label}` : `复制${label}图片`} title={copyState === 'copied' ? '已复制' : copyState === 'error' ? '加载失败，点击重试' : '复制图片'} disabled={copyState === 'loading'} aria-busy={copyState === 'copying'} onClick={() => void copyImage()} className={cn(resourceAction, copyState === 'copied' && 'text-primary', copyState === 'loading' && 'opacity-50')}>
          {copyState === 'loading' || copyState === 'copying' ? <SpinnerGap size={17} className="animate-spin motion-reduce:animate-none"/> : copyState === 'copied' ? <Check size={17} className="animate-in fade-in duration-150 motion-reduce:animate-none"/> : copyState === 'error' ? <ArrowClockwise size={17}/> : <CopySimple size={17}/>}
          <span className="sr-only" role="status">{copyState === 'copied' ? `${label}已复制` : ''}</span>
        </button>
        <a href={download} download={`${label}.png`} aria-label={`保存${label}图片`} title="保存图片" className={resourceAction}><DownloadSimple size={17}/></a>
        {editable && <button type="button" aria-label={`更换${label}`} title="更换图片" disabled={busy} onClick={() => input.current?.click()} className={resourceAction}><PencilSimple size={17}/></button>}
      </div> : <div className="h-8"/>}
    </div>
    {editable && <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${label}图片文件`} className="hidden" disabled={busy} onChange={event => { const files = event.target.files ? imageFilesFromTransfer({ files: event.target.files } as DataTransfer) : []; event.target.value = ''; void take(files) }}/>}
    <ImageViewer pics={src ? [{ src, thumb: `${src}&thumb=1`, download, name: `${label}.png` }] : []} index={open} onIndex={setOpen}/>
  </article>
}
