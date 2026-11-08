/** 只读核对所有业务表与迁移记录，输出行数及摘要，不输出密码或业务内容。 */
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL!, { max: 1 })
try {
  await sql`set timezone = 'UTC'`
  const tables = await sql`select schemaname, tablename from pg_tables where schemaname in ('public','drizzle') order by schemaname,tablename`
  const result = []
  for (const table of tables) {
    const identifier = [table.schemaname, table.tablename].map(x => '"' + String(x).replaceAll('"', '""') + '"').join('.')
    const [row] = await sql.unsafe(`select count(*)::int as rows, md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' order by to_jsonb(t)::text collate "C"), '')) as digest from ${identifier} t`)
    result.push({ table: `${table.schemaname}.${table.tablename}`, ...row })
  }
  console.log(JSON.stringify(result, null, 2))
} finally { await sql.end() }
