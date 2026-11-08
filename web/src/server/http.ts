import { FORUM_COPY } from '@/shared/copy/forum'
import { getCtx, type Ctx } from './session'
import { trustedWriteRequest } from './request-security'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const deny = (msg = '当前账号没有这个权限') => new HttpError(403, msg)
export const bad = (msg: string) => new HttpError(400, msg)
export const notFound = (msg = '找不到这条记录，或不在你的可见范围内') => new HttpError(404, msg)

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...init?.headers } })
}

/** 包一层：统一认证、统一错误格式 { error } */
export function route<P = unknown>(fn: (req: Request, ctx: Ctx, params: P) => Promise<Response>, opts: { allowMustChange?: boolean; forum?: boolean } = {}) {
  return async (req: Request, extra: { params: Promise<P> }) => {
    try {
      if (!trustedWriteRequest(req)) return json({ error: '请在平台页面内操作' }, { status: 403 })
      const ctx = await getCtx(req)
      if (!ctx) return json({ error: opts.forum ? FORUM_COPY.errors.forbidden : '请先登录' }, { status: 401 })
      if (ctx.me.mustChangePassword && !opts.allowMustChange) return json({ error: opts.forum ? FORUM_COPY.errors.forbidden : '首次登录请先改密码', mustChangePassword: true }, { status: 403 })
      return await fn(req, ctx, (await extra?.params) as P)
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status })
      console.error(e)
      return json({ error: opts.forum ? FORUM_COPY.errors.unknown : '服务器出错了，稍后再试' }, { status: 500 })
    }
  }
}

export function forumRoute<P = unknown>(fn: (req: Request, ctx: Ctx, params: P) => Promise<Response>) {
  return route(fn, {forum:true})
}
