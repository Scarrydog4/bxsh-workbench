import type { Channel, Role } from './types'

/** 渠道库按归属隔离；订单行范围不扩大渠道的使用、导出或管理范围。 */
export function channelAccessible(channel: Pick<Channel, 'ownerId'>, user: { id: string }, role: Role) {
  return role.locked || channel.ownerId === user.id
}

export type ChannelLabel = Pick<Channel, 'id' | 'name' | 'avatar'>

/** 仅保留可见订单上的渠道名称和头像，不加入渠道库或录单选项。 */
export function orderChannelLabels(channels: Channel[], orders: { channelId: string }[]): ChannelLabel[] {
  const ids = new Set(orders.map(o => o.channelId))
  return channels.filter(ch => ids.has(ch.id)).map(({ id, name, avatar }) => ({ id, name, avatar }))
}
