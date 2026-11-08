import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  // 附件走分片上传，单片 8MB；这里放宽 Server Actions 以外的请求体不受影响
  serverExternalPackages: ['postgres', 'exceljs'],
}

export default config
