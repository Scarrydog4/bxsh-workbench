import { afterEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0 }))
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useState: (initial: any) => {
    const i = h.cursor++
    if (!(i in h.slots)) h.slots[i] = initial
    return [h.slots[i], (value: any) => { h.slots[i] = typeof value === 'function' ? value(h.slots[i]) : value }]
  },
}))
vi.mock('@/client/Shell', () => ({ Logo: () => null }))
vi.mock('@/client/Profile', () => ({ PasswordForm: () => null }))
vi.mock('@/client/ui', () => ({ inputCls: '' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('sonner', () => ({ Toaster: 'div' }))

import { LoginForm } from '@/client/Login'

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''
const render = () => { h.cursor = 0; return nodes(LoginForm()) }
const password = () => render().find(node => node.props.id === 'login-password')

afterEach(() => {
  h.slots = []
  h.cursor = 0
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it('密码可以显示和隐藏，自动填充语义保持不变', () => {
  const initial = password()
  expect(initial.props.type).toBe('password')
  expect(initial.props.autoComplete).toBe('current-password')
  render().find(node => node.props['aria-label'] === '显示密码').props.onClick()

  expect(password().props.type).toBe('text')
  expect(password().props.autoComplete).toBe('current-password')
  render().find(node => node.props['aria-label'] === '隐藏密码').props.onClick()
  expect(password().props.type).toBe('password')
})

it('检测大写锁定，失焦后清除提示', () => {
  password().props.onKeyDown({ getModifierState: (key: string) => key === 'CapsLock' })
  expect(password().props['aria-describedby']).toBe('login-caps-lock')
  expect(render().some(node => node.props.id === 'login-caps-lock' && node.props.role === 'status')).toBe(true)

  password().props.onBlur()
  expect(text(render())).not.toContain('大写锁定已开启')
})

it('登录错误有告警语义，编辑后移除错误状态', () => {
  h.slots[2] = '登录名或密码错误'
  expect(render().find(node => node.props.id === 'login-error').props.role).toBe('alert')
  expect(password().props['aria-invalid']).toBe(true)
  render().find(node => node.props.id === 'login-account').props.onChange({ target: { value: 'boss' } })
  expect(render().some(node => node.props.id === 'login-error')).toBe(false)
})

it('纯空白账号不能提交', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  h.slots[0] = '   '
  h.slots[1] = 'secret'
  expect(render().find(node => node.props.type === 'submit').props.disabled).toBe(true)
  await render().find(node => node.type === 'form').props.onSubmit({ preventDefault: vi.fn() })
  expect(fetcher).not.toHaveBeenCalled()
})

it('提交只 trim 登录名，不改变密码内容', async () => {
  const replace = vi.fn()
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('location', { search: '', replace })
  h.slots[0] = '  boss  '
  h.slots[1] = '  secret  '
  await render().find(node => node.type === 'form').props.onSubmit({ preventDefault: vi.fn() })

  const body = JSON.parse(fetcher.mock.calls[0][1].body)
  expect(body).toEqual({ account: 'boss', password: '  secret  ' })
  expect(replace).toHaveBeenCalledWith('/')
})
