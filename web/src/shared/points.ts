export interface ToolPrice { points: number }
export interface PointsAccount { userId: string; name: string; account: string; active: boolean; balance: number; reserved: number; available: number }
export interface PointsEntry { id: string; kind: string; delta: number; reservedDelta: number; note: string; at: string; actorName: string }
export interface PointsView {
  balance: number; reserved: number; available: number; price: ToolPrice | null; manage: boolean
  entries: PointsEntry[]; accounts?: PointsAccount[]
}
