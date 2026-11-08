import { ChatCircleText, Flask, Megaphone, Package, FileText, ListBullets } from '@phosphor-icons/react'
import type { ForumCategory } from '@/shared/forum'

/** 分类只用图标区分，不上彩色（颜色另有含义）。 */
const ICONS = { all: ListBullets, announcement: Megaphone, feedback: ChatCircleText, skill: Package, document: FileText, showcase: Flask } as const
export function CategoryIcon({ category, size = 16, className }: { category: ForumCategory | 'all'; size?: number; className?: string }) {
  const Icon = ICONS[category]
  return <Icon size={size} className={className} />
}
