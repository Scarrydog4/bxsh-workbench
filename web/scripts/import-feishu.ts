/**
 * 飞书「订单管理」→ 工作台。可以反复执行：按飞书「系统编号」去重，已有的单更新、新的单插入。
 * 支持 JSON（抓取快照）和 Excel / CSV（飞书「导出」）。
 *
 * 用法：
 *   pnpm import ../data/import/feishu-orders-20261006.json            # 先预览，不写库
 *   pnpm import ../data/import/feishu-orders-20261006.json --apply    # 真正写入
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import * as t from '../src/server/schema'
import { randomBytes } from 'node:crypto'
import { ALLOCATION_START } from '../src/shared/allocation'

const url = process.env.DATABASE_URL ?? 'postgres://bxsh@127.0.0.1:5433/workbench'
const MIGRATE_NOTE = '飞书迁移'

// ---------- 映射规则（HANDOFF 第 9 节） ----------

/** 销售板块 → 归属销售；空 → 管理员 */
const BOARD: Record<string, string> = { 自营: 'u-boss', 阿城: 'u-acheng', 小羊老师: 'u-yang' }
/** 飞书账号名 → 系统账号（销售人员、写手两列都用） */
const PERSON: Record<string, string> = { 笔下生花教育咨询工作室: 'u-boss', 文思泉涌: 'u-acheng', 笔下生花: 'u-yang', 肖森凯: 'u-xiao' }

type Row = Record<string, unknown>

const id = (p: string) => `${p}_${randomBytes(9).toString('base64url')}`
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[¥,，\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
function day(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10) // Excel 序列号
  if (typeof v === 'number' && v > 1e11) return new Date(v).toISOString().slice(0, 10) // 飞书毫秒时间戳
  const m = String(v).match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}

// ---------- 读文件 ----------

async function readRows(file: string): Promise<Row[]> {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.json') {
    const d = JSON.parse(await readFile(file, 'utf8'))
    return d.rows.map((r: unknown[]) => Object.fromEntries(d.cols.map((c: string, i: number) => [c, r[i]])))
  }
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    const ws = wb.worksheets[0]
    const head = (ws.getRow(1).values as unknown[]).slice(1).map(str)
    const out: Row[] = []
    ws.eachRow((row, n) => {
      if (n === 1) return
      const vals = (row.values as unknown[]).slice(1)
      out.push(Object.fromEntries(head.map((h, i) => [h, cell(vals[i])])))
    })
    return out
  }
  if (ext === '.csv') {
    const text = (await readFile(file, 'utf8')).replace(/^﻿/, '')
    const rows = parseCsv(text)
    const head = rows[0].map((h) => h.trim())
    return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
  }
  throw new Error(`不认识的文件类型：${ext}（支持 .json / .xlsx / .csv）`)
}

function cell(v: unknown): unknown {
  if (v && typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((x) => x.text).join('')
    if ('result' in o) return o.result
    if (o.text !== undefined) return o.text
    if (v instanceof Date) return v
  }
  return v
}

function parseCsv(s: string) {
  const rows: string[][] = []
  let row: string[] = []
  let f = ''
  let q = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"' && s[i + 1] === '"') (f += '"'), i++
      else if (ch === '"') q = false
      else f += ch
    } else if (ch === '"') q = true
    else if (ch === ',') row.push(f), (f = '')
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(f), rows.push(row), (row = []), (f = '')
    } else f += ch
  }
  if (f || row.length) row.push(f), rows.push(row)
  return rows.filter((r) => r.some((x) => x.trim()))
}

// ---------- 主流程 ----------

