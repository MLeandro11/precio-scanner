import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

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

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // bar plus human-readable digits fits under the desired box height.
    const barHeight = Math.max(22, height - 16)
    const base: JsBarcode.Options = {
      height: barHeight,
      fontSize: 11,
      displayValue: true,
      margin: 0,
    }
    for (const format of [pickFormat(value), 'CODE128']) {
      try {
        JsBarcode(el, value, { ...base, format })
        return
      } catch {
        // invalid for this format (e.g. bad checksum) — try the next
      }
    }
  }, [value, height])

  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      style={{ width, height }}
      role="img"
      aria-label={`Código de barras ${value}`}
      className="block overflow-hidden"
    />
  )
}