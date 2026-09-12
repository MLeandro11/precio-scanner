/**
 * Renders `nombre` with Fuse match ranges ([start, end] char indices)
 * highlighted with <mark>.
 */
export default function HighlightedName({ nombre, ranges }) {
  if (!ranges || ranges.length === 0) return <span>{nombre}</span>

  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const parts = []
  let cursor = 0

  for (const [start, end] of sorted) {
    if (start > cursor) {
      parts.push(<span key={`t${cursor}`}>{nombre.slice(cursor, start)}</span>)
    }
    parts.push(
      <mark
        key={`m${start}`}
        className="rounded bg-amber-200/70 text-slate-900"
      >
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
