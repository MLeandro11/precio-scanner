import type { ReactNode } from 'react'
import { useUbicacion } from '../hooks/useUbicacion'
import { useSucursalesCerca } from '../hooks/useSucursalesCerca'
import type { PreciosClarosClient } from '../lib/preciosClaros/client'
import { agruparPorCercania } from '../lib/preciosClaros/cercania'
import type { SucursalPrecio } from '../lib/preciosClaros/map'
import { formatPrice } from './ProductCard'
import Button from './ui/Button'

interface SucursalesSectionProps {
  /** A usable EAN (the caller already validated length). */
  ean: string
  /** Injectable for tests; forwarded to useSucursalesCerca. */
  client?: PreciosClarosClient
}

/** Each group lists at most this many branches; the rest is summarized per group. */
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
  /** Visible-only summary shown when a group is capped. */
  resumenCortado: (visibles: number, total: number) =>
    `Mostrando las ${visibles} más baratas de ${total}.`,
  /** Sub-headings for the two groups (h3, secondary to the section title). */
  enLocalidad: (localidad: string) => `En ${localidad}`,
  otrasCiudades: 'Más baratas en otras ciudades',
  lasMasBaratas: 'Las más baratas',
  /** Honest line when nothing is close enough to call "your city". */
  sinCerca: 'No hay sucursales cerca tuyo.',
  /**
   * Announcement-only: describes the result in one or two grammatical
   * sentences. Counts are the group totals, never silently fewer rows; when a
   * group is capped the announcement also states how many rows are actually
   * shown, because it must not name rows the user cannot see. When the API
   * supplied no distance for any branch, the count is reported without claiming
   * the branches are far.
   */
  conPreciosCerca: (
    cerca: number,
    localidad: string,
    lejos: number,
    mostradosCerca: number,
    mostradosLejos: number,
  ) => {
    const totalCerca = cerca === 1 ? '1 sucursal' : `${cerca} sucursales`
    const totalLejos = lejos === 1 ? '1 más barata' : `${lejos} más baratas`
    const conteo =
      lejos > 0
        ? `Encontramos ${totalCerca} en ${localidad} y ${totalLejos} en otras ciudades.`
        : `Encontramos ${totalCerca} en ${localidad}.`
    const cortes: string[] = []
    if (cerca > mostradosCerca) cortes.push(`${mostradosCerca} de ${localidad}`)
    if (lejos > mostradosLejos) cortes.push(`${mostradosLejos} de otras ciudades`)
    return cortes.length > 0 ? `${conteo} Se muestran ${cortes.join(' y ')}.` : conteo
  },
  conPreciosSinCerca: (lejos: number, mostrados: number, hayDistancia: boolean) => {
    const totalLejos = lejos === 1 ? '1 más barata' : `${lejos} más baratas`
    let conteo: string
    if (!hayDistancia) {
      conteo = `No hay sucursales cerca tuyo. Hay ${totalLejos}, pero no sabemos a qué distancia.`
    } else if (lejos === 1) {
      conteo = `No hay sucursales cerca tuyo. Solo hay ${totalLejos}, y está lejos.`
    } else {
      conteo = `No hay sucursales cerca tuyo. Las ${totalLejos} están lejos.`
    }
    return lejos > mostrados ? `${conteo} Se muestran ${mostrados}.` : conteo
  },
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
 * One group rendered as its own capped `<ul>`. `MAX_ROWS` applies per group, not
 * globally: each group that overflows carries its own visible summary line.
 */
function GrupoLista({ sucursales }: { sucursales: SucursalPrecio[] }) {
  const visibles = sucursales.slice(0, MAX_ROWS)
  return (
    <>
      <ul className="mt-2">
        {visibles.map((sucursal) => (
          <SucursalRow key={sucursal.clave} sucursal={sucursal} />
        ))}
      </ul>
      {sucursales.length > MAX_ROWS ? (
        <p className="mt-2 text-xs text-text-muted">
          {COPY.resumenCortado(MAX_ROWS, sucursales.length)}
        </p>
      ) : null}
    </>
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
 * Ordering and distance are the entire message: within each group the branches
 * keep the price-ascending order from `mapSucursales`, and the user's own city
 * is shown first (the section is titled "cercanas", so a national price ranking
 * was the measured defect). There is deliberately no "más barato" badge, no
 * delta and no saving figure — the project removed the delta concept because
 * mixing "cheapest" with "nearest" measured as misleading.
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
    // The list arrives price-first, so without this split the user's own city
    // would sit below every cheaper branch hundreds of km away. Grouping keeps
    // the price order INSIDE each group and never re-sorts across groups.
    const grupos = agruparPorCercania(sucursalesCerca.sucursales)
    if (grupos.localidad !== null) {
      anuncio = COPY.conPreciosCerca(
        grupos.cerca.length,
        grupos.localidad,
        grupos.lejos.length,
        Math.min(grupos.cerca.length, MAX_ROWS),
        Math.min(grupos.lejos.length, MAX_ROWS),
      )
      contenido = (
        <>
          <h3 className="mt-3 text-[11px] font-medium text-text-secondary">
            {COPY.enLocalidad(grupos.localidad)}
          </h3>
          <GrupoLista sucursales={grupos.cerca} />
          {grupos.lejos.length > 0 ? (
            <>
              <h3 className="mt-3 text-[11px] font-medium text-text-secondary">
                {COPY.otrasCiudades}
              </h3>
              <GrupoLista sucursales={grupos.lejos} />
            </>
          ) : null}
        </>
      )
    } else {
      // Notice the announcement needs to know whether ANY branch carried a
      // distance: with none, the grouping declines to claim a city and the
      // announcement must not assert the branches are far either.
      const hayDistancia = grupos.lejos.some((sucursal) => sucursal.distanciaNumero !== null)
      anuncio = COPY.conPreciosSinCerca(
        grupos.lejos.length,
        Math.min(grupos.lejos.length, MAX_ROWS),
        hayDistancia,
      )
      contenido = (
        <>
          <p className="mt-2 text-sm text-text-secondary">{COPY.sinCerca}</p>
          <h3 className="mt-3 text-[11px] font-medium text-text-secondary">
            {COPY.lasMasBaratas}
          </h3>
          <GrupoLista sucursales={grupos.lejos} />
        </>
      )
    }
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
