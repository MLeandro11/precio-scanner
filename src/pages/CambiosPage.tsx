import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { TrendingDown, TrendingUp, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { toast } from 'sonner'
import Brand from '../components/Brand'
import Button from '../components/ui/Button'
import { formatPrice } from '../components/ProductCard'
import { usableEan } from '../lib/images'
import { loadCatalogChanges } from '../lib/catalogChanges'
import { useList } from '../hooks/useList'
import type {
  ChangeDay,
  ChangesArtifact,
  ChangesLoadResult,
  NewProduct,
  PriceMove,
} from '../lib/catalogChanges'

/**
 * `/cambios` — the global catalog-changes feed.
 *
 * The pipeline computes the diff and publishes `data/catalogo-cambios.json`; this
 * screen only shows what the artifact contains and never simulates a row (S5,
 * FR-8.4). The loader is injected for tests and is NEVER part of the boot path:
 * the artifact is fetched only when this screen mounts (H3), so the three boot
 * downloads and the 5.5 MB cache math are untouched.
 *
 * Frozen ordering: inside every day `bajaron` → `subieron` → `nuevos`. One day is shown at a
 * time and a header walks the days the artifact carries, one calendar day per press of the
 * arrow. Identity is the EAN (R5): a row links to `/producto/<ean>` only when `ean` is usable,
 * and nothing is ever grouped or deduplicated by name. Big changes enter as-is, with no mark
 * and no warning (S7: the repo's own R7 investigation found them to be real POS corrections).
 *
 * The header's label is its own honesty law: `Hoy` and `Ayer` are printed **only when they are
 * true** in the reader's own calendar, because the pipeline runs a few hours late and the
 * newest day is routinely yesterday. A day inside the range that the artifact does not carry
 * says it has no data — never "no changes", which is a different truth (a published day with
 * zero movements).
 *
 * Every row with a usable EAN also adds its product to the shopping list, through the SAME
 * `useList()` the product detail writes to: two screens, one list. A row without a usable EAN
 * gets no button, because `ListaItem` is keyed by the EAN and there is nothing to key it with —
 * the row stays informational instead of offering an action that cannot be honored.
 *
 * Every state is honest (S5): loading, absent (pipeline not published yet),
 * invalid (unreadable artifact), offline with a stored copy, offline with
 * nothing, and a server error. A failed load never becomes an endless spinner
 * and never invents rows or dates.
 *
 * Stable hooks (the acceptance harness keys on these):
 *   - container: `data-changes-state` = loading | ready | cached | absent |
 *     invalid | offline | error
 *   - the shown day: `data-changes-day="YYYY-MM-DD"`, plus `data-changes-missing="true"`
 *     when the artifact carries no entry for it
 *   - the header: `data-changes-label` (the day's own label), `data-changes-nav="prev"`
 *     and `data-changes-nav="next"` (the arrows)
 *   - each section: `data-changes-section="bajaron|subieron|nuevos"`, plus
 *     `data-changes-count` and `data-changes-truncated`
 *   - each row: `data-changes-row="bajaron|subieron|nuevos"`, plus `data-ean`
 *     only when the EAN is usable
 */

interface CambiosPageProps {
  /** Injectable loader (defaults to the real network-first one). */
  loadFn?: () => Promise<ChangesLoadResult>
  /** Injectable clock (defaults to the real one), so `Hoy` is testable. */
  now?: () => Date
}

/** Every user-facing string in one place, so copy cannot drift between states. */
const COPY = {
  titulo: 'Qué cambió',
  hoy: 'Hoy',
  ayer: (fecha: string) => `Ayer, ${fecha}`,
  diaAnterior: 'Día anterior',
  diaSiguiente: 'Día siguiente',
  actualizado: (momento: string) => `Última actualización: ${momento}`,
  /** Shown when the artifact's `generado` cannot be read: the age is unknown, not "now". */
  actualizadoDesconocido: 'Última actualización: sin fecha legible en el archivo de cambios.',
  loading: 'Cargando cambios…',
  emptyWindow: 'No hay cambios en esta ventana.',
  absent: 'Todavía no hay cambios publicados.',
  absentHint:
    'El catálogo se actualiza solo, todos los días. Cuando termine la próxima corrida, esta pantalla se llena sola.',
  invalid: 'No pudimos leer los cambios publicados.',
  invalidHint: 'El archivo llegó dañado o en un formato que esta versión no entiende.',
  offline: 'Sin conexión y todavía no hay una copia guardada.',
  offlineHint: 'Conectate una vez para bajar los últimos cambios.',
  cached: 'Sin conexión. Mostrando la última copia guardada.',
  error: 'No pudimos traer los cambios ahora.',
  errorHint: 'Revisá tu conexión y probá de nuevo.',
  reintentar: 'Reintentar',
  agregar: (nombre: string) => `Agregar ${nombre} a mi lista`,
  agregado: 'Agregado a tu lista',
  ahoraTenes: (cantidad: number) => `Ahora tenés ${cantidad}`,
  deshacer: 'Deshacer',
  sinCambiosDia: 'Sin cambios este día.',
  sinDatosDia: 'No hay datos de este día.',
  sinDatosDiaHint:
    'El catálogo se actualiza solo, todos los días. De este día no quedó registro publicado.',
  bajaron: 'Bajaron de precio',
  subieron: 'Subieron de precio',
  nuevos: 'Se agregaron',
} as const

type SectionKind = 'bajaron' | 'subieron' | 'nuevos'

type ScreenState =
  | { phase: 'loading' }
  | { phase: 'ready'; artifact: ChangesArtifact; source: 'network' | 'cache' }
  | { phase: 'absent' }
  | { phase: 'invalid' }
  | { phase: 'offline' }
  | { phase: 'error' }

/** `YYYY-MM-DD` in the artifact's own timezone (UTC), never shifted by the device. */
function formatDay(fecha: string): string {
  const date = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return fecha
  const label = date.toLocaleDateString('es-AR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** The day without its weekday: the weekday is noise next to `Ayer`. */
function formatDayShort(fecha: string): string {
  const date = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return fecha
  return date.toLocaleDateString('es-AR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  })
}

/**
 * The reader's own calendar day as `YYYY-MM-DD`, from the LOCAL fields on purpose: "hoy" and
 * "ayer" are words about the reader's calendar, not about the artifact's UTC bucket. Deriving
 * them from `toISOString()` would print "Ayer" to someone whose date is still today.
 */
function localDay(now: Date): string {
  const y = now.getFullYear()
  const m = `${now.getMonth() + 1}`.padStart(2, '0')
  const d = `${now.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** One calendar day of arithmetic, immune to DST because the anchor is UTC midnight. */
function shiftDay(fecha: string, delta: number): string {
  const ms = Date.parse(`${fecha}T00:00:00Z`)
  if (Number.isNaN(ms)) return fecha
  return new Date(ms + delta * 86_400_000).toISOString().slice(0, 10)
}

/**
 * The label of the shown day, and the screen's honesty gate: `Hoy` and `Ayer` are printed only
 * when the reader's own calendar agrees. Anything else is named by its date, so a stale
 * artifact can never be passed off as today's news.
 */
export function dayLabel(fecha: string, now: Date): string {
  const hoy = localDay(now)
  if (fecha === hoy) return COPY.hoy
  if (fecha === shiftDay(hoy, -1)) return COPY.ayer(formatDayShort(fecha))
  return formatDay(fecha)
}

  /** The moment the artifact was generated, in the reader's own clock, or `null` if unreadable. */
function formatMoment(generado: string): string | null {
  const date = new Date(generado)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('es-AR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
  })
}

/** Signed percentage; `useGrouping: false` keeps "1108,33 %" readable, not "1.108,33 %". */
function formatPct(pct: number): string {
  // A real move that rounds to zero must not read as "0 %": the arrow already carries the
  // direction, so the number says the move is smaller than the precision it can show. The
  // boundary is the formatter's own — two decimals.
  if (pct !== 0 && Math.abs(pct) < 0.005) return '<0,01 %'
  const value = pct.toLocaleString('es-AR', { maximumFractionDigits: 2, useGrouping: false })
  return `${pct > 0 ? '+' : ''}${value} %`
}

function countLine(
  list: { conteo: number; truncado: boolean; valores: unknown[] },
  unit: 'precio' | 'producto',
): string {
  const total = `${list.conteo.toLocaleString('es-AR')} ${unit}${list.conteo === 1 ? '' : 's'}`
  return list.truncado
    ? `Se muestran los primeros ${list.valores.length} de ${total}.`
    : `En total: ${total}.`
}

/** The one add affordance, shared by both row kinds, so the two cannot drift apart. */
function AddToListButton({ nombre, onAdd }: { nombre: string; onAdd: () => void }) {
  return (
    <Button
      variant="secondary"
      size="icon"
      data-changes-add="true"
      aria-label={COPY.agregar(nombre)}
      onClick={onAdd}
      className="shrink-0"
    >
      <Plus size={18} aria-hidden="true" />
    </Button>
  )
}

function MoveRow({
  move,
  kind,
  onAdd,
}: {
  move: PriceMove
  kind: 'bajaron' | 'subieron'
  onAdd: (producto: { ean: string | null; nombre: string }) => void
}) {
  const down = kind === 'bajaron'
  // The link cut is the same usable-EAN rule the rest of the app uses (>=6
  // digits, H5): a row without a resolvable EAN renders without a link — and,
  // for the same reason, without an add button.
  const ean = usableEan(move.ean ?? undefined)
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">{move.nombre}</span>
        <span className="tnum mt-0.5 block text-xs text-text-secondary">
          {formatPrice(move.antes)} → {formatPrice(move.ahora)}
        </span>
      </span>
      <span
        className={`tnum inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          down ? 'bg-accent/10 text-accent' : 'bg-surface text-text-secondary'
        }`}
      >
        {down ? (
          <TrendingDown size={12} aria-hidden="true" />
        ) : (
          <TrendingUp size={12} aria-hidden="true" />
        )}
        {formatPct(move.pct)}
      </span>
    </>
  )

  return (
    <li
      data-changes-row={kind}
      data-ean={move.ean ?? undefined}
      className="flex items-center gap-2 border-t border-border first:border-t-0"
    >
      {ean ? (
        <Link
          to={`/producto/${ean}`}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2"
          aria-label={`Ver ${move.nombre}`}
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2">{content}</div>
      )}
      {ean ? (
        <AddToListButton nombre={move.nombre} onAdd={() => onAdd({ ean: move.ean, nombre: move.nombre })} />
      ) : null}
    </li>
  )
}

function NewRow({
  product,
  onAdd,
}: {
  product: NewProduct
  onAdd: (producto: { ean: string | null; nombre: string }) => void
}) {
  const ean = usableEan(product.ean ?? undefined)
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
        {product.nombre}
      </span>
      <span className="tnum shrink-0 text-sm font-bold text-text-primary">
        {formatPrice(product.precio)}
      </span>
    </>
  )

  return (
    <li
      data-changes-row="nuevos"
      data-ean={product.ean ?? undefined}
      className="flex items-center gap-2 border-t border-border first:border-t-0"
    >
      {ean ? (
        <Link
          to={`/producto/${ean}`}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2"
          aria-label={`Ver ${product.nombre}`}
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2">{content}</div>
      )}
      {ean ? (
        <AddToListButton
          nombre={product.nombre}
          onAdd={() => onAdd({ ean: product.ean, nombre: product.nombre })}
        />
      ) : null}
    </li>
  )
}

/** One ordered section, rendered only when the artifact reports it has rows. */
function SectionBlock({
  kind,
  list,
  unit,
  children,
}: {
  kind: SectionKind
  list: { conteo: number; truncado: boolean; valores: unknown[] }
  unit: 'precio' | 'producto'
  children: React.ReactNode
}) {
  if (list.conteo === 0) return null
  return (
    <section
      data-changes-section={kind}
      data-changes-count={list.conteo}
      data-changes-truncated={list.truncado ? 'true' : 'false'}
      className="mt-5"
    >
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {kind === 'bajaron' ? COPY.bajaron : kind === 'subieron' ? COPY.subieron : COPY.nuevos}
      </h4>
      <p className="tnum mt-0.5 text-xs text-text-muted">{countLine(list, unit)}</p>
      <ul className="mt-1">{children}</ul>
    </section>
  )
}

/**
 * The shown day. `day === null` is a gap inside the range the artifact covers: the artifact
 * carries no entry for that date, so the screen says it has no data rather than showing an
 * empty day ("no se movió nada" is a different, and unproven, claim).
 */
function DayBlock({
  fecha,
  day,
  onAdd,
}: {
  fecha: string
  day: ChangeDay | null
  onAdd: (producto: { ean: string | null; nombre: string }) => void
}) {
  if (day === null) {
    return (
      <section
        data-changes-day={fecha}
        data-changes-missing="true"
        className="mt-6 rounded-2xl border border-border bg-surface-raised px-5 py-8 text-center"
      >
        <p className="text-sm font-semibold text-text-primary">{COPY.sinDatosDia}</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-text-secondary">
          {COPY.sinDatosDiaHint}
        </p>
      </section>
    )
  }

  const empty =
    day.bajaron.conteo === 0 && day.subieron.conteo === 0 && day.nuevos.conteo === 0

  return (
    <section data-changes-day={day.fecha} className="mt-6">
      {empty ? (
        <p className="mt-2 text-sm text-text-secondary">{COPY.sinCambiosDia}</p>
      ) : (
        <>
          <SectionBlock kind="bajaron" list={day.bajaron} unit="precio">
            {day.bajaron.valores.map((move: PriceMove, i: number) => (
              <MoveRow key={`bajaron-${i}`} move={move} kind="bajaron" onAdd={onAdd} />
            ))}
          </SectionBlock>
          <SectionBlock kind="subieron" list={day.subieron} unit="precio">
            {day.subieron.valores.map((move: PriceMove, i: number) => (
              <MoveRow key={`subieron-${i}`} move={move} kind="subieron" onAdd={onAdd} />
            ))}
          </SectionBlock>
          <SectionBlock kind="nuevos" list={day.nuevos} unit="producto">
            {day.nuevos.valores.map((product: NewProduct, i: number) => (
              <NewRow key={`nuevos-${i}`} product={product} onAdd={onAdd} />
            ))}
          </SectionBlock>
        </>
      )}
    </section>
  )
}

/**
 * The header: one arrow each side of the shown day's own label. The arrows stop at the ends of
 * the range the artifact covers instead of wrapping, because every day beyond it would be a
 * claim this build cannot back with data.
 */
function DayNav({
  label,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  label: string
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const arrow =
    'flex h-11 w-11 items-center justify-center rounded-full border border-border text-text-primary ' +
    'transition-colors disabled:opacity-30 disabled:cursor-not-allowed enabled:active:bg-surface'
  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <button
        type="button"
        data-changes-nav="prev"
        aria-label={COPY.diaAnterior}
        onClick={onPrev}
        disabled={!canPrev}
        className={arrow}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <p
        data-changes-label
        aria-live="polite"
        className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-text-primary"
      >
        {label}
      </p>
      <button
        type="button"
        data-changes-nav="next"
        aria-label={COPY.diaSiguiente}
        onClick={onNext}
        disabled={!canNext}
        className={arrow}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

function LoadingView() {
  return (
    <div role="status" aria-live="polite">
      {/* The visible line is the announcement: the skeleton below is decorative. */}
      <p className="mt-4 text-sm text-text-secondary">{COPY.loading}</p>
      <div className="mt-4 space-y-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-16 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  )
}

/**
 * One day at a time, newest first by default, walking the days the artifact carries. The list
 * is sorted here rather than trusting the artifact's order: the contract says newest first,
 * so the UI is the one that guarantees it.
 */
function ReadyView({
  artifact,
  source,
  now,
  onAdd,
}: {
  artifact: ChangesArtifact
  source: 'network' | 'cache'
  now: () => Date
  onAdd: (producto: { ean: string | null; nombre: string }) => void
}) {
  const dias = [...artifact.dias].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const masNuevo = dias[0]?.fecha ?? null
  const masViejo = dias[dias.length - 1]?.fecha ?? null
  // Seeded from the artifact on mount: a retry remounts this view and lands back on the
  // newest day instead of keeping a selection the new artifact may not carry.
  const [elegido, setElegido] = useState<string | null>(masNuevo)
  const fecha = elegido ?? masNuevo
  const porFecha = new Map(dias.map((d) => [d.fecha, d]))
  const momento = formatMoment(artifact.generado)

  return (
    <>
      {source === 'cache' ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 rounded-xl border border-border bg-surface-raised px-4 py-3 text-xs text-text-secondary"
        >
          {COPY.cached}
        </p>
      ) : null}
      {fecha === null ? (
        <p className="mt-6 text-sm text-text-secondary">{COPY.emptyWindow}</p>
      ) : (
        <>
          <DayNav
            label={dayLabel(fecha, now())}
            canPrev={masViejo !== null && fecha > masViejo}
            canNext={masNuevo !== null && fecha < masNuevo}
            onPrev={() => setElegido(shiftDay(fecha, -1))}
            onNext={() => setElegido(shiftDay(fecha, 1))}
          />
          {momento === null ? (
            <p className="mt-1 text-center text-[11px] text-text-muted">
              {COPY.actualizadoDesconocido}
            </p>
          ) : (
            <p className="mt-1 text-center text-[11px] text-text-muted">
              {COPY.actualizado(momento)}
            </p>
          )}
          <DayBlock fecha={fecha} day={porFecha.get(fecha) ?? null} onAdd={onAdd} />
        </>
      )}
    </>
  )
}

function NoticeView({
  title,
  hint,
  onRetry,
  alert = false,
}: {
  title: string
  hint?: string
  onRetry?: () => void
  alert?: boolean
}) {
  return (
    <div
      role={alert ? 'alert' : 'status'}
      aria-live={alert ? 'assertive' : 'polite'}
      className="mt-6 rounded-2xl border border-border bg-surface-raised px-5 py-8 text-center"
    >
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-xs text-sm text-text-secondary">{hint}</p> : null}
      {onRetry ? (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          {COPY.reintentar}
        </Button>
      ) : null}
    </div>
  )
}

export default function CambiosPage({
  loadFn = loadCatalogChanges,
  now = () => new Date(),
}: CambiosPageProps) {
  const lista = useList()
  const [state, setState] = useState<ScreenState>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ phase: 'loading' })
    // The loader returns a discriminated result and never throws; the catch is
    // the last guard so a bug can never leave the spinner as the final state.
    Promise.resolve()
      .then(loadFn)
      .then((result) => {
        if (cancelled) return
        if (result.status === 'ready') {
          setState({ phase: 'ready', artifact: result.artifact, source: result.source })
        } else {
          setState({ phase: result.status })
        }
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [loadFn, attempt])

  const retry = () => setAttempt((n) => n + 1)

  /**
   * Adds the product to the same list the detail screen writes to, then says what happened and
   * offers the way back. Undo restores the state the item had BEFORE the press — removed if it
   * was new, previous quantity if it was already there — because "Deshacer" that drops an item
   * the user had before the press would be a second, unreported change.
   */
  const onAdd = (producto: { ean: string | null; nombre: string }) => {
    const ean = usableEan(producto.ean ?? undefined)
    if (!ean) return
    const previo = lista.items.find((i) => i.ean === ean)
    lista.add(ean, producto.nombre)
    toast(previo ? COPY.ahoraTenes(previo.cantidad + 1) : COPY.agregado, {
      description: producto.nombre,
      action: {
        label: COPY.deshacer,
        onClick: () =>
          previo ? lista.setCantidad(ean, previo.cantidad) : lista.remove(ean),
      },
    })
  }

  // The DOM state is explicit per honest outcome: `ready` (fresh) and `cached`
  // (offline fallback) are the same loader status with different truths.
  const stateAttr =
    state.phase === 'ready' && state.source === 'cache' ? 'cached' : state.phase

  return (
    <main
      className="safe-top mx-auto w-full max-w-lg px-4 pb-8"
      data-changes-state={stateAttr}
    >
      <Brand />
      <h2 className="mt-6 text-lg font-semibold text-text-primary">{COPY.titulo}</h2>

      {state.phase === 'loading' ? <LoadingView /> : null}
      {state.phase === 'ready' ? (
        <ReadyView artifact={state.artifact} source={state.source} now={now} onAdd={onAdd} />
      ) : null}
      {state.phase === 'absent' ? (
        <NoticeView title={COPY.absent} hint={COPY.absentHint} />
      ) : null}
      {state.phase === 'invalid' ? (
        <NoticeView title={COPY.invalid} hint={COPY.invalidHint} />
      ) : null}
      {state.phase === 'offline' ? (
        <NoticeView title={COPY.offline} hint={COPY.offlineHint} onRetry={retry} />
      ) : null}
      {state.phase === 'error' ? (
        <NoticeView title={COPY.error} hint={COPY.errorHint} onRetry={retry} alert />
      ) : null}
    </main>
  )
}
