import { afterEach,expect,it,vi } from 'vitest'
const h=vi.hoisted(()=>({values:[] as any[],writes:[] as any[],refs:[] as any[]}))
vi.mock('react',async()=>({...await vi.importActual('react'),useState:()=>{const i=h.writes.length;h.writes.push([]);return [h.values.shift(),(v:any)=>h.writes[i].push(v)]},useRef:(v:any)=>{const r={current:v};h.refs.push(r);return r},useEffect:()=>{}}))
vi.mock('react-dom',()=>({flushSync:(fn:()=>void)=>fn()}))
vi.mock('@/client/store',()=>({useSession:()=>({s:{channels:[],users:[],types:[]},me:{id:'boss'},role:{locked:true},can:()=>true}),refresh:vi.fn().mockResolvedValue(undefined),addPayment:vi.fn().mockResolvedValue(false),uploadFiles:vi.fn().mockResolvedValue(true),salesPeople:()=>[],deleteOrders:vi.fn(),uploadDeliveryShot:vi.fn(),markDraft:vi.fn(),finishAfterSale:vi.fn()}))
vi.mock('@/client/nav',()=>({useNav:()=>({openOrder:vi.fn(),go:vi.fn()})}))
vi.mock('@/client/fresh',()=>({markFresh:vi.fn()}))
vi.mock('@/client/ui',()=>({ChannelAvatar:'span',Combobox:'span',inputCls:''}))
vi.mock('@/client/PersonChoice',()=>({PersonChoice:'span'}))
vi.mock('@/client/DatePicker',()=>({DatePicker:'span'}))
vi.mock('@/components/ui/button',()=>({Button:'button'}))
vi.mock('@/components/ui/popover',()=>({Popover:'div',PopoverContent:'section',PopoverTrigger:'span'}))
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}))
import { IntakeFlow } from '@/client/AiIntake'
import { DeliverButton } from '@/client/DeliverButton'
import { addPayment } from '@/client/store'
import { toast } from 'sonner'
function els(n:any):any[]{if(Array.isArray(n))return n.flatMap(els);if(!n?.props)return [];return [n,...els(n.props.children)]}
const row={key:'k',title:'试单',channelId:'c',channelName:'渠道',newChannel:false,ownerId:'boss',type:'',basePrice:1000,orderDate:'2026-10-08',dueDate:null,channelNo:'',note:'定金200',writerId:'w',writerName:'写手',writerPay:100,warnings:[],imageIndexes:[],deposit:200,paidAmount:'200',paymentNote:'渠道转账',paymentTag:'定金',open:false}
afterEach(()=>{h.writes=[];h.refs=[];vi.clearAllMocks();vi.unstubAllGlobals()})
it('定金保存失败不关闭；重试只保存失败的定金，不重复建单或记已成功款项',async()=>{
 h.values=['',[],[row,{...row,key:'k2',title:'另一单'}],'','','',[],false,false,false];vi.stubGlobal('document',{querySelector:()=>null});const fetcher=vi.fn().mockResolvedValue(Response.json({orders:[{id:'o1',no:'N1'},{id:'o2',no:'N2'}]}));vi.stubGlobal('fetch',fetcher)
 vi.mocked(addPayment).mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
 const closed=vi.fn();const tree=IntakeFlow({onClose:closed});const button=els(tree).find(e=>e.type==='button'&&String(e.props.children).includes('确认入库'));
 button.props.onClick();await vi.waitFor(()=>expect(h.writes[4].at(-1)).toBe(''));expect(closed).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();expect(h.writes[5].at(-1)).toContain('收款还没保存成功')
 const failedPayload=vi.mocked(addPayment).mock.calls[1][1]
 button.props.onClick();await vi.waitFor(()=>expect(closed).toHaveBeenCalledOnce());expect(fetcher).toHaveBeenCalledOnce();expect(vi.mocked(addPayment).mock.calls.map(c=>c[0])).toEqual(['o1','o2','o2']);expect(vi.mocked(addPayment).mock.calls[2][1]).toBe(failedPayload)
})
it('录单响应丢失后重试保持同一批次标识',async()=>{
 h.values=['',[],[row],'','','',[],false,false,false];vi.stubGlobal('document',{querySelector:()=>null});const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('离线')).mockResolvedValueOnce(Response.json({orders:[{id:'o',no:'N'}]}));vi.stubGlobal('fetch',fetcher);vi.mocked(addPayment).mockResolvedValue(true)
 const closed=vi.fn(), tree=IntakeFlow({onClose:closed});const button=els(tree).find(e=>e.type==='button'&&String(e.props.children).includes('确认入库'));
 button.props.onClick();await vi.waitFor(()=>expect(h.writes[4].at(-1)).toBe(''));button.props.onClick();await vi.waitFor(()=>expect(closed).toHaveBeenCalledOnce());expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body)
})
it('交付截图拖放截断冒泡，外层附件区不会再上传一次',()=>{
 h.values=[true,[],false,false,false];const tree=DeliverButton({kind:'draft',orderId:'o'});const zone=els(tree).find(e=>e.props.onDrop);const event={preventDefault:vi.fn(),stopPropagation:vi.fn(),dataTransfer:{files:[new File(['image'],'proof.png',{type:'image/png'})]}};zone.props.onDrop(event);expect(event.preventDefault).toHaveBeenCalled();expect(event.stopPropagation).toHaveBeenCalled();expect(h.writes[1].length).toBe(1);
})
it('缺写手时先展开行，再定位折叠区字段',()=>{
 h.values=['',[],[{...row,writerId:null}],'','','',[],false,false,false];const tree=IntakeFlow({});const query=vi.fn().mockReturnValue(null);h.refs[2].current={querySelector:query};const button=els(tree).find(e=>e.type==='button'&&String(e.props.children).includes('确认入库'));button.props.onClick();expect(query).toHaveBeenCalledWith('[data-cell="0-writer"]');expect(h.writes[2]).toHaveLength(1);expect(h.writes[2][0]([{...row,writerId:null}])[0].open).toBe(true)
})
it('部分截图上传失败和交付失败重试，都复用成功的附件',async()=>{
 const s=await import('@/client/store');vi.mocked(s.uploadDeliveryShot).mockResolvedValueOnce('f1').mockResolvedValueOnce(null).mockResolvedValueOnce('f2');vi.mocked(s.markDraft).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
 h.values=[true,[{file:new File(['1'],'1.png',{type:'image/png'}),url:'blob:1'},{file:new File(['2'],'2.png',{type:'image/png'}),url:'blob:2'}],false,false,false];const tree=DeliverButton({kind:'draft',orderId:'o'});const button=els(tree).find(e=>e.type==='button'&&e.props.children==='确认已交');
 button.props.onClick();await vi.waitFor(()=>expect(h.writes[2]).toHaveLength(2));expect(s.markDraft).not.toHaveBeenCalled();button.props.onClick();await vi.waitFor(()=>expect(h.writes[2]).toHaveLength(4));expect(s.markDraft).toHaveBeenCalledWith('o',['f1','f2']);expect(h.writes[0]).toEqual([]);button.props.onClick();await vi.waitFor(()=>expect(h.writes[2]).toHaveLength(6));expect(s.uploadDeliveryShot).toHaveBeenCalledTimes(3);expect(s.markDraft).toHaveBeenCalledTimes(2);expect(h.writes[0]).toEqual([false])
})

