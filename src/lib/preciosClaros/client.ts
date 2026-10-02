/**
 * client — typed, injectable fetch for Precios Claros (SEPA) `/prod/producto`.
 *
 * Verified contract + repo conventions:
 *   - The query needs `id_producto` PLUS exactly one selector: `lat`+`lng` or
 *     `array_sucursales`. `limit` (max 50) and `offset` paginate.
 *   - The `status` inside the JSON body is authoritative: an HTTP 200 can carry
 *     `status: 400`. When the body status is not 200 this client throws a typed
 *     error and returns no data. `fetch` itself is never asked to retry
 *     (`searchSession.ts` convention): a network failure just resolves to a
 *     typed error and the caller keeps showing the local price.
 *   - `AbortSignal.timeout` bounds the request; no retry, no backoff.
 *
 * `fetchImpl` is injectable so the tests run in plain Node with no network.
 */
import type { ProductoResponse } from './schema'

export const PRECIOS_CLAROS_BASE_URL = 'https://d3e6htiiul5ek9.cloudfront.net'
export const PRODUCTO_PATH = '/prod/producto'
/** Documented API cap. */
export const MAX_LIMIT_PERMITIDO = 50
export const DEFAULT_LIMIT = MAX_LIMIT_PERMITIDO
export const DEFAULT_OFFSET = 0
export const DEFAULT_TIMEOUT_MS = 10_000

export type PreciosClarosErrorKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'body-status'
  | 'invalid-body'
  | 'invalid-request'

/** One typed failure for every way the request can fail. */
export class PreciosClarosError extends Error {
  readonly kind: PreciosClarosErrorKind
  /** HTTP status or in-body status, when the failure carried one. */
  readonly status?: number

  constructor(kind: PreciosClarosErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'PreciosClarosError'
    this.kind = kind
    this.status = status
  }
}

/** Minimal shape the client needs from a response (keeps `fetch` injectable). */
export interface HttpResponseLike {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<HttpResponseLike>

/** Near-or-explicit branches around a point, or an explicit branch list. */
export type SucursalSelector =
  | { lat: number; lng: number }
  | { sucursales: string[] }

export interface ProductoQuery {
  /** EAN of the product. */
  idProducto: string
  selector: SucursalSelector
  limit?: number
  offset?: number
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init)

/**
 * Builds the request URL. Pure and exported so the query shape is testable on
 * its own. `limit`/`offset` are always present (defaults 50 / 0).
 */
export function buildProductoUrl(
  query: ProductoQuery,
  baseUrl: string = PRECIOS_CLAROS_BASE_URL,
): string {
  if (!query.idProducto) {
    throw new PreciosClarosError('invalid-request', 'Falta id_producto.')
  }
  const url = new URL(PRODUCTO_PATH, baseUrl)
  const params = url.searchParams
  params.set('id_producto', query.idProducto)

  const selector = query.selector
  if (selector && 'lat' in selector && 'lng' in selector) {
    params.set('lat', String(selector.lat))
    params.set('lng', String(selector.lng))
  } else if (selector && 'sucursales' in selector) {
    params.set('array_sucursales', selector.sucursales.join(','))
  } else {
    // The API answers "error 1" without a selector; fail before spending a request.
    throw new PreciosClarosError(
      'invalid-request',
      'Falta el selector: lat/lng o array_sucursales.',
    )
  }

  params.set('limit', String(query.limit ?? DEFAULT_LIMIT))
  params.set('offset', String(query.offset ?? DEFAULT_OFFSET))
  return url.toString()
}

export interface PreciosClarosClient {
  fetchProducto(query: ProductoQuery): Promise<ProductoResponse>
}

export interface PreciosClarosClientOptions {
  fetchImpl?: FetchLike
  baseUrl?: string
  timeoutMs?: number
}

export function createPreciosClarosClient(
  options: PreciosClarosClientOptions = {},
): PreciosClarosClient {
  const fetchImpl = options.fetchImpl ?? defaultFetch
  const baseUrl = options.baseUrl ?? PRECIOS_CLAROS_BASE_URL
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async fetchProducto(query: ProductoQuery): Promise<ProductoResponse> {
      const url = buildProductoUrl(query, baseUrl)

      let response: HttpResponseLike
      try {
        response = await fetchImpl(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { Accept: 'application/json' },
        })
      } catch (err) {
        if (err instanceof PreciosClarosError) throw err
        const name = err instanceof Error ? err.name : ''
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new PreciosClarosError(
            'timeout',
            `La consulta a Precios Claros superó el límite de ${timeoutMs} ms.`,
          )
        }
        throw new PreciosClarosError('network', 'No se pudo contactar a Precios Claros.')
      }

      if (!response.ok) {
        throw new PreciosClarosError(
          'http',
          `Precios Claros respondió con HTTP ${response.status}.`,
          response.status,
        )
      }

      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new PreciosClarosError(
          'invalid-body',
          'La respuesta de Precios Claros no es JSON válido.',
        )
      }

      const status =
        body !== null && typeof body === 'object'
          ? (body as { status?: unknown }).status
          : undefined
      if (typeof status !== 'number') {
        throw new PreciosClarosError(
          'invalid-body',
          'La respuesta de Precios Claros no trae un status numérico.',
        )
      }
      if (status !== 200) {
        throw new PreciosClarosError(
          'body-status',
          `Precios Claros devolvió status ${status} dentro de una respuesta HTTP ${response.status}.`,
          status,
        )
      }
      return body as ProductoResponse
    },
  }
}