async function main() {
  const file = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!file) throw new Error('用法：pnpm import <文件> [--apply]')
  const all = await readRows(path.resolve(file))
  const rows = all.filter((r) => str(r['订单名称']))
  const skipped = all.filter((r) => !str(r['订单名称'])).map((r) => str(r['系统编号']))

  const sql = postgres(url, { max: 1, onnotice: () => {} })
  const db = drizzle(sql, { schema: t })
  const users = await db.select().from(t.users)
  const has = (uid: string) => users.some((u) => u.id === uid)
  for (const need of ['u-boss', 'u-acheng', 'u-yang', 'u-xiao']) if (!has(need)) throw new Error(`缺账号 ${need}，先跑 pnpm db:accounts`)
  const rate = (uid: string) => users.find((u) => u.id === uid)?.commissionRate ?? 0.5

  // 渠道：按名字去重；默认归属取该渠道历史订单里最多的那个销售
  const chCount = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const name = str(r['渠道']) || '未填渠道'
    const owner = BOARD[str(r['销售板块'])] ?? 'u-boss'
    const m = chCount.get(name) ?? new Map()
    m.set(owner, (m.get(owner) ?? 0) + 1)
    chCount.set(name, m)
  }

  const warnings: string[] = []
  const plan = rows.map((r) => {
    const sys = str(r['系统编号'])
    const date = day(r['下单日期']) ?? (sys.length >= 8 ? `${sys.slice(0, 4)}-${sys.slice(4, 6)}-${sys.slice(6, 8)}` : null)
    if (!day(r['下单日期'])) warnings.push(`${sys} 没有下单日期，按系统编号前 8 位当日期 ${date}`)
    if (!date) throw new Error(`${sys} 没有下单日期，也推不出来`)
    const board = str(r['销售板块'])
    const ownerId = BOARD[board] ?? 'u-boss'
    if (board && !BOARD[board]) warnings.push(`${sys} 销售板块「${board}」不认识，按自营`)
    const creatorId = PERSON[str(r['销售人员'])] ?? ownerId
    const writerName = str(r['写手'])
    const writerId = PERSON[writerName]
    if (writerName && !writerId) warnings.push(`${sys} 写手「${writerName}」不认识，没有导入写手`)
    const sales = num(r['销售额']) ?? 0
    const pay = num(r['写手工资'])
    const received = num(r['已收金额']) ?? 0
    const status = str(r['订单状态']) || '未交付'
    const ws = str(r['写手结算状态'])
    const ss = str(r['销售结算状态'])
    const settledComm = num(r['已结销售提成'])
    const isSelf = ownerId === 'u-boss'
    const commission = isSelf ? 0 : Math.round((sales - (pay ?? 0)) * rate(ownerId) * 100) / 100
    const flags: string[] = []
    if (ws === '部分结算') flags.push('写手部分结算，金额待核对')
    if (ss === '部分结算' && !isSelf) flags.push('销售部分结算，金额待核对')
    const note = str(r['备注'])
    return {
      sys,
      recordId: str(r['_feishu_record_id']) || null,
      no: `DD${date.slice(2).replaceAll('-', '')}${sys.slice(-4)}`,
      serial: Number(sys.slice(-4)) || 0,
      title: str(r['订单名称']),
      date,
      ownerId,
      creatorId,
      channel: str(r['渠道']) || '未填渠道',
      type: str(r['订单类型']),
      sales,
      writerId,
      pay,
      received,
      status,
      // 飞书没有初稿日期：已发演示 / 已交付的单先按下单日期估，导入后可在详情里看到
      draftAt: status === '已发演示' || status === '已交付' ? `${date}T12:00:00+08:00` : null,
      note,
      writerSettled: ws === '已结算' && writerId && pay ? pay : 0,
      salesSettled: isSelf ? 0 : settledComm && settledComm > 0 ? settledComm : ss === '已结算' ? commission : 0,
      reviewFlag: flags.length ? `${flags.join('；')}${note ? `（备注：${note}）` : ''}` : null,
      attachment: str(r['附件']),
    }
  })

  const sumSales = plan.reduce((s, p) => s + p.sales, 0)
  const sumPay = plan.reduce((s, p) => s + (p.pay ?? 0), 0)
  console.log(`读到 ${all.length} 行，跳过空行 ${skipped.length} 行（${skipped.join('、') || '无'}），要导入 ${plan.length} 单`)
  console.log(`销售额合计 ${sumSales}，写手工资合计 ${sumPay}，渠道 ${chCount.size} 个`)
  console.log(`写手结算已结 ${plan.filter((p) => p.writerSettled).length} 单；销售提成已结 ${plan.filter((p) => p.salesSettled).length} 单；部分结算待核对 ${plan.filter((p) => p.reviewFlag).length} 单`)
  const att = plan.filter((p) => p.attachment)
  if (att.length) console.log(`有附件、需要手动补传的单：${att.map((p) => `${p.no}（${p.attachment}）`).join('；')}`)
  for (const w of warnings) console.log(`注意：${w}`)

  if (!apply) {
    console.log('\n这是预览，没有写库。确认无误后加 --apply 再跑一次。')
    await sql.end()
    return
  }

  let inserted = 0
  let updated = 0
  await db.transaction(async (tx) => {
    // 渠道
    const existing = await tx.select().from(t.channels)
    const chId = new Map(existing.map((c) => [c.name, c.id]))
    for (const [name, m] of chCount) {
      if (chId.has(name)) continue
      const owner = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const cid = id('c')
      await tx.insert(t.channels).values({ id: cid, name, ownerId: owner })
      chId.set(name, cid)
    }
    // 订单类型
    const types = [...new Set(plan.map((p) => p.type).filter(Boolean))]
    const [opt] = await tx.select().from(t.options).where(eq(t.options.key, 'types'))
    const merged = [...new Set([...(opt?.values ?? []), ...types])]
    await tx.insert(t.options).values({ key: 'types', values: merged }).onConflictDoUpdate({ target: t.options.key, set: { values: merged } })

    for (const p of plan) {
      const [old] = await tx.select().from(t.orders).where(eq(t.orders.feishuSysNo, p.sys))
      if (old?.allocationPolicy === 'fixed_60_20_20_v1') throw new Error(`${p.no} 已启用新制度，请在工作台调整，不能用旧飞书工资覆盖`)
      if (!old && p.date >= ALLOCATION_START) throw new Error(`${p.no} 属于新制度日期，请在工作台录入；此脚本仅补录旧制度历史订单`)
      const base = {
        no: p.no,
        title: p.title,
        orderDate: p.date,
        ownerId: p.ownerId,
        creatorId: p.creatorId,
        channelId: chId.get(p.channel)!,
        type: p.type,
        basePrice: p.sales,
        status: p.status,
        note: p.note,
        reviewFlag: p.reviewFlag,
        feishuRecordId: p.recordId,
        feishuSysNo: p.sys,
      }
      let oid: string
      if (old) {
        oid = old.id
        await tx
          .update(t.orders)
          .set({ ...base, draftAt: old.draftAt ?? p.draftAt, updatedAt: new Date().toISOString() })
          .where(eq(t.orders.id, oid))
        // 重导时只替换迁移生成的子记录，系统里新增的收款、结算不动
        await tx.delete(t.orderWriters).where(eq(t.orderWriters.orderId, oid))
        // 管理员撤销过的迁移收款留着当记录（不计入已收），其余按飞书重新写
        await tx.delete(t.payments).where(and(eq(t.payments.orderId, oid), eq(t.payments.note, MIGRATE_NOTE), isNull(t.payments.revokedAt)))
        await tx.delete(t.settlements).where(and(eq(t.settlements.orderId, oid), eq(t.settlements.migrated, true)))
        updated++
      } else {
        oid = id('o')
        await tx.insert(t.orders).values({ id: oid, ...base, allocationPolicy: 'legacy', wechatGroup: '', draftAt: p.draftAt, commissionRate: rate(p.ownerId) })
        inserted++
      }
      if (p.writerId) await tx.insert(t.orderWriters).values({ orderId: oid, userId: p.writerId, pay: p.pay, sort: 0 })
      if (p.received > 0)
        await tx.insert(t.payments).values({ id: id('pay'), orderId: oid, amount: p.received, date: p.date, tag: p.received >= p.sales ? '全款' : '定金', note: MIGRATE_NOTE, by: 'u-boss' })
      if (p.writerSettled)
        await tx.insert(t.settlements).values({ id: id('st'), kind: '写手工资', payeeId: p.writerId!, orderId: oid, amount: p.writerSettled, status: '已确认', note: MIGRATE_NOTE, migrated: true })
      if (p.salesSettled)
        await tx.insert(t.settlements).values({ id: id('st'), kind: '销售提成', payeeId: p.ownerId, orderId: oid, amount: p.salesSettled, status: '已确认', note: MIGRATE_NOTE, migrated: true })
    }

    // 新单的流水号从迁移数据最大值 +1 继续
    const max = Math.max(0, ...plan.map((p) => p.serial))
    const [cur] = await tx.select().from(t.counters).where(eq(t.counters.name, 'order_serial'))
    if (!cur || cur.value < max) await tx.insert(t.counters).values({ name: 'order_serial', value: max }).onConflictDoUpdate({ target: t.counters.name, set: { value: max } })

    await tx.insert(t.audit).values({ actorId: 'u-boss', action: '导入', objectType: 'order', objectLabel: `飞书迁移：新增 ${inserted} 单，更新 ${updated} 单（${path.basename(file)}）` })
  })

  // 导入后核对：库里的数和文件对得上才算成功
  const sysNos = plan.map((p) => p.sys)
  const got = await db.select().from(t.orders).where(inArray(t.orders.feishuSysNo, sysNos))
  const ids = got.map((o) => o.id)
  const ws = ids.length ? await db.select().from(t.orderWriters).where(inArray(t.orderWriters.orderId, ids)) : []
  const dbSales = got.reduce((s, o) => s + o.basePrice, 0)
  const dbPay = ws.reduce((s, w) => s + (w.pay ?? 0), 0)
  console.log(`\n已写入：新增 ${inserted}，更新 ${updated}`)
  console.log(`核对：库里 ${got.length} 单（文件 ${plan.length}），销售额 ${dbSales}（文件 ${sumSales}），写手工资 ${dbPay}（文件 ${sumPay}）`)
  const ok = got.length === plan.length && dbSales === sumSales && Math.abs(dbPay - sumPay) < 0.001
  console.log(ok ? '核对通过' : '核对不通过，请检查')
  await sql.end()
  if (!ok) process.exit(2)
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
