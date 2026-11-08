/** Personal decoration only: every account can choose every frame. */
export const AVATAR_FRAME_IDS = ['none', 'gold', 'jade', 'double', 'aurora', 'galaxy', 'flower', 'brush', 'crown', 'nib', 'star', 'knight', 'bow'] as const
export type AvatarFrameId = typeof AVATAR_FRAME_IDS[number]
export const AVATAR_FRAME_NAMES: Record<AvatarFrameId, string> = {
  none: '不用框', gold: '金环', jade: '玉环', double: '双金环', aurora: '玉金流光', galaxy: '星河',
  flower: '笔下生花', brush: '墨笔圈', crown: '小皇冠', nib: '笔尖', star: '星星', knight: '蓝骑士', bow: '粉蝴蝶结',
}
export function avatarFrame(value?: string | null): AvatarFrameId {
  return AVATAR_FRAME_IDS.includes(value as AvatarFrameId) ? value as AvatarFrameId : 'none'
}
