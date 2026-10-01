/**
 * Renders `nombre` with Fuse match ranges highlighted with <mark>.
 *
 * `ranges` are `[start, end]` character indices and they are INCLUSIVE: the character at `end`
 * is part of the match, exactly as Fuse reports it. They are expected to arrive sorted and
 * disjoint, because `mergeRanges` in `src/lib/searchEngine.ts` guarantees that upstream —
 * overlapping or touching ranges are already merged before they reach this component, so no
 * merging happens here (duplicating that guarantee would only create a second source of truth).
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
        {nombre.slice(start, end + 1)}
      </mark>,
    )
    cursor = Math.max(cursor, end + 1)
  }
  if (cursor < nombre.length) {
    parts.push(<span key={`t${cursor}`}>{nombre.slice(cursor)}</span>)
  }
  return <span>{parts}</span>
}