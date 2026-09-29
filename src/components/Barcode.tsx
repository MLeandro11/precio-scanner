import { useEffect, useRef, useState } from 'react'

/**
 * Module-level single-flight loader: every barcode row shares one dynamic
 * import, so the list's "Códigos de barras" view fetches the JsBarcode chunk
 * exactly once per session. The chunk is NOT in the entry bundle (a secondary
 * view most sessions never open) and it IS in the service-worker precache
 * (vite-plugin-pwa precaches every emitted JavaScript chunk except the
 * deliberately excluded firebase/firestore/data chunks), so the view still
 * works offline at the register.
 */
/** The slice of JsBarcode's option surface this component uses. */
interface JsBarcodeOptions {
  height?: number
  fontSize?: number
  displayValue?: boolean
  margin?: number
  background?: string
  lineColor?: string
  format?: string
}
type JsBarcodeFn = (el: SVGElement, value: string, options?: JsBarcodeOptions) => void

let barcodeLibPromise: Promise<JsBarcodeFn> | null = null
function loadBarcodeLib(): Promise<JsBarcodeFn> {
  barcodeLibPromise ??= import('jsbarcode').then((m) => m.default)
  return barcodeLibPromise
}

/**
 * Renders a REAL, standards-encoded barcode from a value using JsBarcode.
 *
 * Previously this drew a pseudo-barcode (bars derived from the EAN digits but not
 * a scannable pattern). The list's "Códigos de barras" view is meant to be scanned
 * at the store, so the image must be an actual EAN he decoders read.
 *
 * Format is chosen by the code shape: 13 digits -> EAN13, 8 digits -> EAN8, and
 * anything else (e.g. a catalog id for a barcode-less product) -> CODE128. A try
 * loop falls back so an invalid checksum or odd key never crashes the row.
 */
function pickFormat(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 13) return 'EAN13'
  if (digits.length === 8) return 'EAN8'
  return 'CODE128'
}

export default function Barcode({
  value,
  width = 190,
  height = 44,
}: {
  value: string
  width?: number
  height?: number
}) {
  const ref = useRef<SVGSVGElement | null>(null)
  // Set once the library chunk has loaded; keeps the effect's decoder loop
  // re-running at that moment without re-triggering the import.
  const [JsBarcode, setJsBarcode] = useState<JsBarcodeFn | null>(null)

  useEffect(() => {
    let alive = true
    loadBarcodeLib().then((lib) => {
      if (alive) setJsBarcode(() => lib)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !JsBarcode) return
    // bar plus human-readable digits fits under the desired box height.
    const barHeight = Math.max(22, height - 16)
    const base: JsBarcodeOptions = {
      height: barHeight,
      fontSize: 11,
      displayValue: true,
      margin: 0,
      // Barcodes must keep light/blank backgrounds in BOTH themes: a store
      // scanner reads the white background for contrast. Explicit here so
      // dark mode never makes the bars/box look broken.
      background: '#ffffff',
      lineColor: '#000000',
    }
    for (const format of [pickFormat(value), 'CODE128']) {
      try {
        JsBarcode(el, value, { ...base, format })
        return
      } catch {
        // invalid for this format (e.g. bad checksum) — try the next
      }
    }
  }, [value, height, JsBarcode])

  return (
    // White wrapper is essential: JsBarcode's SVG output does not draw a
    // guaranteed background fill, so in dark mode the bars could sit on the
    // dark row behind them. A fixed white container keeps the barcode readable
    // in BOTH themes (store scanners need the white contrast).
    <div className="inline-block overflow-hidden rounded-md bg-white p-1.5">
      <svg
        ref={ref}
        width={width}
        height={height}
        style={{ width, height, backgroundColor: '#ffffff' }}
        role="img"
        aria-label={`Código de barras ${value}`}
        className="block"
      />
    </div>
  )
}