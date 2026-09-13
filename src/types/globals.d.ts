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