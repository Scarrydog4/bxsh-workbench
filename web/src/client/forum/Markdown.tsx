'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { cn } from '@/lib/utils'

/** 帖子正文：GFM（表格、任务列表、删除线），不允许原始 HTML，链接新窗口打开。 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('md', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
        table: ({ node: _node, ...props }) => <div className="md-table"><table {...props} /></div>,
      }}>{children}</ReactMarkdown>
    </div>
  )
}

export { plainText } from '@/shared/plain-text'
