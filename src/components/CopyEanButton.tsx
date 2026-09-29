import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import Button from './ui/Button'
import { copyText, formatEanLines } from '../lib/clipboard'

/**
 * The EAN text itself is the copy control, not a control beside it.
 *
 * At 320px the list row is already saturated — a 44px remove button, the
 * quantity stepper and the price leave nothing for a second 44px column — so
 * making the code clickable is what buys the 44px floor without truncating the
 * product name to nothing. No `aria-pressed`: copying is an action, not a
 * state (the toast is the confirmation), so the accessible name carries the
 * concrete EAN instead.
 */
export default function CopyEanButton({ ean, className = '' }: { ean: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(ean)
        if (ok) {
          toast('EAN copiado', { description: ean })
          return
        }
        toast.error('No se pudo copiar', {
          description: 'Tu navegador no dio acceso al portapapeles.',
        })
      }}
      aria-label={`Copiar el EAN ${ean}`}
      title="Copiar el EAN"
      className={`flex min-h-11 w-full items-center gap-1.5 rounded-sm text-left text-text-secondary transition hover:text-text-primary ${className}`}
    >
      <span className="min-w-0 truncate font-mono text-[11px]">EAN {ean}</span>
      <Copy size={13} aria-hidden="true" className="shrink-0" />
    </button>
  )
}

/**
 * Bulk copy for a whole list. One EAN per line, in list order: the shape that
 * pastes into a spreadsheet. Renders nothing for an empty list, so a list with
 * no products never offers a control that would copy an empty string.
 */
export function CopyAllEansButton({
  eans,
  className = '',
  label = 'Copiar todos los EAN',
}: {
  eans: readonly string[]
  className?: string
  label?: string
}) {
  if (eans.length === 0) return null

  return (
    <Button
      variant="secondary"
      className={`w-full ${className}`}
      aria-label={label}
      onClick={async () => {
        const text = formatEanLines(eans)
        const ok = await copyText(text)
        if (ok) {
          // Count the lines actually copied, not the raw array: blanks are dropped.
          const n = text.length === 0 ? 0 : text.split('\n').length
          toast('EAN copiados', { description: `${n} código${n === 1 ? '' : 's'}` })
          return
        }
        toast.error('No se pudo copiar', {
          description: 'Tu navegador no dio acceso al portapapeles.',
        })
      }}
    >
      <Copy size={15} aria-hidden="true" />
      {label}
    </Button>
  )
}
