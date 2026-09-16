import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser'
import { DecodeHintType } from '@zxing/library'
import { createScanGate } from '../lib/lupa/scan'
import type { ScanGate } from '../lib/lupa/scan'

export type ScanStatus = 'unsupported' | 'requesting' | 'active' | 'denied' | 'error'

export interface TorchControls {
  /** True only when the live video track really exposes the `torch` capability. */
  supported: boolean
  /** Current torch state, flipped only after a successful applyConstraints. */
  on: boolean
  toggle: () => Promise<void>
}

export interface BarcodeScanner {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: ScanStatus
  /** When 'status' is 'error', the underlying failure message (shown to the user). */
  error: string
  torch: TorchControls
  /** Re-runs the camera start attempt after a denial/error. */
  retry: () => void
}

/**
 * Fire a short haptic pulse on supported devices (Android Chrome/Edge). iOS
 * Safari has no Vibration API, and a blocked call can throw, so this is always
 * guarded and never surfaces a failure to the caller.
 */
export function vibrate(pattern: number | number[] = 25): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Vibration is a nice-to-have; never let it break a detection or an add.
  }
}

/** The Torch extension is not in every DOM lib version; keep a local view. */
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean }

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
 *
 * The start attempt is keyed on an `attempt` counter so `retry()` can tear down the
 * previous stream and start a fresh one after a denial/error without leaking either
 * the MediaStream tracks or the ZXing controls.
 */
export function useBarcodeScanner(onDetect: (code: string) => void): BarcodeScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Before the effect runs we are still asking for the camera, not "unsupported":
  // starting neutral avoids a flash of the no-camera layout on every mount.
  const [status, setStatus] = useState<ScanStatus>('requesting')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  const trackRef = useRef<MediaStreamTrack | null>(null)
  const torchOnRef = useRef(false)

  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect
  const gateRef = useRef<ScanGate>(createScanGate())

  /** Ask for the camera again after a denial/error: a fresh effect run. */
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  /**
   * Flip the live track's torch. `supported` comes from the real capability, so a
   * rejection (no torch, busy track…) is expected and must only leave the stream
   * alive with the last known state.
   */
  const toggle = useCallback(async () => {
    const track = trackRef.current
    if (!track) return
    const next = !torchOnRef.current
    try {
      // `torch` is a ConstrainBoolean extension of MediaTrackConstraintSet.
      const constraints = { advanced: [{ torch: next }] } as unknown as MediaTrackConstraints
      await track.applyConstraints(constraints)
      torchOnRef.current = next
      setTorchOn(next)
    } catch {
      // Keep the stream alive and the UI honest: no state change on failure.
    }
  }, [])

  useEffect(() => {
    // Each attempt starts from a clean torch/stream slate.
    setTorchSupported(false)
    setTorchOn(false)
    torchOnRef.current = false
    trackRef.current = null
    gateRef.current.reset()

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

        // Torch is only offered when the live track really reports it (iOS Safari
        // does not), so the UI can hide the control instead of showing a dead one.
        const track = stream.getVideoTracks()[0] ?? null
        trackRef.current = track
        const caps = (track?.getCapabilities?.() ?? {}) as TorchCapabilities
        if (caps.torch === true) setTorchSupported(true)

        // 2) Hand the live stream+video to ZXing, which decodes frames from it.
        controls = await reader.decodeFromStream(stream, video, (result) => {
          if (cancelled) return
          if (result) {
            const code = result.getText()
            if (gateRef.current.shouldEmit(code, Date.now())) {
              vibrate(25)
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
        trackRef.current = null
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
      trackRef.current = null
    }
  }, [attempt])

  return {
    videoRef,
    status,
    error,
    torch: { supported: torchSupported, on: torchOn, toggle },
    retry,
  }
}
