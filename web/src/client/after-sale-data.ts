import {useCallback,useEffect,useState} from 'react'
import type {AfterSaleTask} from '@/shared/aftersale-task'
import {pendingAfterSaleTasks,useSession} from './store'
const inflight=new Map<string,Promise<{tasks:AfterSaleTask[]}>>()
function request(url:string,actor:string) {
 const key=actor+url
 if(inflight.has(key))return inflight.get(key)!
 const work=fetch(url).then(async r=>{if(!r.ok)throw new Error('跟进加载失败');return r.json()}).finally(()=>inflight.delete(key))
 inflight.set(key,work);return work
}
export function useAfterSaleTasks(){
 const{me,role}=useSession(),scope=me.id+JSON.stringify(role)
 const[revision,setRevision]=useState(0),reload=useCallback(()=>setRevision(value=>value+1),[])
 const[tasks,setTasks]=useState<AfterSaleTask[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{
  let active=true,queue=Promise.resolve();setTasks([]);setLoading(true)
  const load=(event?:Event)=>{
   const ids=(event as CustomEvent<{orderIds?:string[]}>|undefined)?.detail?.orderIds
   queue=queue.then(async()=>{try{const data=await request('/api/aftersales'+(ids?.length?'?orders='+ids.map(encodeURIComponent).join(','):''),scope);if(active){setTasks(old=>ids?[...old.filter(a=>!ids.includes(a.orderId)),...data.tasks]:data.tasks);setError('')}}catch(e){if(active)setError((e as Error).message)}finally{if(active)setLoading(false)}})
  }
  load();window.addEventListener('bxsh:changed',load)
  return()=>{active=false;window.removeEventListener('bxsh:changed',load)}
 },[scope,revision])
 return{tasks:pendingAfterSaleTasks(tasks),error,loading,reload}
}
export function useTaskClock(){const[now,setNow]=useState(Date.now);useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);return now}
