import type { Metadata } from 'next'
import { AndroidUpdateButton } from '@/client/AndroidUpdateButton'
import { ANDROID_RELEASE } from '@/shared/company-resources'

export const metadata: Metadata = { title: '安卓下载 · 笔下工单', description: '员工安卓客户端安装下载' }

export default function DownloadPage() {
  return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
    <section className="w-full max-w-sm rounded-2xl border bg-card p-7 shadow-sm">
      <img src="/icon.svg?v=flower-20261026" alt="笔下工单" className="mb-6 h-16 w-16"/>
      <p className="mb-2 text-xs font-medium tracking-widest text-primary">员工客户端</p>
      <h1 className="text-2xl font-semibold tracking-tight">笔下工单</h1>
      <p className="mt-3 text-sm text-muted-foreground">订单 · 交付 · 收入</p>
      <a href={ANDROID_RELEASE.download} download={ANDROID_RELEASE.filename} className="mt-8 flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-base font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">下载安卓安装包</a>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>v{ANDROID_RELEASE.version} · Android {ANDROID_RELEASE.minimumAndroid} 及以上 · 内部测试版</span>
        <AndroidUpdateButton />
      </div>
      <ol className="mt-7 space-y-3 border-t pt-5 text-sm leading-6 text-muted-foreground">
        <li><span className="mr-2 text-foreground">1</span>下载后打开 APK，按手机提示允许安装。</li>
        <li><span className="mr-2 text-foreground">2</span>安装后用原账号和密码登录。</li>
      </ol>
      <p className="mt-5 text-xs leading-5 text-muted-foreground">微信里无法下载时，请用手机浏览器打开此链接。iPhone 请继续使用网页版。</p>
    </section>
  </main>
}
