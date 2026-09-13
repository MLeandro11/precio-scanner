/**
 * Skeleton rows matching ProductCard geometry (design-system §5).
 * Shimmer lives in index.css (.skeleton) and is disabled under
 * prefers-reduced-motion by the global rule there.
 */
export function SkeletonRow() {
  return (
    <li className="rounded-md border border-border bg-surface-raised p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-3/4 rounded-sm" />
          <div className="skeleton h-3 w-1/3 rounded-sm" />
        </div>
        <div className="skeleton h-11 w-11 rounded-full" />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="skeleton h-3 w-2/5 rounded-sm" />
        <div className="skeleton h-5 w-20 rounded-sm" />
      </div>
    </li>
  )
}

export default function SkeletonList({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite" aria-label="Cargando resultados">
      <span className="sr-only">Cargando…</span>
      <ul className="space-y-2" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </ul>
    </div>
  )
}