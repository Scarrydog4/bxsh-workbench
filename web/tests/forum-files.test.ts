import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { as, closeDb, resetDb } from './helpers'
import { db } from '@/server/db'
import * as t from '@/server/schema'
import { getCtx } from '@/server/session'
import { POST as init } from '@/app/api/forum/uploads/route'
import { GET as progress, PUT as put } from '@/app/api/forum/uploads/[id]/route'
import { POST as complete } from '@/app/api/forum/uploads/[id]/complete/route'
import { GET as download, HEAD as head } from '@/app/api/forum/files/[id]/route'
import { GET as orderDownload } from '@/app/api/files/[id]/route'
import { bindForumAttachments, cleanupRetractedDmAttachments, forumAttachmentViews, retractDmAttachments } from '@/server/forum-files'
import { byteRange, downloadType, fileResponse } from '@/server/range-response'

const base='http://test.local'
const p=(id:string)=>({params:Promise.resolve({id})})
let boss:Awaited<ReturnType<typeof as>>, xiao:typeof boss, acheng:typeof boss, yang:typeof boss
const request=(url:string,client:typeof boss,method='GET',body?:unknown,headers:Record<string,string>={})=>new Request(`${base}${url}`,{method,headers:{cookie:client.cookie,...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)})
const ctx=async(client:typeof boss)=>(await getCtx(request('/',client)))!

async function upload(client:typeof boss,name:string,bytes:Buffer,mime='application/octet-stream',version?:string) {
  const res=await init(request('/api/forum/uploads',client,'POST',{requestId:randomUUID(),name,size:bytes.length,mime,version}),{params:Promise.resolve({})})
  expect(res.status).toBe(200)
  const item=await res.json()
  const pr=await put(new Request(`${base}/api/forum/uploads/${item.id}?offset=0`,{method:'PUT',headers:{cookie:client.cookie},body:new Uint8Array(bytes)}),p(item.id))
  expect(pr.status).toBe(200)
  const finished=await complete(request(`/api/forum/uploads/${item.id}/complete`,client,'POST',{requestId:randomUUID()}),p(item.id))
  expect(finished.status).toBe(200)
  return {uploadId:item.id,...await finished.json()}
}

beforeAll(async()=>{
  await resetDb()
  boss=await as('boss');xiao=await as('xiaosenkai');acheng=await as('acheng');yang=await as('xiaoyang')
})
afterAll(closeDb)

