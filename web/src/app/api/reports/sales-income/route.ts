import { route } from '@/server/http'
import { peopleIncomeReport } from '@/server/people-income-report'
export const GET = route((req, c) => peopleIncomeReport(req, c, 'sales'))
