const testDatabase = process.env.TEST_DATABASE_URL ?? 'postgres://bxsh@127.0.0.1:5433/workbench_test'
if (['workbench', 'workbench_assistant_test'].includes(new URL(testDatabase).pathname.slice(1))) throw new Error('禁止对真实账目运行自动测试')
// 测试用单独的库，不碰开发库和正式数据
process.env.TEST_DATABASE_URL = testDatabase
process.env.DATABASE_URL = testDatabase
process.env.STORAGE_DIR = process.env.TEST_STORAGE_DIR ?? '/tmp/bxsh-test-storage'
