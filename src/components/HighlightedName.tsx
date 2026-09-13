/**
 * Renders `nombre` with Fuse match ranges ([start, end] char indices)
 * highlighted with <mark>.
 */
export type HighlightRange = [number, number]

export default function HighlightedName({
  nombre,
  ranges,
}: {
  nombre: string
  ranges?: HighlightRange[]
}) {
  if (!ranges || ranges.length === 0) return <span>{nombre}</span>

  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const parts: React.ReactNode[] = []
  let cursor = 0

  for (const [start, end] of sorted) {
    if (start > cursor) {
      parts.push(<span key={`t${cursor}`}>{nombre.slice(cursor, start)}</span>)
    }
    parts.push(
      <mark key={`m${start}`} className="rounded-sm bg-highlight text-text-primary">
        {nombre.slice(start, end)}
      </mark>,
    )
    cursor = Math.max(cursor, end)
  }
  if (cursor < nombre.length) {
    parts.push(<span key={`t${cursor}`}>{nombre.slice(cursor)}</span>)
  }
  return <span>{parts}</span>
}