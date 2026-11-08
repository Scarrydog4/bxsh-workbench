import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, order: { attachments: [] as any[], afterSales: [] as any[] } }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'), useEffect: () => {},
  useState: (initial: any) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = initial; return [h.slots[i], (v: any) => { h.slots[i] = typeof v === 'function' ? v(h.slots[i]) : v }] },
  useRef: (current: any) => { const i = h.cursor++; return h.slots[i] ??= { current } },
}))
vi.mock('@/client/store', () => ({ useSession: () => ({ order: () => h.order }), refreshOrders: vi.fn(), uploadDeliveryShot: vi.fn(), markDraft: vi.fn(), finishAfterSale: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }))
import { DeliveryForm } from '@/client/DeliverButton'
import { ImageInputActions } from '@/client/ImageInputActions'
import { uploadDeliveryShot, markDraft, finishAfterSale } from '@/client/store'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { thumbnailSource } from '@/client/ImageViewer'
const nodes = (n: any): any[] => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : []
function render(kind: 'draft' | 'aftersale' = 'draft') { h.cursor = 0; return DeliveryForm({ kind, orderId: 'o', asId: kind === 'aftersale' ? 'as' : undefined, no: 'DD' }) }
const click = (tree: any, text: string) => nodes(tree).find(n => n.props.children === text).props.onClick()
afterEach(() => { h.slots = []; h.cursor = 0; h.order = { attachments: [], afterSales: [] }; vi.resetAllMocks() })

it('确认失败后收起再打开保留截图，重试只确认，不重传已保存文件', async () => {
  vi.mocked(uploadDeliveryShot).mockResolvedValue('f_saved')
  vi.mocked(markDraft).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const file = new File(['screenshot'], 'screen.png', { type: 'image/png' })
  let tree = render()
  nodes(tree).find(n => n.type === ImageInputActions).props.onFiles([file])
  tree = render(); await click(tree, '确认交付')
  await vi.waitFor(() => expect(nodes(render()).some(n => n.props.role === 'alert')).toBe(true)); tree = render()
  nodes(tree).find(n => n.type === Popover).props.onOpenChange(false)
  nodes(render()).find(n => n.type === Popover).props.onOpenChange(true)
  tree = render(); expect(nodes(tree).filter(n => n.type === 'img')).toHaveLength(1)
  await click(tree, '重试确认')
  await vi.waitFor(() => expect(markDraft).toHaveBeenCalledTimes(2))
  expect(uploadDeliveryShot).toHaveBeenCalledTimes(1)
  expect(markDraft).toHaveBeenNthCalledWith(1, 'o', ['f_saved'], expect.any(Object))
  expect(markDraft).toHaveBeenNthCalledWith(2, 'o', ['f_saved'], expect.any(Object))
})

it.each(['draft', 'aftersale'] as const)('重新进入%s可选本单本轮已存交付截图，不把意见或收款截图当成交付', async kind => {
  const prefix = kind === 'draft' ? '初稿' : '售后'
  const file = { id: 'saved', name: prefix + '交付截图-1.png' }
  h.order = { attachments: [file, { id: 'brief', name: '需求.png' }], afterSales: [{ id: 'as', files: [file, { id: 'brief', name: '要求.png' }] }, { id: 'other', files: [{ id: 'other-file', name: '售后交付截图.png' }] }] }
  vi.mocked(markDraft).mockResolvedValue(true); vi.mocked(finishAfterSale).mockResolvedValue(true)
  let tree = render(kind)
  const saved = nodes(tree).filter(n => n.props['aria-label']?.startsWith('使用已存截图'))
  expect(saved).toHaveLength(1); saved[0].props.onClick()
  tree = render(kind); await click(tree, '确认交付')
  expect(uploadDeliveryShot).not.toHaveBeenCalled()
  if (kind === 'draft') expect(markDraft).toHaveBeenCalledWith('o', ['saved'], expect.any(Object))
  else expect(finishAfterSale).toHaveBeenCalledWith('o', 'as', ['saved'], expect.any(Object))
})

it('缩略图保留现有参数，原图地址和本地预览不混用', () => {
  expect(thumbnailSource('/api/files/id?inline=1')).toBe('/api/files/id?inline=1&thumb=1')
  expect(thumbnailSource('id')).toBe('/api/files/id?inline=1&thumb=1')
  expect(thumbnailSource('blob:example')).toBe('blob:example')
})

it('读取剪贴板图片时立即确认也不会提前交付', async () => {
  const tree = render(), actions = nodes(tree).find(n => n.type === ImageInputActions)
  actions.props.onFiles([new File(['picture'], 'shot.png', { type: 'image/png' })])
  const populated = render()
  nodes(populated).find(n => n.type === ImageInputActions).props.onReading(true)
  await click(populated, '确认交付')
  expect(uploadDeliveryShot).not.toHaveBeenCalled(); expect(markDraft).not.toHaveBeenCalled()
  expect(nodes(render()).find(n => n.props.children === '确认交付').props.disabled).toBe(true)
})

it('交付白区可直接聚焦，上传只显示图标，拖图仍接入本次交付', () => {
  const tree = render(), zone = nodes(tree).find(n => n.props['aria-label'] === '交付截图粘贴和拖入区域'), panel = nodes(tree).find(n => n.type === PopoverContent), focus = vi.fn()
  nodes(zone).find(n => n.type === 'textarea').props.ref.current = { focus }
  panel.props.onClick({ target: { closest: () => null }, stopPropagation: vi.fn() })
  expect(focus).toHaveBeenCalledOnce()
  expect(nodes(zone).find(n => n.type === ImageInputActions).props.pickerOnly).toBe(true)
  const file = new File(['picture'], 'shot.png', { type: 'image/png' }), stopPropagation = vi.fn()
  panel.props.onDrop({ dataTransfer: { files: [file], items: [] }, preventDefault: vi.fn(), stopPropagation })
  expect(stopPropagation).toHaveBeenCalledOnce()
  expect(nodes(render()).filter(n => n.type === 'img')).toHaveLength(1)
})
