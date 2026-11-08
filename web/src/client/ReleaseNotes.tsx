import { ArrowDown, ArrowUpRight, CheckCircle, GitBranch, Tag } from '@phosphor-icons/react'
import { ANDROID_RELEASE } from '@/shared/company-resources'
import { WORKBENCH_RELEASES, type ReleaseSection } from '@/shared/releases'
import { cn } from '@/lib/utils'

const sectionColors: Record<ReleaseSection['kind'], string> = {
  新增: 'bg-primary/10 text-primary',
  优化: 'bg-muted text-muted-foreground',
  修复: 'bg-ok/10 text-ok',
  待处理: 'bg-warn/10 text-warn',
}

export function ReleaseNotes() {
  return <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="版本更新记录">
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><GitBranch size={15} />{WORKBENCH_RELEASES.length} 个发布版本</span>
        <span className="inline-flex items-center gap-1.5"><CheckCircle size={15} />网页随发布更新，刷新生效</span>
        <a href={ANDROID_RELEASE.page} target="_blank" rel="noreferrer" className="ml-auto inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowDown size={14} />Android {ANDROID_RELEASE.version}<ArrowUpRight size={12} />
        </a>
      </div>
      <ol className="space-y-5">
        {WORKBENCH_RELEASES.map((release, index) => <li key={release.version} className="relative grid gap-2 sm:grid-cols-[116px_minmax(0,1fr)] sm:gap-6">
          <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground sm:block sm:text-right">
            <time dateTime={release.date} className="num">{release.date}</time>
            <span className="inline-flex items-center gap-1 sm:mt-2 sm:flex sm:justify-end"><Tag size={12} />{release.version}</span>
          </div>
          <article aria-labelledby={`release-${release.version}`} className={cn('relative min-w-0 rounded-xl border p-4 sm:p-5', index === 0 && 'border-primary/30 bg-primary/[0.025]')}>
            <span className={cn('absolute -left-[19px] top-5 hidden h-3 w-3 rounded-full border-[3px] border-background sm:block', index === 0 ? 'bg-primary ring-1 ring-primary/30' : 'bg-muted-foreground/40')} aria-hidden="true" />
            {index < WORKBENCH_RELEASES.length - 1 && <span className="absolute -left-[14px] bottom-[-42px] top-9 hidden w-px bg-border sm:block" aria-hidden="true" />}
            <header className="mb-4 flex flex-wrap items-center gap-2">
              <h2 id={`release-${release.version}`} className="text-base font-semibold leading-snug">{release.title}</h2>
              {index === 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">最新</span>}
              {release.androidVersion && <span className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground">Android {release.androidVersion}</span>}
            </header>
            <div className="space-y-3.5">
              {release.sections.map(section => <section key={section.kind} className="grid grid-cols-[48px_minmax(0,1fr)] items-start gap-3">
                <h3 className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-center text-[11px] font-medium leading-5', sectionColors[section.kind])}>{section.kind}</h3>
                <ul className="space-y-1.5 pt-0.5 text-[13px] leading-relaxed">
                  {section.items.map(item => <li key={item} className="relative pl-3 before:absolute before:left-0 before:top-[0.65em] before:h-1 before:w-1 before:rounded-full before:bg-muted-foreground/45">{item}</li>)}
                </ul>
              </section>)}
            </div>
          </article>
        </li>)}
      </ol>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">App 内业务页面与网页同步；安卓原生功能更新时，需安装新版 APK。历史版本按已有发布记录整理。</p>
    </div>
  </div>
}
