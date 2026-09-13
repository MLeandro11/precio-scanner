import { useMemo } from 'react'

interface Bar {
  x: number
  w: number
}

/**
 * Deterministic pseudo-barcode: bars whose widths derive from the EAN digits,
 * with guard bars at start/middle/end. It is a visual representation of the
 * code (the literal barcode image the user asked for), not a standards-encoded
 * EAN-13 pattern — the EAN number is the real identity.
 */
function buildBars(value: string): Bar[] {
  const seed = value.replace(/\D/g, '')
  const n = seed.length || 1
  const bars: Bar[] = []
  let x = 0
  let acc = 0
  const push = (w: number) => {
    bars.push({ x, w })
    x += w + 1.1
  }
  push(2.6) // left guard
  for (let i = 0; i < 30; i++) {
    const d = seed.charCodeAt(i % n) + acc
    acc = (acc + d) % 97
    push(0.9 + (d % 3) * 0.9)
    if (i === 14) push(2.6) // center guard
  }
  push(2.6) // right guard
  return bars
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
  const bars = useMemo(() => buildBars(value), [value])
  return (
    <svg
      viewBox="0 0 200 44"
      width={width}
      height={height}
      role="img"
      aria-label={`Código de barras ${value}`}
      className="block"
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={44} fill="#0f172a" />
      ))}
    </svg>
  )
}