import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
/**
 * In-house mobile bottom Sheet (design-system §5/§7b).
 *
 * - `role="dialog"` + `aria-modal`, labelled by the visible title.
 * - Escape closes; the backdrop closes on tap; focus is trapped inside the panel
 *   while it is open and returned to the control that opened it on close.
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
  const openerRef = useRef<HTMLElement | null>(null)
  /* Latest onClose without making it an effect dep: callers pass a fresh
     arrow every render (SearchPage does), and re-running this effect on every
     render would tear the trap down and steal focus back to the panel while
     the user is using an inner control. The one-source-of-truth is `open`.
     (Translated: the trap installs once per open; Escape/backdrop/Tab use the
     ref's latest identity, so the callback stays fresh without re-running.) */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    /* Remember the control that opened the sheet so focus can go back to it. */
    const active = document.activeElement
    openerRef.current = active instanceof HTMLElement ? active : null

    /** Focusables inside the panel, visible-only, in DOM order. */
    function focusables(): HTMLElement[] {
      const panel = panelRef.current
      if (!panel) return []
      const nodes = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      return Array.from(nodes).filter((el) => el.offsetParent !== null)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }
      /* Focus trap: aria-modal removes the rest of the page from the
         accessibility tree, so Tab must stay inside the panel. Escape remains
         the keyboard path out; the aria-hidden backdrop is pointer-only and
         must never become a keyboard dead end. */
      if (event.key === 'Tab') {
        const list = focusables()
        if (list.length === 0) {
          event.preventDefault()
          panelRef.current?.focus()
          return
        }
        const first = list[0]
        const last = list[list.length - 1]
        const activeEl = document.activeElement
        if (event.shiftKey) {
          if (activeEl === first || activeEl === panelRef.current) {
            event.preventDefault()
            last.focus()
          }
        } else if (activeEl === last || activeEl === panelRef.current) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      /* Restore focus to the opener (a11y: aria-modal dialogs return focus). */
      openerRef.current?.focus()
      openerRef.current = null
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop: dismissal convenience, not a control. Escape is the keyboard path.
          `bg-scrim` is the role token: a scrim always darkens, in both themes. */}
      <div
        className="sheet-backdrop absolute inset-0 bg-scrim/40"
        onClick={() => onCloseRef.current?.()}
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
            onClick={() => onCloseRef.current?.()}
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
