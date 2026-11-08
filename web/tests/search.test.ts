import { expect, it } from 'vitest'
import { compileSearch, fuzzyMatch, searchTerms } from '@/shared/search'
import { filterTableRows } from '@/client/table-filters'

it('名称片段、尾号、全半角与跨字段关键词使用同一种匹配', () => {
  expect(fuzzyMatch(['AJ26110501 网络安全课程设计', '老板', '张老师'], '安全 110501')).toBe(true)
  expect(fuzzyMatch('ＡＪ２６１１０５０１ 网络-安全', 'aj26110501 网络安全')).toBe(true)
  expect(fuzzyMatch('机械工程开题报告', '机械报告')).toBe(true)
  expect(fuzzyMatch('goldcode', 'GCode')).toBe(true)
  expect(fuzzyMatch(['AJ26110501', '机械工程'], 'AJ 安全')).toBe(false)
})
it('空查询保留全部，纯通配符与带符号数字按字面匹配', () => {
  expect(compileSearch('   ')(null)).toBe(true)
  expect(fuzzyMatch('机械报告', '%')).toBe(false)
  expect(fuzzyMatch('进度100%', '%')).toBe(true)
  expect(fuzzyMatch('日期2026-01-01', '-1')).toBe(false)
  expect(searchTerms('%')[0].literal).toBe(true)
})
it('表格关键词跨可搜索字段，业务筛选继续取交集', () => {
  const rows=[{name:'网络安全',person:'张老师',status:'已交付'},{name:'网络安全',person:'王老师',status:'未交付'}]
  const fields=[{id:'name',label:'名称',numeric:false,date:false,value:(r:typeof rows[number])=>r.name},{id:'person',label:'人员',numeric:false,date:false,value:(r:typeof rows[number])=>r.person},{id:'status',label:'状态',numeric:false,date:false,value:(r:typeof rows[number])=>r.status}]
  expect(filterTableRows(rows,fields,'张 安全',[])).toEqual([rows[0]])
  expect(filterTableRows(rows,fields,'张 安全',[{field:'status',operator:'equals',value:'未交付'}])).toEqual([])
})
