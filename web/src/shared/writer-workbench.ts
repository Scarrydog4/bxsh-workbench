import type { AfterSaleTask } from './aftersale-task'
import { confirmationState } from './as-rules'
import { businessDate } from './format'
import type { OrderView } from './types'
import { isStagedWriterPay } from './writer-stages'

export type WriterWorkbenchStage = 'initial' | 'group' | 'followup' | 'done'

export interface WriterWorkbenchRow {
  order: OrderView
  stage: WriterWorkbenchStage
  stageLabel: string
  /** 仅本人、未撤回的跟进，进行中的在前。 */
  tasks: AfterSaleTask[]
  pendingTasks: AfterSaleTask[]
  nextTask: AfterSaleTask | null
  deadlineAt: string | null
  deadlineKind: 'initial' | 'followup' | null
  initialDone: boolean
  groupDone: boolean
  urgent: boolean
}

export interface WriterWorkbenchSummary {
  initial: number
  group: number
  followup: number
  done: number
  urgent: number
  weekInitialCompleted: number
  weekGroupDelivered: number
  weekFollowupsCompleted: number
  weekFollowupsOnTime: number
  /** 只统计被明确定性为写手返工的已完成跟进，不把正常修改当成返工。 */
  weekReworks: number
}

const STAGE_LABELS: Record<WriterWorkbenchStage, string> = {
  initial: '待完成', group: '待发群', followup: '待跟进', done: '已交付',
}

function timestamp(value?: string | null) {
  if (!value) return null
  const time = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value).getTime()
  return Number.isFinite(time) ? time : null
}

function deadline(order: OrderView) {
  if (!order.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(order.dueDate)) return null
  const value = `${order.dueDate}T23:59:59.999+08:00`
  return timestamp(value) === null ? null : value
}

