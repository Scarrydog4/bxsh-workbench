'use client'

import type { CSSProperties, ReactNode } from 'react'
import { Check } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { AVATAR_FRAME_IDS, AVATAR_FRAME_NAMES, avatarFrame, type AvatarFrameId } from '@/shared/avatar-frames'
import { RANKS, type Rank } from '@/shared/rank'
import maggot from './frames/maggot.png'
import pupa from './frames/pupa.png'
import fly from './frames/fly.png'
import pest from './frames/pest.png'
import bee from './frames/bee.png'

const gold = 'hsl(var(--avatar-gold))', jade = 'hsl(var(--primary))', ink = 'hsl(var(--foreground))', blue = 'hsl(var(--info))', pink = 'hsl(var(--avatar-pink))'
const line = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** An outside-only layer: its parent keeps the exact original avatar dimensions. */
export function AvatarFrameDecoration({ frame: value, size }: { frame?: string | null; size: number }) {
  const frame = avatarFrame(value)
  if (frame === 'none') return null
  const width = Math.max(1.5, size * .045), gap = width
  const style: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: '50%', color: gold }
  const outline = (color: string, outer = 0): CSSProperties => ({ ...style, inset: -outer, outline: `${outer ? Math.max(1, width * .6) : width}px solid ${color}`, outlineOffset: gap })
  const ring = (color: string, faded = false) => <span style={{ ...outline(color), opacity: faded ? .55 : 1 }} />
  const sketchRing = (color: string) => <svg viewBox="0 0 100 100" style={{ ...style, inset: '-11%', width: '122%', height: '122%', overflow: 'visible' }} aria-hidden="true"><path d="M49 3C73 2 97 23 97 48S77 97 51 97 3 77 3 51 22 4 44 3" {...line} stroke={color} strokeWidth={size < 24 ? 4 : 2.7} opacity=".65"/><path d="M8 33C14 19 24 10 36 7M65 94C78 89 89 78 93 66" {...line} stroke={color} strokeWidth="1.1" opacity=".45"/></svg>
  const badge = (children: ReactNode, corner: 'top' | 'bottom' | 'head' = 'bottom', angle = 0) => <svg viewBox="0 0 64 64" style={{ position: 'absolute', width: corner === 'head' ? Math.max(12, size * .58) : Math.max(14, size * .55), height: corner === 'head' ? Math.max(12, size * .58) : Math.max(14, size * .55), ...(corner === 'head' ? { left: '50%', top: -Math.max(12, size * .58) * .78, transform: 'translateX(-50%)' } : { right: '-22%', ...(corner === 'top' ? { top: '-32%' } : { bottom: '-22%' }), transform: `rotate(${angle}deg)` }), overflow: 'visible' }} aria-hidden="true">{children}</svg>
  const doodle = (kind: 'crown' | 'bow') => {
    const isCrown = kind === 'crown', color = isCrown ? gold : pink
    // 小头像（列表里 14px）也画，按头像等比缩小，不再固定最小 18px 宽
    const small = size < 18
    const artWidth = small ? size * 1.15 : Math.max(18, size * (isCrown ? 1.02 : .96)), artHeight = small ? size * .5 : Math.max(7, size * .38)
    const stroke = size < 24 ? 4.2 : 3.8
    return <svg viewBox="0 0 100 48" preserveAspectRatio="none" style={{ position: 'absolute', width: artWidth, height: artHeight, top: -artHeight * .63, ...(isCrown ? { left: '50%', transform: 'translateX(-50%)' } : { right: '-8%', transform: 'rotate(-4deg)' }), overflow: 'visible' }} aria-hidden="true">
      <g {...line} stroke={color} strokeWidth={stroke}>
        {isCrown ? <>
          <path d="M8 12Q18 17 26 25L44 5Q54 14 63 24L94 11 91 24 88 39Q71 37 51 41L31 40 15 41Q12 27 8 12Z" fill="hsl(var(--card))"/>
          <path d="M8 12Q18 17 26 25L44 5Q54 14 63 24L94 11 91 24 88 39Q71 37 51 41L31 40 15 41Q12 27 8 12Z" fill="hsl(var(--avatar-gold) / .3)"/>
          <path d="M21 31q8-5 15 0t16-1 15 1 15-2M25 35q18-3 35 0t21-1" strokeWidth="4" opacity=".3"/>
          <path d="m11 16 6 22q16-2 25 1t20-1 24-1" strokeWidth="1.5" opacity=".65"/>
        </> : <>
          <path d="M44 24Q26 16 11 8L6 13q4 9 4 22l8 3 26-10m12-4Q76 12 88 7l6 5q-3 13-3 25l-8 2-28-11" fill="hsl(var(--card))"/>
          <path d="M44 24Q26 16 11 8L6 13q4 9 4 22l8 3 26-10m12-4Q76 12 88 7l6 5q-3 13-3 25l-8 2-28-11" fill="hsl(var(--avatar-pink) / .3)"/>
          <path d="m44 29-10 13 11-3 5 5 3-14m3-2 14 13-12-2-5 5-2-13" fill="hsl(var(--avatar-pink) / .22)"/>
          <path d="m15 17 21 9-21 3m68-13-21 10 23 4" strokeWidth="4" opacity=".3"/>
          <path d="m43 19 13-2 4 12-5 5-13-2-2-8Z" fill="hsl(var(--avatar-pink) / .6)"/>
          <path d="m10 14 3 20 7 1m68-24 3 5-3 18M47 21l-1 7" strokeWidth="1.5" opacity=".65"/>
        </>}
      </g>
    </svg>
  }
  let art: ReactNode
  if (frame === 'gold' || frame === 'jade' || frame === 'double') {
    art = <>{ring(frame === 'jade' ? jade : gold)}{frame === 'double' && <span style={outline('hsl(var(--avatar-gold) / .45)', gap + width + 1)} />}</>
  } else if (frame === 'aurora' || frame === 'galaxy') {
    const mask = `radial-gradient(farthest-side, transparent calc(100% - ${width}px), #000 calc(100% - ${width}px))`
    art = <span className="avatar-frame-flow" style={{ position: 'absolute', inset: -gap - width, borderRadius: '50%', background: frame === 'aurora' ? `conic-gradient(from 200deg, ${jade}, ${gold}, ${jade})` : 'conic-gradient(#6f8dff,#b07cff,#ff8ec6,#6f8dff)', mask, WebkitMask: mask }} />
  } else if (frame === 'flower') {
    art = <svg viewBox="-80 -80 160 160" style={{ ...style, inset: '-30%', width: '160%', height: '160%', overflow: 'visible' }} aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <g key={i} transform={`rotate(${i * 45})`}><path d="M0-53C-10-60-7-73 0-74 8-71 9-59 0-53Z" fill="hsl(var(--avatar-gold) / .2)" stroke={gold} strokeWidth="1.8" strokeLinejoin="round"/><path d="M0-58 1-68" stroke={gold} strokeWidth="1.2" strokeLinecap="round"/><circle cx="0" cy="-63" r="2.7" transform="rotate(22.5)" fill={jade}/></g>)}</svg>
  } else if (frame === 'brush') {
    art = <svg viewBox="-80 -80 160 160" style={{ ...style, inset: '-30%', width: '160%', height: '160%' }} aria-hidden="true"><path d="M-26-54C-1-67 34-57 48-34S65 15 43 41 0 63-25 53-61 22-58-4" {...line} stroke={ink} strokeWidth="5.5" opacity=".72"/><path d="M-59-16C-54-32-43-47-32-51M-53 32C-35 57-4 65 23 56M54-17C61 2 56 22 45 37" {...line} stroke={ink} strokeWidth="2" opacity=".45"/><path d="M-54-28-47-39M34 50 43 43" {...line} stroke={ink} strokeWidth="1.2" opacity=".6"/></svg>
  } else {
    const color = frame === 'bow' ? pink : frame === 'knight' ? blue : frame === 'nib' ? jade : gold
    art = <>{sketchRing(color)}{(size >= 18 || (size >= 12 && (frame === 'crown' || frame === 'bow'))) && (frame === 'crown' ? doodle('crown') : frame === 'knight' ? badge(<g {...line} stroke={blue} strokeWidth="2.6"><path d="M21 25C13 10 25 3 36 8 25 8 26 17 30 20" fill="hsl(var(--info) / .22)"/><path d="M17 27C17 17 27 14 36 17S49 29 46 37l-4 11-18 2-8-13Z" fill="hsl(var(--card))"/><path d="m18 27 31 2-4 11-28-4Z" fill="hsl(var(--info) / .2)"/><path d="m25 30-1 5m8-5-1 6m8-5-1 6M21 42l3 8m10-8 2 7" strokeWidth="2"/><path d="m15 48 31-1 6 9-43 1Z" fill="hsl(var(--info) / .18)"/><path d="M50 11v8m-4-4h8M12 18l-2 3" strokeWidth="1.5"/></g>, 'bottom', -9) : frame === 'bow' ? doodle('bow') : frame === 'nib' ? badge(<g {...line} stroke={jade} strokeWidth="2.4"><path d="M8 30C8 15 17 8 33 8s24 11 24 25S46 57 31 56 7 45 8 30Z" fill="hsl(var(--card))"/><path d="m17 46 6-25 22-6-6 23Z" fill="hsl(var(--primary) / .18)"/><path d="m17 46 13-13m-7-12 16 17"/><circle cx="31" cy="31" r="3" fill={jade}/></g>, 'bottom', -8) : badge(<g {...line} stroke={gold} strokeWidth="2.6"><path d="m32 6 8 17 19 3-14 14 3 18-16-9-17 9 3-19L5 26l19-3Z" fill="hsl(var(--card))"/><path d="m32 6 8 17 19 3-14 14 3 18-16-9-17 9 3-19L5 26l19-3Z" fill="hsl(var(--avatar-gold) / .2)"/><path d="m24 28 6-12m15 28 1 7" strokeWidth="1.6"/><path d="m10 7 2 4m42 43 3 2" strokeWidth="1.5"/></g>, 'bottom', 7))}</>
  }
  return <span aria-hidden="true" data-avatar-frame={frame} style={style}>{art}</span>
}

