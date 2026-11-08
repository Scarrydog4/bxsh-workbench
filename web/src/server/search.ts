import { and, sql, type SQLWrapper } from 'drizzle-orm'
import { searchTerms } from '@/shared/search'

/** SQL 使用同样的字符顺序匹配，保留调用方的权限、分页和业务条件。 */
export function fuzzySearchSql(query: string, fields: SQLWrapper[]) {
  const text = sql`normalize(concat_ws(' ', ${sql.join(fields, sql`, `)}), NFKC)`
  const escape = (value: string) => value.replace(/[\\%_]/g, '\\$&')
  return and(...searchTerms(query).map(term => {
    const value = term.literal ? escape(term.value) : [...term.value].map(escape).join('%')
    return sql`${text} ILIKE ${'%' + value + '%'}`
  }))
}
