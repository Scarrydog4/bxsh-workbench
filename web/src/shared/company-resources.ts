export const ANDROID_RELEASE = {
  version: '0.1.6',
  versionCode: 7,
  minimumAndroid: '8.0',
  page: '/download',
  download: '/api/download/android',
  filename: 'bixia-workorder-android-v0.1.6.apk',
  notes: ['浏览器、网站和手机端统一使用原花朵 Logo', '名称保持笔下工单，保留应用内更新和原生拍照'],
} as const
export const PAYMENT_CODES = ['wechat', 'alipay'] as const
export type PaymentCodeKind = typeof PAYMENT_CODES[number]
export const PAYMENT_CODE_LABELS: Record<PaymentCodeKind, string> = { wechat: '微信收款码', alipay: '支付宝收款码' }
export type PaymentCodeView = Record<PaymentCodeKind, string | null>