const BUGS: Record<Rank, { src: string }> = { maggot, pupa, fly, pest, bee }
// 类名写全，Tailwind 才不会把样式当成没用到的删掉
const RING: Record<Rank, string> = { maggot: 'rank-maggot', pupa: 'rank-pupa', fly: 'rank-fly', pest: 'rank-pest', bee: 'rank-bee' }

/** 单量头像框：环 + 右下角的小虫子（いらすとや 素材），任何尺寸都画虫子。样子和环色在 globals.css 的 .rank 那段。 */
export function RankFrameDecoration({ rank, size }: { rank: Rank; size: number }) {
  return <span aria-hidden="true" data-avatar-frame={`rank-${rank}`} className={cn('rank', RING[rank], size < 24 && 'rank-sm')} style={{ '--s': `${size}px` } as CSSProperties}>
    <img src={BUGS[rank].src} alt="" className="rank-bug"/>
  </span>
}

type FrameUser = { id: string; name: string; hue: number; avatar?: string; frame?: string; rank?: Rank }
function Preview({ user, frame, size }: { user: FrameUser; frame: AvatarFrameId; size: number }) {
  return <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
    <span className="avatar flex h-full w-full items-center justify-center overflow-hidden rounded-full font-medium leading-none" style={{ '--h': user.hue, fontSize: size * .48 } as CSSProperties}>{user.avatar ? <img src={user.avatar} alt="" className="h-full w-full object-cover"/> : user.name.replace(/老师$/, '').slice(0, 1)}</span>
    <AvatarFrameDecoration frame={frame} size={size}/>
  </span>
}

