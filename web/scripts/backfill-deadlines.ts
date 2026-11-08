/** 默认只预览；核对用户批准的数量后，带 --apply --expected=N --overdue=N 执行。 */
import postgres from 'postgres'
const url = process.env.DATABASE_URL
if (!url) throw new Error('必须指定 DATABASE_URL')
const sql = postgres(url, { max: 1 })
const apply = process.argv.includes('--apply')
const numberArg = (name: string) => Number(process.argv.find(x => x.startsWith(`--${name}=`))?.split('=')[1])
try {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(20261007)`
    const rows = await tx`select id,no,order_date::text, (order_date + 10)::text as due, deleted_at, status,
      (deleted_at is null and status not in ('已交付','退单') and order_date + 10 < (now() at time zone 'Asia/Shanghai')::date) as overdue
      from orders where due_date is null order by id for update`
    const overdue = rows.filter(r => r.overdue).length
    console.log(JSON.stringify({ missing: rows.length, live: rows.filter(r => !r.deleted_at).length, overdue, apply }))
    if (!apply) return
    if (rows.length !== numberArg('expected') || overdue !== numberArg('overdue')) throw new Error('数量已变，请重新核对，尚未写入')
    const [boss] = await tx`select u.id from users u join roles r on u.role_id=r.id where r.locked=true and u.active=true order by u.created_at limit 1`
    if (!boss) throw new Error('没有管理员账号')
    for (const row of rows) {
      await tx`update orders set due_date=${row.due}, updated_at=now() where id=${row.id} and due_date is null`
      await tx`insert into audit(actor_id,action,object_type,object_id,object_label,field,from_value,to_value) values(${boss.id},'补截止日期','order',${row.id},${row.no},'截止日期','空',${row.due})`
    }
  })
} finally { await sql.end() }
