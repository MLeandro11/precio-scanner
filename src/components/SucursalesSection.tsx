import type { ReactNode } from 'react'
import { useUbicacion } from '../hooks/useUbicacion'
import { useSucursalesCerca } from '../hooks/useSucursalesCerca'
import type { PreciosClarosClient } from '../lib/preciosClaros/client'
import type { SucursalPrecio } from '../lib/preciosClaros/map'
import { formatPrice } from './ProductCard'
import Button from './ui/Button'

interface SucursalesSectionProps {
  /** A usable EAN (the caller already validated length). */
  ean: string
  /** Injectable for tests; forwarded to useSucursalesCerca. */
  client?: PreciosClarosClient
}

/** The table never lists more than this many branches; the rest is summarized. */
const MAX_ROWS = 8

/**
 * Every user-facing string in one place. The visible JSX and the screen-reader
 * announcement both read from here, so the two can never drift apart.
 */
const COPY = {
  titulo: 'Precios en sucursales cercanas',
  explicacion: 'Usamos tu ubicación para buscar sucursales cerca tuyo. No la guardamos.',
  cta: 'Ver precios cerca mío',
  unsupported: 'Tu navegador no puede darnos la ubicación.',
  requesting: 'Pidiendo tu ubicación…',
  denied: 'Activá la ubicación para ver precios por sucursal.',
  ubicacionError: 'No pudimos obtener tu ubicación.',
  loading: 'Buscando precios…',
  dataError: 'No pudimos traer los precios ahora.',
  sinPrecio: 'No hay precio informado para este producto.',
  sinDatos: 'Nadie informa este código.',
  reintentar: 'Reintentar',
  /** Visible-only summary shown when the list is capped. */
  resumenCortado: (visibles: number, total: number) =>
    `Mostrando las ${visibles} más baratas de ${total}.`,
  /**
   * Announcement-only: a short count of the branches the user can actually see
   * (the capped list length), never the raw total behind the summary line.
   */
  conPrecios: (n: number) => `Encontramos ${n} sucursales con precio.`,
} as const

/** Distance for display: the API's own text, or a km fallback from the number. */
function formatDistancia(sucursal: SucursalPrecio): string | null {
  if (sucursal.distanciaDescripcion) return sucursal.distanciaDescripcion
  if (sucursal.distanciaNumero === null) return null
  return `${sucursal.distanciaNumero.toLocaleString('es-AR', {
    maximumFractionDigits: 1,
  })} km`
}

/** The best available location line: address, then locality, then province. */
function lineaSecundaria(sucursal: SucursalPrecio): string | null {
  return sucursal.direccion ?? sucursal.localidad ?? sucursal.provincia
}

function SucursalRow({ sucursal }: { sucursal: SucursalPrecio }) {
  const principal = sucursal.banderaDescripcion ?? sucursal.sucursalNombre
  // The banner already carries the name when it exists; the branch name is then
  // the secondary line so both stay visible without a third column.
  const secundario = sucursal.banderaDescripcion ? sucursal.sucursalNombre : null
  const linea = lineaSecundaria(sucursal)
  const distancia = formatDistancia(sucursal)

  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">
        {principal ? (
          <p className="text-sm font-medium text-text-primary">
            {principal}
            {secundario ? <span className="ml-1.5 text-text-secondary">{secundario}</span> : null}
          </p>
        ) : null}
        {linea ? <p className="truncate text-xs text-text-muted">{linea}</p> : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="tnum text-sm font-bold text-text-primary">{formatPrice(sucursal.precio)}</p>
        {distancia ? <p className="text-xs text-text-secondary">{distancia}</p> : null}
      </div>
    </li>
  )
}

/**
 * SucursalesSection — the two-step "precios por sucursal" flow inside the
 * product-detail price card.
 *
 * The whole point is that mounting it asks the user for NOTHING: the location
 * request only happens on the tap (`useUbicacion` never calls
 * `getCurrentPosition` on mount) and the fetch is gated by the resulting
 * coordinates (`useSucursalesCerca` stays idle until they exist). The tap is the
 * single trigger; clearing the coords on the next attempt is what re-runs the
 * gated fetch after a failure.
 *
 * Ordering and distance are the entire message: the list arrives price-ascending
 * from `mapSucursales` and is rendered as-is. There is deliberately no "más
 * barato" badge, no delta and no saving figure — the project removed the delta
 * concept because mixing "cheapest" with "nearest" measured as misleading.
 */
