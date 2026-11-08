export interface ForumAttachmentView {
  id: string
  name: string
  size: number
  mime: string
  version: string | null
  downloads: number
  createdAt: string
  downloadUrl: string
  previewUrl: string
  thumbnailUrl: string | null
  latest: boolean
}
