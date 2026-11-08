import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '笔下工单',
  applicationName: '笔下工单',
  description: '订单、跟进、结算',
  icons: {
    icon: [
      { url: '/icon.svg?v=flower-20261026', type: 'image/svg+xml', sizes: 'any' },
      { url: '/icon1.png?v=flower-20261026', type: 'image/png', sizes: '64x64' },
    ],
    shortcut: '/favicon.ico?v=flower-20261026',
    apple: { url: '/apple-icon.png?v=flower-20261026', sizes: '180x180' },
  },
  appleWebApp: { capable: true, title: '笔下工单', statusBarStyle: 'default' },
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Noto+Serif+SC:wght@900&display=swap" />
        {/* 深浅色在首帧前就定好，避免闪一下 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=JSON.parse(localStorage.getItem('bxsh:theme')||'"system"');if(t!=='system')document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
