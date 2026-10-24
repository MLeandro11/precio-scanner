/**
 * historial — tipos, loader y reconstrucción de la serie de precios de un producto.
 *
 * El artefacto (`data/historial.json`) lo publica el pipeline: un bucket por día con
 * una fila `{ean, precio}` por cada EAN cuyo precio cambió ese día. La serie se
 * **reconstruye hacia atrás**: cada fila es un punto, y el precio de hoy (que la app
 * ya conoce por el catálogo) cierra la serie.
 *
 * Estrategia de carga: exactamente la del artefacto de cambios — network-first con
 * `cache: 'no-cache'` y la última copia de la Cache API como fallback offline,
 * **nunca** con `?v=` (el prune diario borraría la clave y la bajaría de nuevo cada
 * día), y **fuera** del camino de arranque: se pide solo cuando la pantalla se monta.
 * La respuesta se valida antes de confiar en ella; nada lanza, el resultado es
 * discriminado y la pantalla lo dibuja tal cual.
 *
 * Todo el I/O es inyectable, así que el módulo se prueba en Node sin red.
 */

import { CACHE_NAME } from './catalogLoader'

/** La versión del artefacto que este build entiende. Otra es ilegible. */
export const HISTORIAL_VERSION = 1

export interface HistorialCambio {
  ean: string
  /** Precio después del cambio de ese día. */
  precio: number
}

export interface HistorialDia {
  fecha: string
  cambios: HistorialCambio[]
}

export interface HistorialArtifact {
  version: number
  generado: string
  dias: HistorialDia[]
}

/** Forma mínima de una entrada de caché (inyectable para tests). */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>
  put(key: string, response: Response): Promise<void>
}

export interface CacheStore {
  open(name: string): Promise<CacheLike>
}

export interface LoaderDeps {
  fetchFn?: typeof fetch
  caches?: CacheStore | null
  baseUrl?: string
}

/**
 * Los desenlaces honestos del loader, los mismos del artefacto de cambios:
 *   - `ready` + `network`: artefacto fresco.
 *   - `ready` + `cache`: sin red, con la última copia conocida.
 *   - `absent`: el pipeline todavía no lo publicó (404 o fallback del SPA).
 *   - `invalid`: presente y ilegible (versión, JSON o forma).
 *   - `offline`: no hay red y no hay copia guardada.
 *   - `error`: el servidor respondió mal (y no fue un 404).
 */
export type HistorialLoadResult =
  | { status: 'ready'; source: 'network' | 'cache'; artifact: HistorialArtifact }
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'offline' }
  | { status: 'error' }