describe('forum attachments and Range',()=>{
  it('bounds 500 MB, deduplicates upload init, resumes offsets and denies other uploaders',async()=>{
    const requestId=randomUUID(),input={requestId,name:'resume.zip',size:6,mime:'application/zip'}
    const call=(value:unknown,client=xiao)=>init(request('/api/forum/uploads',client,'POST',value),{params:Promise.resolve({})})
    expect((await call({...input,requestId:randomUUID(),size:500*1024*1024+1})).status).toBe(413)
    const first=await(await call(input)).json(),again=await(await call(input)).json()
    expect(again.id).toBe(first.id)
    expect((await call({...input,name:'other.zip'})).status).toBe(409)
    const write=(offset:number,text:string,client=xiao)=>put(new Request(`${base}/api/forum/uploads/${first.id}?offset=${offset}`,{method:'PUT',headers:{cookie:client.cookie},body:text}),p(first.id))
    expect((await write(0,'abc')).status).toBe(200)
    expect((await write(0,'DEF')).status).toBe(409)
    expect((await progress(request(`/api/forum/uploads/${first.id}`,acheng),p(first.id))).status).toBe(404)
    expect((await write(3,'DEF',acheng)).status).toBe(404)
    expect((await(await progress(request(`/api/forum/uploads/${first.id}`,xiao),p(first.id))).json()).received).toBe(3)
    expect((await write(3,'DEF')).status).toBe(200)
    const completionId=randomUUID(),done=await complete(request(`/api/forum/uploads/${first.id}/complete`,xiao,'POST',{requestId:completionId}),p(first.id))
    const f=await done.json()
    const repeated=await complete(request(`/api/forum/uploads/${first.id}/complete`,xiao,'POST',{requestId:completionId}),p(first.id))
    expect((await repeated.json()).id).toBe(f.id)
    expect(await(await download(request(`/api/forum/files/${f.id}`,xiao),p(f.id))).text()).toBe('abcDEF')
    expect((await download(request(`/api/forum/files/${f.id}`,acheng),p(f.id))).status).toBe(404)
  })

  it('converts pasted PNG to webp+thumbnail and keeps private post/reply files private on every request',async()=>{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQLYr6D8IMMAYAPkYHgS+ItD8AAAAASUVORK5CYII=','base64')
    const f=await upload(xiao,'截图.png',png,'image/png','v1')
    expect(f.mime).toBe('image/webp');expect(f.thumbnailUrl).toContain('thumb=1')
    await db.insert(t.forumPosts).values({id:'private-files',no:'F-PRIVATE',category:'feedback',authorId:'u-xiao',title:'private',private:true})
    await db.insert(t.forumReplies).values({id:'private-reply',postId:'private-files',authorId:'u-xiao',body:'reply'})
    await db.transaction(async tx=>bindForumAttachments(tx,await ctx(xiao),[f.id],{kind:'reply',id:'private-reply'}))
    const own=await download(request(`/api/forum/files/${f.id}?inline=1`,xiao),p(f.id))
    expect(own.status).toBe(200);expect(own.headers.get('content-type')).toBe('image/webp')
    const body=Buffer.from(await own.arrayBuffer());expect(body.subarray(0,4).toString()).toBe('RIFF')
    expect((await download(request(`/api/forum/files/${f.id}?thumb=1`,boss),p(f.id))).status).toBe(200)
    const denied=await download(request(`/api/forum/files/${f.id}?inline=1`,acheng,'GET',undefined,{'range':'bytes=0-3','if-none-match':own.headers.get('etag')!}),p(f.id))
    expect(denied.status).toBe(404);expect(await denied.text()).not.toContain('RIFF')
    expect((await forumAttachmentViews(db,'reply','private-reply'))[0]).toMatchObject({id:f.id,latest:false,version:'v1'})
  })

  it('prevents stealing a pending file or binding an already attached file to another post',async()=>{
    const f=await upload(xiao,'own.txt',Buffer.from('own'),'text/plain')
    await db.insert(t.forumPosts).values([{id:'own-a',no:'F-OWN-A',category:'document',authorId:'u-xiao',title:'one'},{id:'own-b',no:'F-OWN-B',category:'document',authorId:'u-xiao',title:'two'},{id:'other-a',no:'F-OTHER-A',category:'document',authorId:'u-acheng',title:'other'}])
    await expect(db.transaction(async tx=>bindForumAttachments(tx,await ctx(acheng),[f.id],{kind:'post',id:'other-a'}))).rejects.toMatchObject({status:404})
    await db.transaction(async tx=>bindForumAttachments(tx,await ctx(xiao),[f.id],{kind:'post',id:'own-a'}))
    await expect(db.transaction(async tx=>bindForumAttachments(tx,await ctx(xiao),[f.id],{kind:'post',id:'own-b'}))).rejects.toMatchObject({status:404})
  })

  it('streams exact ranges, suffixes, HEAD and 416 and makes HTML/SVG download-only',async()=>{
    const f=await upload(xiao,'sample.pdf',Buffer.from('0123456789'),'application/pdf')
    const range=await download(request(`/api/forum/files/${f.id}?inline=1`,xiao,'GET',undefined,{range:'bytes=2-5'}),p(f.id))
    expect(range.status).toBe(206);expect(await range.text()).toBe('2345')
    expect(range.headers.get('content-range')).toBe('bytes 2-5/10');expect(range.headers.get('accept-ranges')).toBe('bytes');expect(range.headers.get('content-length')).toBe('4')
    expect(range.headers.get('content-disposition')).toContain('inline');expect(range.headers.get('x-content-type-options')).toBe('nosniff')
    const suffix=await download(request(`/api/forum/files/${f.id}`,xiao,'GET',undefined,{range:'bytes=-3'}),p(f.id))
    expect(await suffix.text()).toBe('789')
    const invalid=await download(request(`/api/forum/files/${f.id}`,xiao,'GET',undefined,{range:'bytes=100-200'}),p(f.id))
    expect(invalid.status).toBe(416);expect(invalid.headers.get('content-range')).toBe('bytes */10');expect(await invalid.text()).toBe('')
    const header=await head(request(`/api/forum/files/${f.id}`,xiao,'HEAD',undefined,{range:'bytes=2-5'}),p(f.id))
    expect(header.status).toBe(206);expect(await header.text()).toBe('');expect(header.headers.get('content-length')).toBe('4')
    for(const [name,mime] of [['bad.html','text/html'],['bad.svg','image/svg+xml'],['bad.html','image/png']]){
      const type=downloadType(name,mime);expect(type).toEqual({mime:'application/octet-stream',inline:false})
    }
    const html=await upload(xiao,'page.html',Buffer.from('<script>alert(1)</script>'),'text/html')
    const output=await download(request(`/api/forum/files/${html.id}?inline=1`,xiao),p(html.id))
    expect(output.headers.get('content-type')).toBe('application/octet-stream');expect(output.headers.get('content-disposition')).toContain('attachment')
    expect(downloadType('readme.md','text/html')).toEqual({mime:'text/plain; charset=utf-8',inline:true})
    expect(downloadType('paper.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document').inline).toBe(false)
    expect(downloadType('paper.docx','application/pdf').inline).toBe(false)
    expect(downloadType('paper.doc','image/png').inline).toBe(false)
  })

  it('authorizes DM participants and boss, retracts after commit, and never deletes on rollback',async()=>{
    const f=await upload(xiao,'secret.zip',Buffer.from('private-dm'),'application/zip')
    await db.insert(t.dmThreads).values({id:'file-dm',participantA:'u-acheng',participantB:'u-xiao'})
    await db.insert(t.dmMessages).values({id:'file-message',threadId:'file-dm',senderId:'u-xiao',body:'hello'})
    await db.transaction(async tx=>bindForumAttachments(tx,await ctx(xiao),[f.id],{kind:'dm',id:'file-message'}))
    const [stored]=await db.select().from(t.forumAttachments).where(eq(t.forumAttachments.id,f.id))
    for(const client of [xiao,acheng,boss])expect((await download(request(`/api/forum/files/${f.id}`,client),p(f.id))).status).toBe(200)
    const denied=await download(request(`/api/forum/files/${f.id}`,yang,'GET',undefined,{range:'bytes=0-1'}),p(f.id))
    expect(denied.status).toBe(404);expect(await denied.text()).not.toContain('private-dm')
    await expect(db.transaction(async tx=>{await retractDmAttachments(tx,'file-message');throw new Error('rollback')})).rejects.toThrow('rollback')
    await cleanupRetractedDmAttachments('file-message');expect(await readFile(stored.path,'utf8')).toBe('private-dm')
    await db.transaction(async tx=>{await tx.update(t.dmMessages).set({body:'',retractedAt:new Date().toISOString()}).where(eq(t.dmMessages.id,'file-message'));await retractDmAttachments(tx,'file-message')})
    await cleanupRetractedDmAttachments('file-message');await cleanupRetractedDmAttachments('file-message')
    await expect(access(stored.path)).rejects.toMatchObject({code:'ENOENT'})
    for(const client of [xiao,acheng,boss])expect((await download(request(`/api/forum/files/${f.id}`,client),p(f.id))).status).toBe(404)
  })

  it('adds exact Range support to existing order files without widening permissions',async()=>{
    const channel=await boss.act('channel.create',{name:'Range test channel',ownerId:'u-boss'})
    const order=await boss.act('order.create',{title:'Range test',orderDate:new Date().toISOString().slice(0,10),dueDate:null,ownerId:'u-boss',basePrice:100,assignees:[{userId:'u-xiao',pay:20,rate:null}],channelId:channel.body.id})
    expect(order.status).toBe(200)
    const uploaded=await boss.upload(order.body.id,'video.mp4',Buffer.from('order012345'),undefined,'video/mp4')
    expect(uploaded.status).toBe(200)
    const f=uploaded.body.id
    const range=await orderDownload(request(`/api/files/${f}?inline=1`,xiao,'GET',undefined,{range:'bytes=5-8'}),p(f))
    expect(range.status).toBe(206);expect(await range.text()).toBe('0123')
    const denied=await orderDownload(request(`/api/files/${f}?inline=1`,yang,'GET',undefined,{range:'bytes=5-8'}),p(f))
    expect(denied.status).toBe(404)
  })
})

describe('range parsing',()=>{
  it('rejects multi-ranges, overflows and empty files',()=>{
    for(const range of ['bytes=0-1,4-5','bytes=2-1','bytes=-0','bytes=','bytes=999999999999999999999-'])expect(byteRange(range,10)).toBeNull()
    expect(byteRange('bytes=0-',0)).toBeNull();expect(byteRange('bytes=7-50',10)).toEqual({start:7,end:9})
  })
  it('reads a range from a sparse 51 MB file without loading the full file',async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),'forum-range-'))
    const target=path.join(dir,'large.pdf')
    try{
      await writeFile(target,Buffer.alloc(0))
      const {open}=await import('node:fs/promises'),f=await open(target,'r+')
      await f.write(Buffer.from('PDF-END'),0,7,51*1024*1024);await f.close()
      const res=await fileResponse(new Request(`${base}/x`,{headers:{range:'bytes=-7'}}),{path:target,name:'large.pdf',mime:'application/pdf',id:'large',inline:true})
      expect(res.status).toBe(206);expect(await res.text()).toBe('PDF-END');expect(res.headers.get('content-length')).toBe('7')
    }finally{await rm(dir,{recursive:true,force:true})}
  })
})
