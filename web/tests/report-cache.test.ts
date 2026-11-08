import { afterEach, expect, it, vi } from 'vitest'
import { cachedReport, clearReportCache, reportScope, requestReport } from '@/client/report-cache'
import type { Boot } from '@/server/bootstrap'
afterEach(()=>{clearReportCache();vi.unstubAllGlobals();vi.useRealTimers()})
it('并发首次进入共用请求，再进相同报表直接读缓存', async()=>{
  let finish!:(r:Response)=>void
  const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve}));vi.stubGlobal('fetch',fetcher)
  const a=requestReport('/report','boss-v1'),b=requestReport('/report','boss-v1')
  expect(fetcher).toHaveBeenCalledTimes(1)
  finish(Response.json({sales:123}));expect(await a).toEqual(await b)
  expect(cachedReport('boss-v1')).toEqual({sales:123})
  await requestReport('/report','boss-v1');expect(fetcher).toHaveBeenCalledTimes(1)
})
it('账号、权限、版本、日期隔离，过期会重新取数',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T02:00:00Z'))
  const state={me:{id:'boss'},role:{locked:true},version:1} as Boot
  const scope=reportScope(state)
  expect(reportScope({...state,me:{...state.me,id:'writer'}})).not.toBe(scope)
  expect(reportScope({...state,role:{...state.role,locked:false}})).not.toBe(scope)
  expect(reportScope({...state,version:2})).not.toBe(scope)
  const fetcher=vi.fn(async()=>Response.json({sales:1}));vi.stubGlobal('fetch',fetcher)
  await requestReport('/report',scope)
  vi.advanceTimersByTime(30_001);expect(cachedReport(scope)).toBeUndefined()
  await requestReport('/report',scope);expect(fetcher).toHaveBeenCalledTimes(2)
  vi.setSystemTime(new Date('2026-11-06T02:00:00Z'));expect(reportScope(state)).not.toBe(scope)
})
it('失败不缓存成零，允许重试成功',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:'稍后重试'},{status:503})).mockResolvedValueOnce(Response.json({sales:99}));vi.stubGlobal('fetch',fetcher)
  await expect(requestReport('/report','one')).rejects.toThrow('稍后重试');expect(cachedReport('one')).toBeUndefined()
  expect(await requestReport('/report','one')).toEqual({sales:99})
})
