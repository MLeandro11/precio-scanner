import { Search as LupaIcon } from 'lucide-react'

/**
 * Lupa brand identity (rebrand visual): thin-outline magnifier + wordmark.
 * `titleId` lets a page label this heading for accessibility.
 */
export default function Brand({ titleId }: { titleId?: string }) {
  return (
    <div className="flex items-center gap-2 pt-4">
      <LupaIcon size={22} aria-hidden="true" className="text-accent" strokeWidth={2.2} />
      <h1 id={titleId} className="text-xl font-bold leading-none text-text-primary">
        Lupa
      </h1>
    </div>
  )
}