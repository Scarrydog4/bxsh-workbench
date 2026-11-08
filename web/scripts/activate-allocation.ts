/** 已录入的 10月16日起订单切换制度；默认只预览，不改已发流水。 */
import postgres from 'postgres'
import { ALLOCATION_START, fixedAllocation } from '../src/shared/allocation'

if (!process.env.DATABASE_URL) throw new Error('需要指定 DATABASE_URL')
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const apply = process.argv.includes('--apply')
const expected = Number(process.argv.find(a => a.startsWith('--expect-count='))?.split('=')[1])
try {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(20261007)`
    const rows = await tx`select o.id,o.no,o.sales_mode,o.base_price,
      coalesce((select sum(amount) from adjustments where order_id=o.id and revoked_at is null),0) as adjustment
      from orders o where o.order_date >= ${ALLOCATION_START} and o.allocation_policy='legacy' and o.deleted_at is null order by o.no`
    if (apply && (!Number.isInteger(expected) || expected !== rows.length)) throw new Error(`需核对本次订单数量：实际 ${rows.length}，参数 ${expected}`)
    for (const o of rows) {
      const writers = await tx`select id,user_id,pay from order_writers where order_id=${o.id} order by sort,id`
      if (o.sales_mode !== 'cost') {
        const [busy] = await tx`select exists(select 1 from settlements where order_id=${o.id} and status in ('草稿','已确认') and amount>0) or exists(select 1 from after_sales where order_id=${o.id} and extra<>0) as blocked`
        if (busy.blocked) throw new Error(`${o.no} 已有发放、草稿或追加工资，不能自动切制度`)
        if (writers.length > 1) throw new Error(`${o.no} 有多位写手，需先确认内部份额`)
      }
      const pool = fixedAllocation(Number(o.base_price) + Number(o.adjustment)).writer
      console.log(JSON.stringify({no:o.no,policy:'fixed_60_20_20_v1',mode:o.sales_mode,writers:writers.map(w => ({userId:w.user_id,from:w.pay,to:o.sales_mode==='cost'?w.pay:pool})),apply}))
      if (!apply) continue
      await tx`update orders set allocation_policy='fixed_60_20_20_v1',commission_rate=case when sales_mode='cost' then commission_rate else 0.2 end,updated_at=now() where id=${o.id}`
      await tx`insert into audit(actor_id,action,object_type,object_id,object_label,field,from_value,to_value,field_group,note) values('u-boss','修改','order',${o.id},${o.no},'分成制度','原约定',${o.sales_mode==='cost'?'底价约定':'老板60% / 销售20% / 写手20%'},'sales','按老板确认，2026年10月16日起启用；已发记录不变')`
      if (o.sales_mode !== 'cost') for (const w of writers) {
        await tx`update order_writers set pay=${pool} where id=${w.id}`
        await tx`insert into audit(actor_id,action,object_type,object_id,object_label,field,from_value,to_value,field_group,note) values('u-boss','修改','order',${o.id},${o.no},'写手工资',${w.pay===null?'未定':String(w.pay)},${String(pool)},'writerPay','新制度按订单总额20%计工资，实际发放流水不变')`
      }
    }
    console.log(JSON.stringify({count:rows.length,applied:apply}))
  })
} finally { await sql.end() }
