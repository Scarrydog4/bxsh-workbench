import { afterAll, beforeAll, expect, it } from 'vitest'
import sharp from 'sharp'
import JSZip from 'jszip'
import { GET as getArchive } from '@/app/api/materials/[id]/gallery/route'
import { POST as publish, PUT as updateMaterial, GET as library } from '@/app/api/materials/route'
import { POST as category } from '@/app/api/materials/categories/route'
import { GET as download } from '@/app/api/materials/[id]/file/route'
import { PATCH as favorite } from '@/app/api/materials/[id]/route'
import { GET as cover } from '@/app/api/materials/[id]/image/route'
import { GET as list, POST as create } from '@/app/api/reviews/route'
import { POST as transition } from '@/app/api/reviews/[id]/route'
import { GET as screenshot } from '@/app/api/reviews/[id]/image/route'
import { sql } from '@/server/db'
import { as, resetDb, closeDb, type Client } from './helpers'

let boss: Client, sales: Client, writer: Client, other: Client
let image: string, orderId: string
const id = crypto.randomUUID()
const req = (client: Client, body?: unknown, suffix = '') => new Request('http://test.local/test'+suffix, {
  method: body ? 'POST' : 'GET', headers: { cookie: client.cookie, 'content-type': 'application/json' }, ...(body ? {body:JSON.stringify(body)} : {}),
})
const params = {params:Promise.resolve({id})}
beforeAll(async () => {
  await resetDb()
  await sql`insert into users (id, name, account, role_id, can_write, password_hash, must_change_password) select 'u-other','其他写手','other','r-writer',true,password_hash,false from users where id='u-xiao'`
  boss = await as('boss'); sales = await as('acheng'); writer = await as('xiaosenkai'); other = await as('other')
  const ch = await boss.act('channel.create', {name:'隔离测试渠道',ownerId:'u-acheng'})
  const order = await boss.act('order.create', {title:'案例复盘测试订单',orderDate:'2026-11-05',dueDate:null,ownerId:'u-acheng',channelId:ch.body.id,basePrice:100,assignees:[{userId:'u-xiao',pay:10},{userId:'u-other',pay:10}],type:'',note:''})
  expect(order.status, JSON.stringify(order.body)).toBe(200)
  orderId = order.body.id
  image = 'data:image/png;base64,'+(await sharp({create:{width:32,height:48,channels:3,background:'#bac'}}).png().toBuffer()).toString('base64')
})
afterAll(closeDb)
it('复盘可只写文字，之后的回复图片仍可按权限查看', async () => {
  const id = crypto.randomUUID(), ctx = {params:Promise.resolve({id})}
  const entry = {id,orderId,writerId:'u-xiao',title:'文字复盘',issue:'请核对交付清单'}
  expect((await create(req(boss,{...entry,issue:'  '}),ctx)).status).toBe(400)
  expect((await create(req(boss,entry),ctx)).status).toBe(200)
  const record = (await (await list(req(writer),ctx)).json()).find((r:{id:string}) => r.id === id)
  expect(record).toMatchObject({image:null,images:[],issue:entry.issue})
  expect((await screenshot(req(writer),ctx)).status).toBe(404)
  expect((await transition(req(writer,{action:'reply',reply:'',images:[image],version:0}),ctx)).status).toBe(200)
  const updated = (await (await list(req(writer),ctx)).json()).find((r:{id:string}) => r.id === id)
  const suffix = '?v='+updated.history[0].images[0]
  expect((await screenshot(req(writer,undefined,suffix),ctx)).status).toBe(200)
  expect((await screenshot(req(other,undefined,suffix),ctx)).status).toBe(404)
  await sql`delete from quality_reviews where id=${id}`
})
it('发起复盘支持五张有序图片；超过五张被拒绝，原有单图仍兼容', async () => {
  const id = crypto.randomUUID(), ctx = {params:Promise.resolve({id})}
  const images = await Promise.all(['red','green','blue','yellow','white'].map(async background => 'data:image/png;base64,'+(await sharp({create:{width:12,height:12,channels:3,background}}).png().toBuffer()).toString('base64')))
  const entry = {id,orderId,writerId:'u-xiao',title:'多图复盘',issue:'',images}
  expect((await create(req(boss,{...entry,images:[...images,image]}),ctx)).status).toBe(400)
  expect((await create(req(boss,entry),ctx)).status).toBe(200)
  const record = (await (await list(req(writer),ctx)).json()).find((r:{id:string}) => r.id === id)
  expect(record.images).toHaveLength(5)
  for (const src of record.images) {
    expect((await screenshot(req(writer,undefined,new URL(src,'http://test.local').search),ctx)).status).toBe(200)
    expect((await screenshot(req(other,undefined,new URL(src,'http://test.local').search),ctx)).status).toBe(404)
  }
  expect((await screenshot(req(writer,undefined,'?v='+'0'.repeat(64)),ctx)).status).toBe(404)
  await sql`delete from quality_reviews where id=${id}`
})
it('销售可以收藏、下载案例，不能发布，收藏按账号隔离', async () => {
  const entry = {id:'material-qa',kind:'case',title:'测试案例',major:'计算机',category:'系统开发',content:'案例介绍',image}
  expect((await category(req(boss,{action:'add',name:entry.category}),params)).status).toBe(200)
  expect((await publish(req(sales,entry),params)).status).toBe(403)
  expect((await publish(req(boss,entry),params)).status).toBe(200)
  const ctx = {params:Promise.resolve({id:entry.id})}
  expect((await favorite(req(sales,{favorite:true}),ctx)).status).toBe(200)
  for (const [actor, starred] of [[sales,true],[writer,false]] as const) {
    expect(await (await library(req(actor),params)).json()).toEqual([expect.objectContaining({favorite:starred})])
  }
  const png = await cover(req(sales,undefined,'?download=1'),ctx)
  expect(await sharp(Buffer.from(await png.arrayBuffer())).metadata()).toMatchObject({format:'png',width:32,height:48})
})
it('自定义分类、单附件和简化发布一起保存；移除分类仍能取回原文件', async () => {
  const name = '演示文件'
  expect((await category(req(sales,{action:'add',name}),params)).status).toBe(403)
  expect((await category(req(boss,{action:'add',name}),params)).status).toBe(200)
  const form = new FormData()
  Object.entries({id:'minimal-case',kind:'case',content:'案例介绍首行\n详情',category:name,image}).forEach(([key,value]) => form.set(key,value))
  form.set('file',new Blob(['example data']),'对应文件.txt')
  const make = () => new Request('http://test.local/api/materials',{method:'POST',headers:{cookie:boss.cookie,origin:'http://test.local'},body:form})
  expect((await publish(make(),params)).status).toBe(200)
  const ctx = {params:Promise.resolve({id:'minimal-case'})}
  expect(await (await download(req(sales),ctx)).text()).toBe('example data')
  expect((await download(new Request('http://test.local'),ctx)).status).toBe(401)
  expect((await category(req(boss,{action:'rename',name,next:'新版分类'}),params)).status).toBe(200)
  const rows = async () => (await (await library(req(sales),params)).json()).find((x:{id:string})=>x.id==='minimal-case')
  expect(await rows()).toMatchObject({title:'案例介绍首行',fileName:'对应文件.txt',category:'新版分类'})
  expect((await category(req(boss,{action:'remove',name:'新版分类'}),params)).status).toBe(200)
  expect(await rows()).toMatchObject({category:'未分类'})
  expect(await (await download(req(sales),ctx)).text()).toBe('example data')
  form.set('category','未分类'); form.set('id','multiple-files'); form.append('file',new Blob(['second']),'2.mod')
  expect((await publish(make(),params)).status).toBe(200)
  const multiple = await download(req(sales),{params:Promise.resolve({id:'multiple-files'})})
  const zip = await JSZip.loadAsync(await multiple.arrayBuffer())
  expect(await zip.file('对应文件.txt')!.async('text')).toBe('example data')
  expect(await zip.file('2.mod')!.async('text')).toBe('second')
})
it('工程附件保留多层目录、任意文件类型、空文件和不同目录下的同名文件', async () => {
  const id='abb-project', ctx={params:Promise.resolve({id})}, form=new FormData()
  form.set('id',id);form.set('kind','case');form.set('content','ABB 流水线');form.set('image',image)
  const files = [
    ['机器人流水线/主站.rsproj','station'], ['机器人流水线/控制器/RAPID/Main.mod','program'],
    ['机器人流水线/工位二/RAPID/Main.mod','another program'], ['机器人流水线/配置/.flag',''],
  ]
  for(const [path,text] of files) {form.append('filePath',path);form.append('file',new Blob([text]),path.split('/').pop()!)}
  const make=()=>new Request('http://test.local/api/materials',{method:'POST',headers:{cookie:boss.cookie,origin:'http://test.local'},body:form})
  const result=await publish(make(),params)
  expect(result.status,await result.text()).toBe(200)
  const response=await download(req(writer),ctx)
  const zip=await JSZip.loadAsync(await response.arrayBuffer())
  expect(Object.keys(zip.files).sort()).toEqual(files.map(f=>f[0]).sort())
  for(const [path,text] of files)expect(await zip.file(path)!.async('text')).toBe(text)
  form.set('id','bad-path');form.append('filePath','../outside');form.append('file',new Blob(['bad']),'outside')
  expect((await publish(make(),params)).status).toBe(400)
})
it('图片组保留顺序，旧单图可追加；移除的图和别单的图片不能按地址取回', async () => {
  const ctx = {params:Promise.resolve({id:'material-qa'})}
  const cases = async () => (await (await library(req(sales),params)).json()).find((x:{id:string}) => x.id==='material-qa')
  const old = await cases()
  expect(old.images).toEqual([old.image])
  const green = await sharp({create:{width:17,height:12,channels:3,background:'green'}}).png().toBuffer()
  const form = new FormData()
  Object.entries({id:old.id,kind:'case',category:old.category,content:old.content}).forEach(([key,value])=>form.set(key,value))
  form.append('pictures','data:image/png;base64,'+green.toString('base64'))
  form.append('pictures',old.image)
  const make = () => new Request('http://test.local/api/materials',{method:'PUT',headers:{cookie:boss.cookie,origin:'http://test.local'},body:form})
  expect((await updateMaterial(make(),ctx)).status).toBe(200)
  const group = await cases()
  expect(group.images).toEqual([group.image, old.image])
  const greenQuery = new URL(group.image,'http://test.local').search
  const saved = await cover(req(sales,undefined,greenQuery+'&download=1'),ctx)
  expect(await sharp(Buffer.from(await saved.arrayBuffer())).metadata()).toMatchObject({width:17,height:12})
  form.delete('pictures'); form.append('pictures',old.image)
  expect((await updateMaterial(make(),ctx)).status).toBe(200)
  expect((await cover(req(sales,undefined,greenQuery),ctx)).status).toBe(404)
  form.append('pictures',group.image)
  expect((await updateMaterial(make(),ctx)).status).toBe(400)
  expect((await cases()).images).toEqual([old.image])
})
it('长图按原文件上传，预览、单张下载和有序 ZIP 均保留文件字节', async () => {
  const id = 'original-gallery', ctx = {params:Promise.resolve({id})}
  const tall = await sharp({create:{width:200,height:6000,channels:3,background:'red'}}).png().toBuffer()
  const jpg = await sharp({create:{width:400,height:30,channels:3,background:'blue'}}).jpeg().toBuffer()
  const form = new FormData()
  form.set('id',id); form.set('kind','case'); form.set('content','长截图详情')
  form.append('pictures',new Blob([new Uint8Array(tall)]),'聊天长图.png')
  form.append('pictures',new Blob([new Uint8Array(jpg)]),'第二张.jpg')
  const resp = await publish(new Request('http://test.local/api/materials',{method:'POST',headers:{cookie:boss.cookie,origin:'http://test.local'},body:form}),ctx)
  expect(resp.status).toBe(200)
  const record = (await (await library(req(sales),params)).json()).find((x:{id:string})=>x.id===id)
  const q = new URL(record.images[0],'http://test.local').search
  for (const extra of ['','&download=1']) {
    const result = await cover(req(sales,undefined,q+extra),ctx)
    expect(Buffer.from(await result.arrayBuffer())).toEqual(tall)
  }
  const thumb = await cover(req(sales,undefined,q+'&thumb=1'),ctx)
  expect(await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).toMatchObject({height:1200,format:'webp'})
  expect((await getArchive(new Request('http://test.local'),ctx)).status).toBe(401)
  const zipResponse = await getArchive(req(sales),ctx)
  expect(zipResponse.status).toBe(200)
  const archive = await JSZip.loadAsync(await zipResponse.arrayBuffer())
  expect(Object.keys(archive.files)).toEqual(['01.png','02.jpg'])
  expect(await archive.file('01.png')!.async('nodebuffer')).toEqual(tall)
  expect(await archive.file('02.jpg')!.async('nodebuffer')).toEqual(jpg)
})
it('同单其他写手不能看复盘或截图，重复提交只生效一次', async () => {
  const entry = {id,orderId,writerId:'u-xiao',title:'漏发脚本',issue:'需要说明原因',image}
  expect((await create(req(boss,{...entry,writerId:'u-boss'}),params)).status).toBe(400)
  expect((await create(req(sales,entry),params)).status).toBe(403)
  expect((await create(req(boss,entry),params)).status).toBe(200)
  expect((await list(req(sales),params)).status).toBe(403)
  expect(await (await list(req(other),params)).json()).toEqual([])
  expect((await screenshot(req(other),params)).status).toBe(404)
  expect((await screenshot(req(sales),params)).status).toBe(403)
  expect((await screenshot(req(writer),params)).status).toBe(200)
  expect(await (await list(req(writer,undefined,'?count'),params)).json()).toBe(1)
  const reply = {action:'reply',reply:'核对清单后补发'}
  expect((await transition(req(other, reply),params)).status).toBe(404)
  expect((await transition(req(writer,{action:'reply',reply:'   '}),params)).status).toBe(400)
  expect((await transition(req(boss,{action:'confirm'}),params)).status).toBe(409)
  const responses = await Promise.all([transition(req(writer,reply),params),transition(req(writer,reply),params)])
  expect(responses.map(r=>r.status).sort()).toEqual([200,409])
  expect(await (await list(req(writer,undefined,'?count'),params)).json()).toBe(0)
  expect(await (await list(req(boss,undefined,'?count'),params)).json()).toBe(1)
  expect((await transition(req(writer,{action:'confirm'}),params)).status).toBe(403)
  const ask = {action:'supplement',note:'请说明如何补发',version:1}
  expect((await transition(req(writer,ask),params)).status).toBe(403)
  expect((await transition(req(boss,{...ask,note:' '}),params)).status).toBe(400)
  expect((await transition(req(boss,ask),params)).status).toBe(200)
  expect(await (await list(req(writer,undefined,'?count'),params)).json()).toBe(1)
  expect((await transition(req(writer,{...reply,version:0}),params)).status).toBe(409)
  expect((await transition(req(writer,{action:'reply',reply:'已重新上传并逐项核对',version:2}),params)).status).toBe(200)
  expect((await transition(req(boss,ask),params)).status).toBe(409)
  expect((await transition(req(boss,{action:'confirm',version:1}),params)).status).toBe(409)
  expect((await transition(req(boss,{action:'confirm',version:3}),params)).status).toBe(200)
  const [record] = await (await list(req(writer),params)).json()
  expect(record.status).toBe('done')
  expect(record.history.map((m:{type:string;text:string})=>[m.type,m.text])).toEqual([
    ['reply',reply.reply],['supplement',ask.note],['reply','已重新上传并逐项核对'],
  ])
})
