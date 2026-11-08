import type { AfterSale } from './types'
export type AfterSaleTask = Omit<AfterSale,'extra'> & { extra?:number; orderId:string; no:string; title:string; channelId:string; ownerId:string }
export type AfterSaleEvent = { id:string; at:string; actorId:string; action:string; detail:string }
