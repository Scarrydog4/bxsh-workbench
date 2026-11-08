import { WorkspacePage } from '@/client/WorkspacePage'
import { requireAdminPage } from '@/server/workbench-page-access'

export default async function Page() {
  await requireAdminPage('/admin/audit')
  return <WorkspacePage page='audit' />
}