export function AvatarFramePicker({ user, onPick, heading = true }: { user: FrameUser; onPick: (frame: AvatarFrameId) => void; heading?: boolean }) {
  const selected = avatarFrame(user.frame)
  return <div className="grid gap-3">
    {heading && <div className="space-y-1"><span className="text-xs text-muted-foreground">头像框</span><p className="text-[11px] text-muted-foreground">{user.rank ? `今天是「${RANKS.find(r => r.id === user.rank)!.name}」，销售按当天单量自动换框，这里选的先不显示` : '每一款都可以自由切换'}</p></div>}
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="选择头像框">
      {AVATAR_FRAME_IDS.map(frame => <button key={frame} type="button" data-frame-tile="" aria-pressed={selected === frame} aria-label={`头像框：${AVATAR_FRAME_NAMES[frame]}`} onClick={() => onPick(frame)} className={cn('relative flex min-w-0 flex-col items-center gap-2 rounded-lg border px-2 pb-3 pt-6 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', selected === frame ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border/70')}>
        {selected === frame && <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground"><Check size={11} weight="bold"/></span>}
        <Preview user={user} frame={frame} size={44}/>
        <span className="mt-1 text-xs">{AVATAR_FRAME_NAMES[frame]}</span>
      </button>)}
    </div>
    <style>{`@keyframes avatar-frame-turn { to { transform: rotate(360deg); } } [data-frame-tile]:hover .avatar-frame-flow, [data-frame-tile]:focus-visible .avatar-frame-flow { animation: avatar-frame-turn 4s linear infinite; }`}</style>
  </div>
}
