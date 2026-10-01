/**
 * mapSucursales — pure DTO → view model for the product-detail branch table.
 *
 * No network, no React: this is the whole reason the branch comparison can be
 * tested in plain Node against the recorded fixtures.
 *
 * Rules (verified contract + acceptance criteria):
 *   - A branch is kept only when it has a usable `preciosProducto.precioLista`
 *     (finite number). Branches with `message` and no price are dropped, never
 *     rendered as `$0`.
 *   - The branch key is `${comercioId}-${banderaId}-${id}` (e.g. `15-1-454`).
 *   - Ordering is by PRICE ascending, not by distance. Distance is carried for
 *     display, never used as the primary sort. Ties fall back to distance
 *     ascending (the API already returns branches nearest-first, so the
 *     all-equal case stays useful by distance); a complete tie keeps the API's
 *     source order via the stable sort.
 *   - No delta is computed, deliberately. `precio - min(precio)` over the page
 *     mixes "cheapest anywhere" with "near you": measured on the Río Gallegos
 *     fixture, the 10 in-city branches would carry a $250 delta against a
 *     branch 260 km away (Río Grande). Decision 2026-10-01: the core exposes no
 *     saving figure. If a savings number is ever needed it must be re-anchored
 *     to a radius or a city, and named for that.
 */
import { precioListaNumerico } from './schema'
import type { ProductoResponse, SucursalDto } from './schema'

export interface SucursalPrecio {
  /** `${comercioId}-${banderaId}-${id}`. */
  clave: string
  /** Argentine pesos, same unit as the local catalog. */
  precio: number
  banderaDescripcion: string | null
  sucursalNombre: string | null
  direccion: string | null
  localidad: string | null
  provincia: string | null
  distanciaNumero: number | null
  distanciaDescripcion: string | null
  actualizadoHoy: boolean | null
  lat: string | null
  lng: string | null
}

/** Builds the branch key used by the API's own `array_sucursales`. */
export function composeClave(
  sucursal: Pick<SucursalDto, 'comercioId' | 'banderaId' | 'id'>,
): string {
  return `${sucursal.comercioId ?? ''}-${sucursal.banderaId ?? ''}-${sucursal.id ?? ''}`
}

function textoODefecto(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function distancia(sucursal: SucursalDto): number | null {
  return typeof sucursal.distanciaNumero === 'number' &&
    Number.isFinite(sucursal.distanciaNumero)
    ? sucursal.distanciaNumero
    : null
}

function aSucursalPrecio(sucursal: SucursalDto, precio: number): SucursalPrecio {
  return {
    clave: composeClave(sucursal),
    precio,
    banderaDescripcion: textoODefecto(sucursal.banderaDescripcion),
    sucursalNombre: textoODefecto(sucursal.sucursalNombre),
    direccion: textoODefecto(sucursal.direccion),
    localidad: textoODefecto(sucursal.localidad),
    provincia: textoODefecto(sucursal.provincia),
    distanciaNumero: distancia(sucursal),
    distanciaDescripcion: textoODefecto(sucursal.distanciaDescripcion),
    actualizadoHoy:
      typeof sucursal.actualizadoHoy === 'boolean' ? sucursal.actualizadoHoy : null,
    lat: sucursal.lat === undefined || sucursal.lat === null ? null : String(sucursal.lat),
    lng: sucursal.lng === undefined || sucursal.lng === null ? null : String(sucursal.lng),
  }
}

function comparar(a: SucursalPrecio, b: SucursalPrecio): number {
  if (a.precio !== b.precio) return a.precio - b.precio
  const da = a.distanciaNumero ?? Number.POSITIVE_INFINITY
  const db = b.distanciaNumero ?? Number.POSITIVE_INFINITY
  if (da !== db) return da - db
  // Complete tie (same price, same/absent distance): keep the API's order.
  // `Array.prototype.sort` is stable, so this preserves the source sequence
  // (nearest-first for lat/lng, caller order for array_sucursales).
  return 0
}

/**
 * Maps the full response to the priced branches, cheapest first. Returns `[]`
 * for an unknown EAN, for a response with no branches, or when branches exist
 * but none carries a usable price.
 */
export function mapSucursales(
  response: ProductoResponse | null | undefined,
): SucursalPrecio[] {
  const dtos = response?.sucursales ?? []
  const conPrecio: Array<{ dto: SucursalDto; precio: number }> = []
  for (const dto of dtos) {
    const precio = precioListaNumerico(dto)
    if (precio !== null) conPrecio.push({ dto, precio })
  }
  if (conPrecio.length === 0) return []

  return conPrecio
    .map(({ dto, precio }) => aSucursalPrecio(dto, precio))
    .sort(comparar)
}
