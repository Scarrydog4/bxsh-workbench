'use client'

import { useEffect, useRef, useState } from 'react'
import Webcam from 'react-webcam'
import { Camera, CameraRotate, SpinnerGap } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'

/** 只从实时视频取帧；不提供文件输入，不写相册，离开组件即关闭摄像头。 */
export function CheckinCamera({ onCapture, onCancel }: { onCapture: (photo: string) => void; onCancel: () => void }) {
  const webcam = useRef<Webcam>(null)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const hide = () => { if (document.hidden) onCancel() }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [onCancel])
  return <div className="overflow-hidden rounded-xl border bg-black text-white">
    <div className="relative h-[min(48dvh,360px)]">
      {!error && <Webcam key={`${facing}:${attempt}`} ref={webcam} audio={false} screenshotFormat="image/jpeg" screenshotQuality={0.85} playsInline muted disablePictureInPicture
        videoConstraints={{ facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } }}
        className="h-full w-full object-contain" onUserMedia={() => setReady(true)} onUserMediaError={e => {
          setReady(false)
          const name = typeof e === 'string' ? e : e.name
          setError(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? '请允许使用摄像头，再重新打开拍照。' : '摄像头暂时无法使用，请关闭其他相机应用后重试。')
        }} />}
      {!ready && !error && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm"><SpinnerGap size={24} className="animate-spin" />正在打开摄像头…</div>}
      {error && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm"><span>{error}</span><Button variant="secondary" onClick={() => { setError(''); setAttempt(n => n + 1) }}>重新打开</Button></div>}
    </div>
    <div className="flex items-center justify-between gap-3 border-t border-white/15 px-4 py-3">
      <button type="button" onClick={onCancel} className="min-h-11 px-2 text-sm">取消</button>
      <button type="button" aria-label="拍摄照片" disabled={!ready} onClick={() => {
        const photo = webcam.current?.getScreenshot()
        if (photo) onCapture(photo)
        else { setReady(false); setError('相机画面尚未准备好，请重新打开拍照。') }
      }} className="grid h-14 w-14 place-items-center rounded-full border-4 border-white/50 bg-white text-black outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"><Camera size={24} /></button>
      <button type="button" aria-label="切换前后摄像头" className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10" onClick={() => { setReady(false); setError(''); setFacing(facing === 'user' ? 'environment' : 'user') }}><CameraRotate size={23} /></button>
    </div>
  </div>
}