it('AI 录单使用填写的全款金额；留空的订单不产生收款', async () => {
 h.values=['',[],[{...row,paidAmount:'1000',paymentTag:'全款'},{...row,key:'empty',paidAmount:''}],'','','',[],false,false,false]
 vi.stubGlobal('document',{querySelector:()=>null}); vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({orders:[{id:'full',no:'N1'},{id:'empty',no:'N2'}]})));vi.mocked(addPayment).mockResolvedValue(true)
 const closed=vi.fn(), tree=IntakeFlow({onClose:closed});els(tree).find(e=>e.type==='button'&&String(e.props.children).includes('确认入库')).props.onClick()
 await vi.waitFor(()=>expect(closed).toHaveBeenCalledOnce());expect(addPayment).toHaveBeenCalledOnce();expect(addPayment).toHaveBeenCalledWith('full',expect.objectContaining({amount:1000,tag:'全款'}))
})
it('AI 已付金额无效时先定位该行，不创建订单', () => {
 h.values=['',[],[{...row,paidAmount:'-20'}],'','','',[],false,false,false]
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const tree=IntakeFlow({}), query=vi.fn().mockReturnValue(null);h.refs[2].current={querySelector:query}
 els(tree).find(e=>e.type==='button'&&String(e.props.children).includes('确认入库')).props.onClick();expect(query).toHaveBeenCalledWith('[data-cell="0-paid"]');expect(fetcher).not.toHaveBeenCalled()
})
