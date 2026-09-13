import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * In-house mobile bottom Sheet (design-system §5/§7b).
 *
 * - `role="dialog"` + `aria-modal`, labelled by the visible title.
 * - Escape closes; the backdrop closes on tap.
 * - Body scroll is locked while open; focus moves into the panel on open.
 * - Only transform/opacity animate, so no layout reflow (§8).
 */
export default function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean
  onClose?: () => void
  title?: string
  description?: string
  children: ReactNode
}) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop: dismissal convenience, not a control. Escape is the keyboard path. */}
      <div
        className="sheet-backdrop absolute inset-0 bg-surface-sunken/40"
        onClick={onClose}
        aria-hidden="true"
      />

      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="sheet-panel safe-bottom relative w-full max-w-lg rounded-t-2xl border-t border-border bg-surface-raised shadow-lg outline-none"
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          {title ? (
            <h2 id={titleId} className="text-base font-semibold text-text-primary">
              {title}
            </h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar filtros"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {description && (
          <p id={descriptionId} className="px-4 pt-3 text-sm text-text-secondary">
            {description}
          </p>
        )}

        <div className="max-h-[70dvh] overflow-y-auto px-4 py-4">{children}</div>
      </section>
    </div>
  )
}