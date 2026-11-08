import { expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { fuzzySearchSql } from '@/server/search'
const dialect = new PgDialect()
it('数据库模糊搜索跨字段保留字符顺序，全半角一致且参数化', () => {
  const query = dialect.sqlToQuery(fuzzySearchSql('ＡＪ２６ 网安', [sql`title`, sql`body`])!)
  expect(query.sql).toContain("normalize(concat_ws(' ', title, body), NFKC)")
  expect(query.params).toEqual(['%a%j%2%6%', '%网%安%'])
  expect(query.sql).not.toContain('a%j')
})
it('通配符按字面匹配，空搜索不改变既有权限条件', () => {
  expect(dialect.sqlToQuery(fuzzySearchSql('%', [sql`title`])!).params).toEqual(['%\\%%'])
  expect(fuzzySearchSql('  ', [sql`title`])).toBeUndefined()
})
