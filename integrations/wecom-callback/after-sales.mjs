import { readFileSync } from 'node:fs'
import { openAfterSales } from './after-sales-store.mjs'

process.umask(0o077)
const [command, first, second, ...rest] = process.argv.slice(2)
if (!['import', 'attach', 'start', 'complete', 'show', 'list'].includes(command)) {
  console.error('用法：node after-sales.mjs import <case.json> | attach <id> <原稿.docx> | start <id> | complete <id> <交付.pptx> <检查结果> | show <id> | list')
  process.exit(1)
}
const store = openAfterSales(process.env.WECOM_AFTER_SALES_DIR || './data/after-sales')
try {
  let result
  if (command === 'import') result = store.import(JSON.parse(readFileSync(first, 'utf8')))
  if (command === 'attach') result = store.attach(first, second)
  if (command === 'start') result = store.start(first)
  if (command === 'complete') result = store.complete(first, second, rest.join(' '))
  if (command === 'show') result = store.get(first)
  if (command === 'list') result = store.list()
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  store.close()
}
