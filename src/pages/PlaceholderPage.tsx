import type { ReactNode } from 'react'
import Brand from '../components/Brand'

/**
 * Generic "coming soon" page used to scaffold routes whose full content lands
 * in a later phase. Every message is honest: the screen shows what it will do
 * once its data source is wired.
 */
export default function PlaceholderPage({
  title,
  description,
  icon,
}: {
  title: string
  description: string
  icon?: ReactNode
}) {
  return (
    <main className="safe-top mx-auto w-full max-w-lg px-4">
      <Brand />
      <div className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface-raised px-6 py-12 text-center">
        {icon ? <span className="text-text-muted">{icon}</span> : null}
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        <p className="max-w-xs text-sm text-text-secondary">{description}</p>
      </div>
    </main>
  )
}