/**
 * Minimal ambient typings for the BarcodeDetector API (Chromium) so the scanner
 * typechecks without a polyfill. Safari/Firefox lack it; the hook feature-detect
 * and falls back to manual EAN entry.
 */
interface DetectedBarcode {
  boundingBox: DOMRectReadOnly
  rawValue: string
  format: string
  cornerPoints: Array<{ x: number; y: number }>
}

interface BarcodeDetectorOptions {
  formats?: string[]
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions)
  static getSupportedFormats(): Promise<string[]>
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>
}

/**
 * Firebase Web config, injected at build time from the environment (see `.env.example`).
 * Every value is optional on purpose: a build without them has **no auth configured**, which
 * is the ordinary case for a fresh clone, for CI and for `scripts/acceptance.ts`.
 */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
}