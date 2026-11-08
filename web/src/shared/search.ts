/** 搜索框共用规则：全半角、大小写和分隔符归一化，多个词可跨字段匹配。 */
export function searchTerms(query: string) {
  return query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean).map(raw => {
    const value = raw.replace(/[\p{P}\p{S}]+/gu, '')
    const numeric = /^[+-]\d+(?:\.\d+)?$/.test(raw)
    return { value: numeric ? raw : value || raw, literal: numeric || !value }
  })
}

function isSubsequence(text: string, term: string) {
  let offset = 0
  for (const character of term) {
    offset = text.indexOf(character, offset)
    if (offset === -1) return false
    offset++
  }
  return true
}

export function compileSearch(query: string) {
  const terms = searchTerms(query)
  return (value: unknown): boolean => {
    if (!terms.length) return true
    const text = (Array.isArray(value) ? value.join(' ') : String(value ?? '')).normalize('NFKC').toLocaleLowerCase()
    const compact = text.replace(/[\s\p{P}\p{S}]+/gu, '')
    return terms.every(term => term.literal ? text.includes(term.value) : isSubsequence(compact, term.value))
  }
}

const matchers = new Map<string, ReturnType<typeof compileSearch>>()
export function fuzzyMatch(value: unknown, query: string) {
  let match = matchers.get(query)
  if (!match) {
    match = compileSearch(query)
    if (matchers.size >= 100) matchers.delete(matchers.keys().next().value!)
    matchers.set(query, match)
  }
  return match(value)
}
