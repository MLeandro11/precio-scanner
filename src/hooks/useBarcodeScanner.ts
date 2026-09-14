import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'
import { createScanGate } from '../lib/lupa/scan'
import type { ScanGate } from '../lib/lupa/scan'

export type ScanStatus = 'unsupported' | 'requesting' | 'active' | 'denied' | 'error'

interface BarcodeScanner {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: ScanStatus
  /** When 'status' is 'error', the underlying failure message (shown to the user). */
  error: string
}

/**
 * Camera barcode scanner for any device that exposes `getUserMedia`
 * (Chrome/Edge/Android, Safari iOS, Firefox…).
 *
 * Decodes with a single pure-JS decoder (ZXing, `BrowserMultiFormatReader`) limited to
 * the EAN/UPC linear formats, throttled so it does not read a full-resolution frame
 * every animation tick on low-end phones.
 *
 * Important Safari quirk handled here: we open the camera and play the `<video>`
 * ourselves BEFORE handing the stream to ZXing, and pass it via `decodeFromStream`.
 * ZXing's transparent `decodeFromVideoDevice` attaches the stream but on some engines
 * leaves the preview black (and decodes an empty frame). Owning the stream+play makes
 * the preview show and the decoder read real frames. A scan gate dedupes the
 * near-constant detections into one signal per distinct code per window.
 */
export function useBarcodeScanner(onDetect: (code: string) => void): BarcodeScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<ScanStatus>('unsupported')
  const [error, setError] = useState('')

  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect
  const gateRef = useRef<ScanGate>(createScanGate())

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported')
      return
    }

    let cancelled = false
    let controls: { stop: () => void } | null = null
    let stream: MediaStream | null = null

    async function start() {
      setStatus('requesting')
      const video = videoRef.current
      if (!video) {
        setStatus('error')
        setError('camera video not mounted')
        return
      }

      // EAN-family only: faster than the 1D+2D multi-format sweep and avoids a
      // stray QR / DataMatrix read answering "its a barcode".
      const hints = new Map<DecodeHintType, unknown>([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
      ])
      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 180,
        delayBetweenScanSuccess: 400,
      })

      try {
        // 1) Open the camera and make the preview actually play. We own the
        //    stream + play so the video is never a black box on Safari/iOS.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        video.srcObject = stream
        video.muted = true
        video.playsInline = true
        await video.play()
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        // 2) Hand the live stream+video to ZXing, which decodes frames from it.
        controls = await reader.decodeFromStream(stream, video, (result) => {
          if (cancelled) return
          if (result) {
            const code = result.getText()
            if (gateRef.current.shouldEmit(code, Date.now())) {
              onDetectRef.current(code)
            }
          }
        })
        if (cancelled) {
          controls?.stop()
          stream?.getTracks().forEach((t) => t.stop())
          return
        }
        setStatus('active')
      } catch (err) {
        stream?.getTracks().forEach((t) => t.stop())
        if (cancelled) return
        const e = err as { name?: string; message?: string }
        const name = e.name
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setStatus('denied')
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
          setError('No se encontró una cámara en este dispositivo.')
          setStatus('error')
        } else if (name === 'NotReadableError') {
          setError('La cámara está siendo usada por otra aplicación.')
          setStatus('error')
        } else if (name === 'SecurityError') {
          setError(
            typeof window !== 'undefined' && !window.isSecureContext
              ? 'Necesitás un contexto HTTPS para usar la cámara.'
              : 'La cámara fue bloqueada por el navegador.',
          )
          setStatus('error')
        } else {
          setError(e.message || String(err))
          setStatus('error')
        }
      }
    }

    start()
    return () => {
      cancelled = true
      controls?.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return { videoRef, status, error }
}