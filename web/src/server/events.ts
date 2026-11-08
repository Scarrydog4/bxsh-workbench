import { EventEmitter } from 'node:events'
export interface ChangeEvent {kind:string;at:number;version:number;orderIds?:string[];resource?:{type:'post'|'dm';id:string};userId?:string}
const g=globalThis as unknown as {__bxshBus?:EventEmitter;__bxshVersion?:number}
export const bus=g.__bxshBus??new EventEmitter()
bus.setMaxListeners(200);g.__bxshBus=bus
export const dataVersion=()=>g.__bxshVersion??(g.__bxshVersion=Date.now())
export function broadcast(kind='changed',orderIds?:string[],resource?:ChangeEvent['resource'],userId?:string) {
  g.__bxshVersion=Math.max(Date.now(),dataVersion()+1)
  const event:ChangeEvent={kind,at:Date.now(),version:g.__bxshVersion,...(orderIds?{orderIds:[...new Set(orderIds)]}:{}),...(resource?{resource}:{}),...(userId?{userId}:{})}
  bus.emit('event',event)
  return event.version
}
