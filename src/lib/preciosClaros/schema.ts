/**
 * Response types and defensive validation for the Precios Claros (SEPA)
 * `GET /prod/producto` endpoint.
 *
 * Verified contract (read-only spike, 2026-10-01):
 *   - The price lives in `sucursales[].preciosProducto.precioLista`, NOT in a
 *     flat `precio` field.
 *   - A branch that does not carry the product still appears in `sucursales[]`,
 *     with `message: "La sucursal no contiene el producto."` and no price. That
 *     is a normal branch, not an error.
 *   - An unknown EAN answers HTTP 200 with `producto: { msg: "Producto
 *     inexistente." }`, `total: 0` and `sucursales: []` — again, not an error.
 *   - `precioLista` is a number in Argentine pesos (same unit as the local
 *     catalog, so no conversion). Anything that is not a finite number
 *     (missing, `null`, `""`, `NaN`) is unusable: it must never be read as `0`.
 *   - `total` is the NATIONAL count of branches carrying the product; it is not
 *     the number of branches in `sucursales[]` (paginated by `limit`).
 */

/** `preciosProducto` block. Every sibling of `precioLista` measured empty. */
export interface PreciosProductoDto {
  precioLista?: unknown
  precio_unitario_con_iva?: unknown
  precio_unitario_sin_iva?: unknown
  precio_bulto_con_iva?: unknown
  precio_bulto_sin_iva?: unknown
  promo1?: unknown
  promo2?: unknown
}

/**
 * One branch entry. `id`, `comercioId` and `banderaId` come loose here; the
 * keyword for a branch is the composed `${comercioId}-${banderaId}-${id}`.
 * They are typed `string | number` because the API returns them in both shapes
 * (e.g. the "no contiene el producto" branch sends `comercioId`/`banderaId` as
 * strings). `lat`/`lng` are strings in the payload.
 */
export interface SucursalDto {
  id?: string | number
  comercioId?: string | number
  banderaId?: string | number
  banderaDescripcion?: string
  comercioRazonSocial?: string
  sucursalNombre?: string
  sucursalTipo?: string
  direccion?: string
  localidad?: string
  provincia?: string
  lat?: string | number
  lng?: string | number
  distanciaNumero?: number
  distanciaDescripcion?: string
  actualizadoHoy?: boolean
  preciosProducto?: PreciosProductoDto | null
  /** Present when the branch does not carry the product. */
  message?: string
}

export interface ProductoDto {
  id?: string
  nombre?: string
  marca?: string
  presentacion?: string
  /** e.g. "Producto inexistente." on an unknown EAN. */
  msg?: string
}

export interface ProductoResponse {
  /** The authoritative status: an HTTP 200 can carry `status: 400` in the body. */
  status?: number
  /** National branch count, independent of `limit`. */
  total?: number
  producto?: ProductoDto | null
  /** Documented cap: 50. `limit` above it is rejected by the API. */
  maxLimitPermitido?: number
  /** Echoes the requested `limit`; it is NOT a page count. */
  totalPagina?: number
  sucursalesConProducto?: number
  sucursales?: SucursalDto[]
}

/**
 * The single gate for a usable price. `NaN`, `Infinity`, strings, `null` and
 * `undefined` all fail; only a finite `number` passes. This is what keeps
 * `""`, `null` or `NaN` from ever becoming `0`.
 */
export function esPrecioValido(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Reads `preciosProducto.precioLista` defensively. Returns the number, or
 * `null` when the branch has no usable price (missing product, empty string,
 * null, NaN). Never coerces to `0`.
 */
export function precioListaNumerico(sucursal: SucursalDto | null | undefined): number | null {
  const raw = sucursal?.preciosProducto?.precioLista
  return esPrecioValido(raw) ? raw : null
}

/**
 * True when the API says the product itself does not exist
 * (`producto.msg: "Producto inexistente."`). That maps to the `sin-datos`
 * state, not to an error.
 */
export function tieneMensajeDeProducto(
  response: ProductoResponse | null | undefined,
): boolean {
  const msg = response?.producto?.msg
  return typeof msg === 'string' && msg.trim().length > 0
}
