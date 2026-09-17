import LupaLockup from './LupaLockup'

/**
 * Lupa brand identity: the real lockup (symbol + wordmark) instead of the former
 * lucide magnifier placeholder.
 *
 * The visible mark is the lockup and it is decorative: the `<h1>` below is the only
 * element that announces "Lupa", so screen readers hear the name exactly once
 * (render the lockup without `decorative` only where nothing else names the brand).
 * `titleId` lets a page label that heading.
 *
 * The root is a plain block, not a flex row: the heading is visually hidden and as a
 * flex item it would consume a `gap` slot after the mark, reserving dead space in
 * every header. The mark is `block` so it carries no inline baseline gap either.
 */
export default function Brand({ titleId }: { titleId?: string }) {
  return (
    <div className="pt-4 text-text-primary">
      <LupaLockup variant="lite" height={24} gap={8} decorative className="block" />
      <h1 id={titleId}>
        <span className="sr-only">Lupa</span>
      </h1>
    </div>
  )
}
