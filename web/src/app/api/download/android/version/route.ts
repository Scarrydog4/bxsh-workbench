import { androidReleaseManifest } from '@/server/android-release'

export const dynamic = 'force-dynamic'

export async function GET() {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  try {
    return Response.json(await androidReleaseManifest(), { headers })
  } catch {
    return Response.json({ error: '暂时无法检查更新，请稍后重试' }, { status: 503, headers })
  }
}
