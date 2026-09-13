import { useEffect, useRef, useState } from 'react'
import { createScanGate } from '../lib/lupa/scan'
import type { ScanGate } from '../lib/lupa/scan'

export type ScanStatus = 'unsupported' | 'requesting' | 'active' | 'denied' | 'error'

interface BarcodeScanner {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: ScanStatus
  /** When 'error', the underlying failure message. */
  error: string
}

/**
 * Camera barcode scanner (BarcodeDetector + getUserMedia), Chromium-only.
 *
 * The video stream is attached to `videoRef`; a requestAnimationFrame loop runs
 * BarcodeDetector.detect over the live frames and reports **one** signal per
 * distinct code through the gate (dedupe + cooldown). Not supported / denied /
 * failing contexts report a status the ScanPage handles with the manual EAN UI.
 */
export function useBarcodeScanner(onDetect: (code: string) => void): BarcodeScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<ScanStatus>('unsupported')
  const [error, setError] = useState('')

  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect
  const gateRef = useRef<ScanGate>(createScanGate())

  useEffect(() => {
    if (typeof BarcodeDetector === 'undefined') {
      setStatus('unsupported')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported')
      return
    }

    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null

    async function start() {
      setStatus('requesting')
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const video = videoRef.current
        if (!video) throw new Error('camera video element not mounted')
        video.srcObject = stream
        video.muted = true
        await video.play()

        const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })
        setStatus('active')

        const loop = async () => {
          if (cancelled) return
          try {
            if (video.readyState >= 2) {
              const codes = await detector.detect(video)
              for (const c of codes) {
                if (gateRef.current.shouldEmit(c.rawValue, Date.now())) {
                  onDetectRef.current(c.rawValue)
                }
              }
            }
          } catch {
            // dim frame / detector hiccup: keep scanning
          }
          raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
      } catch (err) {
        if (cancelled) return
        const name = (err as { name?: string }).name
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
          setStatus('denied')
        } else {
          setError(err instanceof Error ? err.message : String(err))
          setStatus('error')
        }
      }
    }

    start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return { videoRef, status, error }
}