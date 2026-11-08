/** 单量评级：按销售当天的单量自动换头像框。档位是用户 10-24 定的，落在边界上算高一档。 */
export type Rank = 'maggot' | 'pupa' | 'fly' | 'pest' | 'bee'

export const RANKS: { id: Rank; name: string; min: number; range: string }[] = [
  { id: 'maggot', name: '蛆', min: 0, range: '5 单以下' },
  { id: 'pupa', name: '蛹', min: 5, range: '5–10 单' },
  { id: 'fly', name: '苍蝇', min: 10, range: '10–20 单' },
  { id: 'pest', name: '害虫', min: 20, range: '20–30 单' },
  { id: 'bee', name: '蜜蜂', min: 30, range: '30 单以上' },
]

export function rankOf(count: number): Rank {
  return [...RANKS].reverse().find((r) => count >= r.min)!.id
}
