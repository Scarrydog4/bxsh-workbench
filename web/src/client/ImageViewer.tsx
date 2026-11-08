'use client'

import { useEffect, useState } from 'react'
import Lightbox from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import Counter from 'yet-another-react-lightbox/plugins/counter'
import Download from 'yet-another-react-lightbox/plugins/download'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/counter.css'
import { cn } from '@/lib/utils'
import { FORUM_COPY } from '@/shared/copy/forum'
import { usePref } from './prefs'

export const imageSource = (src: string) => /^(data:|blob:|https?:|\/)/.test(src) ? src : `/api/files/${src}?inline=1`
export const thumbnailSource = (src: string) => {
  const url = imageSource(src)
  if (!url.startsWith('/api/files/')) return url
  const [pathname, query] = url.split('?'), params = new URLSearchParams(query)
  params.set('thumb', '1')
  return `${pathname}?${params}`
}

export interface Pic {
  /** 大图地址：data: 图片，或 /api/files/<id>?inline=1 */
  src: string
  /** 列表里显示的小图；附件默认请求缩略图 */
  thumb?: string
  /** 下载原图用的地址和文件名 */
  download?: string
  name?: string
}

const L = FORUM_COPY.lightbox

/** 看大图（yet-another-react-lightbox）：双指或滚轮缩放、双击放大、左右滑动切换、可以下载原图。 */
type ImageViewerProps = { pics: Pic[]; index: number | null; onIndex: (i: number | null) => void; anonymous?: boolean }

export function ImageViewer(props: ImageViewerProps) {
  return props.anonymous ? <AnonymousImageViewer {...props}/> : <MemberImageViewer {...props}/>
}

function AnonymousImageViewer(props: ImageViewerProps) {
  const [hintSeen, setHintSeen] = useState(false)
  return <ImageViewerContent {...props} hintSeen={hintSeen} onHintSeen={() => setHintSeen(true)}/>
}

function MemberImageViewer(props: ImageViewerProps) {
  const [hintSeen, setHintSeen] = usePref<boolean>('hint.lightboxGesture', false)
  return <ImageViewerContent {...props} hintSeen={hintSeen} onHintSeen={() => setHintSeen(true)}/>
}

function ImageViewerContent({ pics, index, onIndex, hintSeen, onHintSeen }: ImageViewerProps & { hintSeen: boolean; onHintSeen: () => void }) {
  const open = index !== null && !!pics[index]
  const many = pics.length > 1
  const [hint, setHint] = useState(false)
  useEffect(() => {
    if (!open || hintSeen || typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) return
    setHint(true); onHintSeen()
  }, [open, hintSeen, onHintSeen])
  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(false), 3000)
    return () => clearTimeout(t)
  }, [hint])
  return (
    <Lightbox
      open={open}
      index={index ?? 0}
      close={() => onIndex(null)}
      on={{ view: ({ index: i }) => { if (open && i !== index) onIndex(i) } }}
      slides={pics.map(p => ({ src: imageSource(p.src), alt: p.name ?? '图片', download: { url: p.download ?? imageSource(p.src), filename: p.name ?? '图片.jpg' } }))}
      plugins={[Zoom, Counter, Download]}
      carousel={{ finite: !many, preload: 1 }}
      zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true, doubleClickMaxStops: 2 }}
      controller={{ closeOnBackdropClick: true }}
      labels={{ Previous: L.previous, Next: L.next, Close: L.close, 'Zoom in': L.zoomIn, 'Zoom out': L.zoomOut, Download: L.download }}
      counter={{ container: { style: { top: 'unset', bottom: 0, left: '50%', transform: 'translateX(-50%)' } } }}
      render={{
        buttonPrev: many ? undefined : () => null,
        buttonNext: many ? undefined : () => null,
        controls: () => hint ? <div className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-full bg-black/70 px-4 py-2 text-sm text-white">{L.gestureHint}</div> : null,
      }}
      styles={{ container: { backgroundColor: 'rgb(0 0 0 / .88)' }, root: { '--yarl__portal_zindex': 70 } }}
    />
  )
}

/** 一排缩略图，点开看大图 */
export function Thumbs({ pics, className, imgClass = 'h-14 w-11', anonymous = false }: { pics: Pic[]; className?: string; imgClass?: string; anonymous?: boolean }) {
  const [i, setI] = useState<number | null>(null)
  if (!pics.length) return null
  return (
    <>
      <div className={cn('flex flex-wrap gap-1.5', className)}>
        {pics.map((p, k) => (
          <button key={k} type="button" onClick={() => setI(k)} className="rounded border outline-none hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring" aria-label={`看大图 ${p.name ?? k + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img loading="lazy" decoding="async" src={p.thumb ? imageSource(p.thumb) : thumbnailSource(p.src)} alt="" className={cn('rounded object-cover', imgClass)} />
          </button>
        ))}
      </div>
      <ImageViewer pics={pics} index={i} onIndex={setI} anonymous={anonymous} />
    </>
  )
}

export const fileUrl = (id: string, inline = false) => `/api/files/${id}${inline ? '?inline=1' : ''}`
export const isImageName = (name: string, mime?: string) => (mime ? /^image\/(png|jpe?g|webp|gif)$/.test(mime) : /\.(png|jpe?g|webp|gif)$/i.test(name))
