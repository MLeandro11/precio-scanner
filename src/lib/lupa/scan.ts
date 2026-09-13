/**
 * Scan gating — pure logic for the camera barcode scanner.
 *
 * The camera stream emits a code on almost every frame while a barcode is in
 * view (BarcodeDetector is fast). `createScanGate` turns that firehose into one
 * signal per distinct code per window, so the UI reacts once (lookup + "added"
 * feedback) instead of every frame.
 */
import { normalizeEan } from './list'

export interface ScanGate {
  /** True when `code` should be emitted now (distinct/cooldown), false otherwise. */
  shouldEmit(code: string, now: number): boolean
  /** Forget the last emitted code (after the user dismissed a detection). */
  reset(): void
}

export interface ScanGateOptions {
  /** Minimum ms between re-emissions of the *same* code. */
  windowMs?: number
}

export function createScanGate({ windowMs = 1500 }: ScanGateOptions = {}): ScanGate {
  let last: { code: string; at: number } | null = null
  return {
    shouldEmit(code, now) {
      const normalized = normalizeEan(code)
      if (!normalized) return false
      if (last && last.code === normalized && now - last.at < windowMs) return false
      last = { code: normalized, at: now }
      return true
    },
    reset() {
      last = null
    },
  }
}

/** Converts a raw detección value into the digits used for catalog lookup. */
export function toLookupDigits(code: string): string {
  return normalizeEan(code).replace(/\D/g, '')
}