function defaultBaseUrl(): string {
  try {
    return (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  } catch {
    return '/'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `YYYY-MM-DD` y una fecha real del calendario: la misma puerta que aplica el pipeline. */
function isFecha(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

/** Un EAN de la serie: el mismo recorte que usa la lista (dígitos, mínimo 6). */
function isEan(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value) && value.length >= 6
}

function isCambio(value: unknown): value is HistorialCambio {
  if (!isPlainObject(value)) return false
  return isEan(value.ean) && typeof value.precio === 'number' && Number.isFinite(value.precio)
}

function isDia(value: unknown): value is HistorialDia {
  if (!isPlainObject(value)) return false
  if (!isFecha(value.fecha)) return false
  if (!Array.isArray(value.cambios)) return false
  return value.cambios.every(isCambio)
}

/** Valida la forma completa. Devuelve `null` cuando no es utilizable. */
export function parseHistorialArtifact(value: unknown): HistorialArtifact | null {
  if (!isPlainObject(value)) return null
  if (value.version !== HISTORIAL_VERSION) return null
  if (typeof value.generado !== 'string' || !isFecha(value.generado.slice(0, 10))) return null
  if (!Array.isArray(value.dias) || !value.dias.every(isDia)) return null
  return value as unknown as HistorialArtifact
}

function cacheKey(baseUrl: string): string {
  return `${baseUrl}data/historial.json`
}

async function fromCache(caches: CacheStore | null | undefined, key: string): Promise<HistorialArtifact | null> {
  if (!caches) return null
  try {
    const cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(key)
    if (!hit) return null
    return parseHistorialArtifact(await hit.json())
  } catch {
    return null
  }
}

async function toCache(caches: CacheStore | null | undefined, key: string, text: string): Promise<void> {
  if (!caches) return
  try {
    const cache = await caches.open(CACHE_NAME)
    // Un `Response` propio y no el del fetch: el cuerpo ya se leyó para validarlo.
    await cache.put(key, new Response(text, { headers: { 'content-type': 'application/json' } }))
  } catch {
    // Guardar la copia es una comodidad offline: si falla, la pantalla ya tiene el dato.
  }
}

/**
 * Pide el artefacto y lo valida. Nunca lanza y nunca inventa: cada desenlace se
 * nombra, incluido el caso en que el servidor contesta HTML (el fallback del SPA
 * detrás de un 404 del archivo).
 */
export async function loadHistorial(deps: LoaderDeps = {}): Promise<HistorialLoadResult> {
  const baseUrl = deps.baseUrl ?? defaultBaseUrl()
  const key = cacheKey(baseUrl)
  const fetchFn = deps.fetchFn ?? (typeof fetch === 'function' ? fetch : null)
  // `globalThis.caches` explícito: un `const caches` acá se referenciaría a sí mismo
  // en su propio inicializador (y en Node no existe, en el navegador sí existe).
  const cacheStore: CacheStore | null =
    deps.caches ?? ((globalThis as { caches?: CacheStore }).caches ?? null)

  if (!fetchFn) {
    const cached = await fromCache(cacheStore, key)
    return cached ? { status: 'ready', source: 'cache', artifact: cached } : { status: 'offline' }
  }

  let response: Response
  try {
    response = await fetchFn(key, { cache: 'no-cache' })
  } catch {
    const cached = await fromCache(cacheStore, key)
    return cached ? { status: 'ready', source: 'cache', artifact: cached } : { status: 'offline' }
  }

  if (response.status === 404) return { status: 'absent' }
  if (!response.ok) return { status: 'error' }

  const text = await response.text().catch(() => null)
  if (text === null) return { status: 'error' }

  // Un 200 con HTML es el fallback del SPA: el archivo no está, aunque el status diga
  // que sí. Cualquier OTRA cosa que no sea JSON es basura, no ausencia: se nombra
  // `invalid` para no confundir "no lo publicaron" con "lo publicaron roto".
  if (text.trimStart().startsWith('<')) return { status: 'absent' }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { status: 'invalid' }
  }

  const artifact = parseHistorialArtifact(json)
  if (!artifact) return { status: 'invalid' }

  await toCache(cacheStore, key, text)
  return { status: 'ready', source: 'network', artifact }
}

// ---------------------------------------------------------------------------
// La serie de un producto
// ---------------------------------------------------------------------------

export interface PuntoSerie {
  /** `YYYY-MM-DD` */
  fecha: string
  precio: number
}

export interface Serie {
  ean: string
  /** Del más viejo al más nuevo. */
  puntos: PuntoSerie[]
  /**
   * Tramos entre puntos consecutivos donde pasó más de un día sin dato. No se
   * rellenan: un día sin fila no significa "el precio no cambió" (puede ser una
   * corrida que falló), así que la pantalla los nombra en vez de dibujar una línea
   * que afirme continuidad.
   */
  huecos: Array<{ desde: string; hasta: string }>
}

function dayNumber(fecha: string): number {
  return Math.floor(Date.parse(`${fecha}T00:00:00Z`) / 86_400_000)
}

/**
 * Reconstruye la serie de un EAN a partir del log y del precio de hoy.
 *
 * Reglas:
 *  - Cada fila del log para ese EAN es un punto, con el precio que quedó tras el
 *    cambio de ese día.
 *  - El precio de hoy cierra la serie **solo si aporta algo**: si la última fila ya
 *    es de hoy con ese mismo precio, no se duplica el punto.
 *  - Un producto sin filas y con precio conocido tiene un único punto (hoy): no se
 *    inventa historia hacia atrás.
 *  - Si el log trae dos filas del mismo EAN en la misma fecha (el pipeline ya no lo
 *    produce, pero el loader no confía), gana la última.
 */
export function serieDe(
  ean: string,
  dias: HistorialDia[],
  precioHoy: number | null,
  hoy: string,
): Serie {
  const porFecha = new Map<string, number>()
  for (const dia of dias) {
    const fila = dia.cambios.find((c) => c.ean === ean)
    if (fila) porFecha.set(dia.fecha, fila.precio)
  }

  const puntos: PuntoSerie[] = [...porFecha.entries()]
    .map(([fecha, precio]) => ({ fecha, precio }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  const ultimo = puntos[puntos.length - 1]
  if (precioHoy !== null && Number.isFinite(precioHoy)) {
    if (!ultimo) {
      puntos.push({ fecha: hoy, precio: precioHoy })
    } else if (ultimo.fecha !== hoy || ultimo.precio !== precioHoy) {
      if (ultimo.fecha > hoy) {
        // Un punto del futuro es un artefacto roto, no un dato: no se dibuja.
      } else {
        puntos.push({ fecha: hoy, precio: precioHoy })
      }
    }
  }

  const huecos: Array<{ desde: string; hasta: string }> = []
  for (let i = 1; i < puntos.length; i++) {
    const anterior = puntos[i - 1]!
    const actual = puntos[i]!
    if (dayNumber(actual.fecha) - dayNumber(anterior.fecha) > 1) {
      huecos.push({ desde: anterior.fecha, hasta: actual.fecha })
    }
  }

  return { ean, puntos, huecos }
}

export interface Variacion {
  /** Diferencia absoluta entre el primer y el último punto. */
  absoluta: number
  /** Porcentaje firmado; `null` cuando el primer precio es 0 (no hay base para dividir). */
  pct: number | null
}

/** La variación entre el primer y el último punto de la serie; `null` con menos de dos. */
export function variacionDe(puntos: PuntoSerie[]): Variacion | null {
  if (puntos.length < 2) return null
  const primero = puntos[0]!.precio
  const ultimo = puntos[puntos.length - 1]!.precio
  return {
    absoluta: ultimo - primero,
    pct: primero === 0 ? null : ((ultimo - primero) / primero) * 100,
  }
}