function weekStart(now: number) {
  const day = businessDate(new Date(now))
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00+08:00`).getTime()
}

/**
 * 写手首页的个人视图。服务端负责权限裁剪，这里再次按本人关联关系收紧，
 * 避免兼任角色或合作订单把别人的交付进度、跟进统计带到个人工作台。
 */
export function buildWriterWorkbench(orders: OrderView[], tasks: AfterSaleTask[], writerId: string, now = Date.now()) {
  const taskDeadline = (task: AfterSaleTask) => confirmationState(task, now) === 'waiting' ? task.confirmBy : task.due
  const ownOrders = orders.filter(order => order.status !== '退单'
    && !('deletedAt' in order && order.deletedAt)
    && order.assignees.some(person => person.userId === writerId))
  const ownIds = new Set(ownOrders.map(order => order.id))
  const taskMap = new Map<string, AfterSaleTask[]>()
  // 同一跟进可在全量加载/增量更新交接时出现两次，统计与操作均按 id 唯一。
  const ownTasks = [...new Map(tasks.filter(task => task.writerId === writerId && !task.cancelledAt && ownIds.has(task.orderId)).map(task => [task.id, task])).values()]
  for (const task of ownTasks) {
    const list = taskMap.get(task.orderId) ?? []
    list.push(task)
    taskMap.set(task.orderId, list)
  }

  const rows: WriterWorkbenchRow[] = ownOrders.map(order => {
    const personal = order.writerProgress?.find(progress => progress.userId === writerId)
    // 员工视图不含 writerPayPlan，个人凭据是可见且可靠的阶段来源。
    const individualProgress = isStagedWriterPay(order) || !!order.writerProgress?.length
    // 统一交付已直接凭群发截图完成，旧成果截图缺失不否认后来真实的群内交付。
    const personalGroup = !!personal?.groupSentAt && personal.groupProofIds.length > 0
    const personalInitial = personalGroup || !!personal?.completedAt && personal.completedProofIds.length > 0
    // 旧单只记录整单交付；“已发演示”即使有 draftAt 也不能显示成最终已交付。
    const groupDone = individualProgress ? personalGroup : order.status === '已交付'
    const initialDone = individualProgress ? personalInitial : groupDone || !!order.draftAt || ['已发演示', '待发客户'].includes(order.status)
    const related = (taskMap.get(order.id) ?? []).sort((a, b) => Number(!!a.doneAt) - Number(!!b.doneAt)
      || (timestamp(taskDeadline(a)) ?? Infinity) - (timestamp(taskDeadline(b)) ?? Infinity)
      || a.id.localeCompare(b.id))
    const pendingTasks = related.filter(task => !task.doneAt)
    const nextTask = pendingTasks[0] ?? null
    const stage: WriterWorkbenchStage = nextTask ? 'followup' : !initialDone ? 'initial' : !groupDone ? 'group' : 'done'
    const initialDeadline = !initialDone && order.status !== '已发演示' ? deadline(order) : null
    const taskDue = nextTask ? taskDeadline(nextTask) : null
    const activeTaskDeadline = taskDue && timestamp(taskDue) !== null ? taskDue : null
    // 做完初稿等待发群时，旧初稿截止不再冒充新的待办期限。
    // 跟进优先展示时，排序也使用同一个跟进的回复/交付期限。
    const deadlineAt = nextTask ? activeTaskDeadline : initialDeadline
    return {
      order, stage, stageLabel: order.status === '已发演示' && !nextTask && !groupDone ? '待正式交付' : STAGE_LABELS[stage], tasks: related, pendingTasks, nextTask,
      deadlineAt, deadlineKind: deadlineAt ? nextTask ? 'followup' : 'initial' : null,
      initialDone, groupDone, urgent: stage !== 'done' && !!order.urgency,
    }
  })
  rows.sort((a, b) => Number(a.stage === 'done') - Number(b.stage === 'done')
    || Number(b.urgent) - Number(a.urgent)
    || (timestamp(a.deadlineAt) ?? Infinity) - (timestamp(b.deadlineAt) ?? Infinity)
    || a.order.orderDate.localeCompare(b.order.orderDate)
    || a.order.id.localeCompare(b.order.id))

  const from = weekStart(now)
  const inWeek = (value?: string | null) => { const time = timestamp(value); return time !== null && time >= from && time <= now }
  const summary: WriterWorkbenchSummary = {
    initial: 0, group: 0, followup: 0, done: 0, urgent: 0,
    weekInitialCompleted: 0, weekGroupDelivered: 0, weekFollowupsCompleted: 0, weekFollowupsOnTime: 0, weekReworks: 0,
  }
  for (const row of rows) {
    summary[row.stage]++
    if (row.urgent) summary.urgent++
    const personal = row.order.writerProgress?.find(progress => progress.userId === writerId)
    // 旧合作单只有整单日期时，不能据此宣称某位写手本周完成了自己的部分。
    const legacyDate = !isStagedWriterPay(row.order) && !row.order.writerProgress?.length && row.order.assignees.length === 1 ? row.order.draftAt : null
    if (row.initialDone && inWeek(personal?.completedAt ?? legacyDate)) summary.weekInitialCompleted++
    if (row.groupDone && inWeek(personal?.groupSentAt ?? legacyDate)) summary.weekGroupDelivered++
  }
  for (const task of ownTasks) {
    if (!inWeek(task.doneAt)) continue
    summary.weekFollowupsCompleted++
    const done = timestamp(task.doneAt), due = timestamp(task.due)
    const onTime = typeof task.deliveredLateMin === 'number' && Number.isFinite(task.deliveredLateMin)
      ? task.deliveredLateMin === 0 : done !== null && due !== null && done <= due
    if (onTime) summary.weekFollowupsOnTime++
    if (task.reason === '写手返工') summary.weekReworks++
  }
  const growthHints: string[] = []
  if (summary.weekGroupDelivered) growthHints.push(`本周已交付 ${summary.weekGroupDelivered} 单`)
  else if (summary.weekInitialCompleted) growthHints.push(`本周已完成 ${summary.weekInitialCompleted} 单初稿`)
  if (summary.weekFollowupsOnTime) growthHints.push(`本周按时完成 ${summary.weekFollowupsOnTime} 次跟进`)
  return { rows, summary, growthHints }
}