export default function SucursalesSection({ ean, client }: SucursalesSectionProps) {
  const ubicacion = useUbicacion()
  const sucursalesCerca = useSucursalesCerca({ ean, coords: ubicacion.coords, client })
  const request = ubicacion.request

  let contenido: ReactNode = null
  // The announcement mirrors the visible result: the in-flight states speak
  // while they are up, and every terminal state speaks its own outcome. A live
  // region on the replaced loading paragraph would be torn down with it, so the
  // result would never be announced at all.
  let anuncio = ''

  if (ubicacion.status === 'unsupported') {
    // 'unsupported' is decided at tap time (the browser may lose the API), so
    // there is no button to offer and nothing to retry.
    anuncio = COPY.unsupported
    contenido = (
      <p className="mt-2 text-sm text-text-secondary">{COPY.unsupported}</p>
    )
  } else if (ubicacion.status === 'idle') {
    // Nothing to announce on first paint: the CTA is reachable by navigation.
    contenido = (
      <>
        <p className="mt-2 text-sm text-text-secondary">{COPY.explicacion}</p>
        <Button variant="primary" className="mt-3" onClick={request}>
          {COPY.cta}
        </Button>
      </>
    )
  } else if (ubicacion.status === 'requesting') {
    anuncio = COPY.requesting
    contenido = <p className="mt-2 text-sm text-text-secondary">{COPY.requesting}</p>
  } else if (ubicacion.status === 'denied') {
    // v1 scope: a denial is final (the browser will not re-prompt), so no retry.
    anuncio = COPY.denied
    contenido = <p className="mt-2 text-sm text-text-secondary">{COPY.denied}</p>
  } else if (ubicacion.status === 'error') {
    // A transient environment failure IS retryable, unlike a denial.
    anuncio = COPY.ubicacionError
    contenido = (
      <>
        <p className="mt-2 text-sm text-text-secondary">{COPY.ubicacionError}</p>
        <Button variant="secondary" className="mt-3" onClick={request}>
          {COPY.reintentar}
        </Button>
      </>
    )
  } else if (sucursalesCerca.status === 'idle' || sucursalesCerca.status === 'loading') {
    anuncio = COPY.loading
    contenido = <p className="mt-2 text-sm text-text-secondary">{COPY.loading}</p>
  } else if (sucursalesCerca.status === 'error') {
    // The gated fetch has no trigger of its own: asking for the location again
    // is the only way to re-run it.
    anuncio = COPY.dataError
    contenido = (
      <>
        <p className="mt-2 text-sm text-text-secondary">{COPY.dataError}</p>
        <Button variant="secondary" className="mt-3" onClick={request}>
          {COPY.reintentar}
        </Button>
      </>
    )
  } else if (sucursalesCerca.estado === 'sin-precio') {
    anuncio = COPY.sinPrecio
    contenido = <p className="mt-2 text-sm text-text-secondary">{COPY.sinPrecio}</p>
  } else if (sucursalesCerca.estado === 'sin-datos') {
    // ~40% of the local catalog: a normal, calm answer — never an error state.
    anuncio = COPY.sinDatos
    contenido = <p className="mt-2 text-sm text-text-secondary">{COPY.sinDatos}</p>
  } else if (sucursalesCerca.estado === 'con-precios') {
    const visibles = sucursalesCerca.sucursales.slice(0, MAX_ROWS)
    anuncio = COPY.conPrecios(visibles.length)
    contenido = (
      <>
        <ul className="mt-2">
          {visibles.map((sucursal) => (
            <SucursalRow key={sucursal.clave} sucursal={sucursal} />
          ))}
        </ul>
        {sucursalesCerca.sucursales.length > MAX_ROWS ? (
          <p className="mt-2 text-xs text-text-muted">
            {COPY.resumenCortado(MAX_ROWS, sucursalesCerca.sucursales.length)}
          </p>
        ) : null}
      </>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <h2 className="text-xs text-text-secondary">{COPY.titulo}</h2>
      {/* The single live region: always mounted, in every state, so the result
          is announced instead of being lost with the replaced loading line. */}
      <p aria-live="polite" className="sr-only">
        {anuncio}
      </p>
      {contenido}
    </div>
  )
}
