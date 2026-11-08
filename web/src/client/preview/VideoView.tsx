'use client'

import { useEffect, useRef, useState } from 'react'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import { FORUM_COPY } from '@/shared/copy/forum'
import { PreviewMessage } from './parts'
import type { PreviewFile } from './preview'

const P = FORUM_COPY.preview, V = P.video
// 图标（plyr-icons.svg，复制自 plyr 3.8.5，MIT）和停止下载用的空白视频都用本站的，不连 Plyr 的 CDN
const ICONS = new URL('./plyr-icons.svg', import.meta.url).toString()

/** 视频：Plyr 播放器，按钮中文，倍速 0.5–2；靠服务器分段读取拖进度。浏览器解不了的编码给下载。 */
export function VideoView({ file }: { file: PreviewFile }) {
  const host = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    // 视频元素由这里创建：Plyr 销毁时会替换掉原元素，交给 React 管会在开发模式重复初始化时挂空
    const box = host.current
    if (!box) return
    const el = document.createElement('video')
    el.src = file.url; el.playsInline = true; el.preload = 'metadata'; el.controls = true
    box.replaceChildren(el)
    const player = new Plyr(el, {
      controls: ['play-large', 'rewind', 'play', 'fast-forward', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'pip', 'fullscreen'],
      settings: ['speed'],
      speed: { selected: 1, options: [0.5, 1, 1.25, 1.5, 2] },
      seekTime: 10,
      iconUrl: ICONS,
      blankVideo: 'about:blank',
      invertTime: false,
      i18n: {
        play: V.play, pause: V.pause, mute: V.mute, unmute: V.unmute, volume: V.volume, enterFullscreen: V.enterFullscreen, exitFullscreen: V.exitFullscreen,
        speed: V.speed, normal: V.normal, pip: V.pip, settings: V.settings, rewind: V.rewind, fastForward: V.fastForward, menuBack: FORUM_COPY.common.back,
        played: V.played, buffered: V.buffered, currentTime: V.currentTime, duration: V.duration, seek: V.seek, seekLabel: '{currentTime} / {duration}',
      },
    })
    const onError = () => setFailed(true)
    el.addEventListener('error', onError)
    return () => { el.removeEventListener('error', onError); player.destroy(); box.replaceChildren() }
  }, [file.url])
  if (failed) return <PreviewMessage text={P.videoUnsupported} file={file} />
  return (
    <div className="grid min-h-full place-items-center bg-black p-0 sm:p-4">
      <div ref={host} className="plyr-host w-full max-w-4xl" />
    </div>
  )
}
