import { useId } from 'react'

/** 笔下生花的标志：斜枝上一朵红边玉兰。导出图片也用它，所以只用内联 SVG。 */
export function Magnolia({ size = 30 }: { size?: number }) {
  const id = useId()
  const petal = { fill: `url(#${id})`, stroke: '#c8323a', strokeWidth: 2.4, strokeLinejoin: 'round' as const }
  const bark = '#6b4f3a'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="笔下工单" role="img">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".55" stopColor="#fffafa" />
          <stop offset="1" stopColor="#f6cfd3" />
        </linearGradient>
      </defs>
      <path d="M5 61C12 57 18 53 24.5 47.5M14.5 55.5 13 49.5" fill="none" stroke={bark} strokeWidth="2.4" strokeLinecap="round" />
      <g transform="translate(36 30) rotate(30) scale(.86) translate(-32 -32)">
        <path {...petal} d="M31 54C22.5 53.5 15.5 47 12.5 38 11 33 10.5 28 11 23.5 16.5 25.5 23 31 27.5 39Z" />
        <path {...petal} d="M33 54C41.5 53.5 48.5 47 51.5 38 53 33 53.5 28 53 23.5 47.5 25.5 41 31 36.5 39Z" />
        <path {...petal} d="M30.5 53C24 49 21.5 37 22.5 26 23.2 19 25 13.5 26.5 12 29.5 15 31.5 24 32 32Z" />
        <path {...petal} d="M33.5 53C40 49 42.5 37 41.5 26 40.8 19 39 13.5 37.5 12 34.5 15 32.5 24 32 32Z" />
        <path {...petal} d="M32 55.5C26.5 51.5 25 38 26 27 27 17 29.5 10 32 7.5 34.5 10 37 17 38 27 39 38 37.5 51.5 32 55.5Z" />
        <path d="M28 53.5Q32 59 36 53.5" fill={bark} stroke={bark} strokeWidth="1.6" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
