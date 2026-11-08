import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, cleanups: [] as (() => void)[], effects: [] as (() => void | (() => void))[], reduced: false }))
vi.mock('react', async () => ({ ...await vi.importActual('react'),
  useState: (initial: any) => { const i=h.cursor++; if (!(i in h.slots)) h.slots[i]=typeof initial==='function'?initial():initial; return [h.slots[i],(next:any)=>{h.slots[i]=typeof next==='function'?next(h.slots[i]):next}] },
  useRef: (value:any) => { const i=h.cursor++; return h.slots[i]??={current:value} },
  useEffect: (effect:()=>void|(()=>void)) => {h.effects.push(effect)},
}))
vi.mock('motion/react',()=>({AnimatePresence:'presence',motion:{div:'motion-div'},useReducedMotion:()=>h.reduced}))
vi.mock('@/components/ui/button',()=>({Button:'button'}))
vi.mock('@/components/ui/popover',()=>({Popover:'popover',PopoverContent:'popover-content',PopoverTrigger:'popover-trigger'}))
vi.mock('@/components/ui/dropdown-menu',()=>({DropdownMenu:'menu',DropdownMenuContent:'menu-content',DropdownMenuItem:'item',DropdownMenuTrigger:'trigger'}))
vi.mock('@/client/ui',()=>({StatusPill:'status-pill'}))
vi.mock('@/client/PersonChoice',()=>({PersonChoice:'person-choice'}))
vi.mock('@/client/store',()=>({bulkStatus:vi.fn(),bulkWriters:vi.fn(),deleteOrders:vi.fn(),restoreOrders:vi.fn()}))
vi.mock('sonner',()=>({toast:vi.fn()}))
import { useOperationFeedback, OperationStatus } from '@/client/operation-feedback'
import { useOrderUpdateFeedback } from '@/client/order-update-feedback'
import { OrdersBulkActions } from '@/client/OrdersBulkActions'
import { bulkStatus } from '@/client/store'
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()}
const nodes=(n:any):any[]=>Array.isArray(n)?n.flatMap(nodes):n?.props?[n,...nodes(n.props.children)]:[]
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(done=>resolve=done);return{promise,resolve}}
function runHook(){h.cursor=0;return useOperationFeedback()}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('window',new EventTarget());vi.stubGlobal('requestAnimationFrame',(cb:()=>void)=>setTimeout(cb,0));vi.stubGlobal('cancelAnimationFrame',clearTimeout)})
afterEach(()=>{h.cleanups.forEach(clean=>clean());h.slots=[];h.cursor=0;h.cleanups=[];h.effects=[];h.reduced=false;vi.clearAllTimers();vi.useRealTimers();vi.resetAllMocks();vi.unstubAllGlobals()})
it('字段连续请求旧结果不覆盖较新的保存状态；确认后定时消退',async()=>{
 const first=deferred<boolean>(),second=deferred<boolean>();const hook=runHook();const a=hook.run(()=>first.promise);expect(runHook().state.status).toBe('saving');const b=runHook().run(()=>second.promise)
 first.resolve(true);await a;expect(runHook().state.status).toBe('saving')
 second.resolve(true);await b;expect(runHook().state).toMatchObject({status:'success',message:'已保存'});await vi.advanceTimersByTimeAsync(1000);expect(runHook().state.status).toBe('idle')
})
it('输入修改或卸载后旧请求不会回填反馈；未知异常不显示明确失败',async()=>{
 const pending=deferred<boolean>();let hook=runHook();const save=hook.run(()=>pending.promise);runHook().reset();pending.resolve(true);await save;expect(runHook().state.status).toBe('idle')
 hook=runHook();await hook.run(async()=>{throw new Error('disconnected')});expect(runHook().state.status).toBe('uncertain')
 const later=deferred<boolean>();const wait=runHook().run(()=>later.promise);h.effects[0]()!();later.resolve(true);await wait;expect(runHook().state.status).toBe('saving');expect(vi.getTimerCount()).toBe(0)
})
it('状态保留文字与读屏语义，错误不只靠颜色',()=>{
 expect(OperationStatus({state:{status:'error',message:'请检查金额'}}).props.role).toBe('alert')
 expect(OperationStatus({state:{status:'saving',message:'保存中'}}).props['aria-live']).toBe('polite')
})
it('1000行远程更新只标记目标，帧内合并且定时与监听在卸载清理',async()=>{
 const elements=Array.from({length:1000},(_,i)=>({dataset:{orderFeedbackId:String(i)},classList:{contains:()=>false,add:vi.fn(),remove:vi.fn()}}))
 const querySelectorAll=vi.fn(()=>elements);useOrderUpdateFeedback({current:{querySelectorAll}} as any,'boss');const dispose=h.effects.at(-1)!() as ()=>void
 window.dispatchEvent(new CustomEvent('bxsh:changed',{detail:{orderIds:['5']}}));window.dispatchEvent(new CustomEvent('bxsh:changed',{detail:{orderIds:['8']}}));await vi.advanceTimersByTimeAsync(0)
 expect(querySelectorAll).toHaveBeenCalledOnce();expect(elements.filter(e=>e.classList.add.mock.calls.length)).toHaveLength(2);expect(elements[5].classList.add).toHaveBeenCalledWith('order-updated')
 dispose();expect(elements[5].classList.remove).toHaveBeenCalledWith('order-updated');expect(vi.getTimerCount()).toBe(0)
 window.dispatchEvent(new CustomEvent('bxsh:changed',{detail:{orderIds:['9']}}));await vi.runAllTimersAsync();expect(querySelectorAll).toHaveBeenCalledOnce()
})
it('批量忙碌不显示虚假处理数，防重触发，失败保留选择成功才清除',async()=>{
 const onDone=vi.fn(),args={ids:['a','b'],can:()=>true,people:[],statuses:['已交付'],onDone,onCancel:vi.fn(),cards:vi.fn(),exportExcel:vi.fn()};const render=()=>{h.cursor=0;return OrdersBulkActions(args)}
 const pending=deferred<number>();vi.mocked(bulkStatus).mockReturnValueOnce(pending.promise)
 const first=nodes(render()).find(n=>n.type==='item');first.props.onSelect();first.props.onSelect();expect(bulkStatus).toHaveBeenCalledOnce();expect(onDone).not.toHaveBeenCalled()
 const state=nodes(render()).find(n=>n.type===OperationStatus).props.state;expect(state).toMatchObject({status:'saving',message:'正在更新 2 单'});expect(JSON.stringify(state)).not.toContain('%')
 pending.resolve(0);await flush();expect(onDone).not.toHaveBeenCalled();expect(nodes(render()).find(n=>n.type===OperationStatus).props.state.status).toBe('error')
 vi.mocked(bulkStatus).mockResolvedValueOnce(2);nodes(render()).find(n=>n.type==='item').props.onSelect();await flush();expect(onDone).toHaveBeenCalledExactlyOnceWith(['a','b'])
})
it('减少动态模式批量条不含位移，状态文字仍显示',()=>{
 h.reduced=true;const tree=OrdersBulkActions({ids:['a'],can:()=>false,people:[],statuses:[],onDone:vi.fn(),onCancel:vi.fn(),cards:vi.fn(),exportExcel:vi.fn()});const panel=nodes(tree).find(n=>n.type==='motion-div');expect(panel.props.initial).toBe(false);expect(panel.props.exit).toEqual({opacity:1,y:0});expect(panel.props.transition.duration).toBe(0);expect(panel.props['aria-label']).toBe('批量订单操作')
})

it('成功停留在卸载时解除等待，不留下定时器',async()=>{
 const hook=runHook();const cleanup=h.effects[0]() as ()=>void
 const pending=hook.confirm('结算已记录')
 expect(runHook().state.status).toBe('success')
 cleanup();await pending
 expect(vi.getTimerCount()).toBe(0)
})
