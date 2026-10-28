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

/**
 * Valida la forma y **descarta las filas ilegibles** en vez de tirar el archivo.
 *
 * La ley que ordena esto (S5) nació de una medición con el archivo real: 7 de sus
 * 823 filas traen un barcode que no es EAN (`HG`, `AM`, `2Q`, …). Exigir que *todas*
 * las filas fueran válidas devolvía `null` y la pantalla quedaba en "no se pudo
 * leer" para todos los productos. Una fila mala se descarta; el archivo entero se
 * rechaza solo cuando su estructura no es la que este build entiende (versión,
 * fecha de generación, `dias` que no es un arreglo, un día con `fecha` ilegible).
 * Un día cuyo `cambios` no es un arreglo también se descarta, sin lanzar: el resto
 * del log sigue siendo utilizable.
 */
export function parseHistorialArtifact(value: unknown): HistorialArtifact | null {
  if (!isPlainObject(value)) return null
  if (value.version !== HISTORIAL_VERSION) return null
  if (typeof value.generado !== 'string' || !isFecha(value.generado.slice(0, 10))) return null
  if (!Array.isArray(value.dias)) return null

  const dias: HistorialDia[] = []
  for (const dia of value.dias) {
    if (!isPlainObject(dia)) return null
    // Una fecha rota no es una fila mala: es la estructura del archivo la que no se
    // entiende, y ninguna serie puede confiar en sus buckets.
    if (!isFecha(dia.fecha)) return null
    if (!Array.isArray(dia.cambios)) continue
    dias.push({ fecha: dia.fecha, cambios: dia.cambios.filter(isCambio) })
  }

  return { version: HISTORIAL_VERSION, generado: value.generado, dias }
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
   * Días **sin dato** entre dos puntos, como rangos. La distinción es la clave del
   * gráfico: un día con bucket en el artefacto y sin filas para este EAN significa
   * "la corrida pasó y el precio no cambió" (la línea lo cruza), mientras que un día
   * **ausente** del artefacto significa que no hay dato (la línea se corta y el hueco
   * se nombra). Confundirlos pintaba una serie de puntos sueltos.
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
    } else if (ultimo.fecha === hoy) {
      // Mismo día y precios distintos (catálogo cacheado viejo, historial fresco):
      // gana el catálogo, que es la lectura más nueva, y la serie conserva UN punto
      // por fecha — dos puntos en la misma fecha rompen las claves del gráfico y de
      // la lista de movimientos.
      if (ultimo.precio !== precioHoy) ultimo.precio = precioHoy
    } else if (ultimo.fecha < hoy) {
      puntos.push({ fecha: hoy, precio: precioHoy })
    }
    // `ultimo.fecha > hoy`: un punto del futuro es un artefacto roto, no se dibuja.
  }

  // Solo los días que el ARTEFACTO conoce: un bucket vacío es "corrió y no cambió".
  const diasConCorrida = new Set(dias.map((d) => d.fecha))
  const huecos: Array<{ desde: string; hasta: string }> = []
  for (let i = 1; i < puntos.length; i++) {
    const desde = dayNumber(puntos[i - 1]!.fecha)
    const hasta = dayNumber(puntos[i]!.fecha)
    let primeroSinDato: string | null = null
    let ultimoSinDato: string | null = null
    for (let n = desde + 1; n < hasta; n++) {
      const fecha = new Date(n * 86_400_000).toISOString().slice(0, 10)
      if (diasConCorrida.has(fecha)) continue
      if (primeroSinDato === null) primeroSinDato = fecha
      ultimoSinDato = fecha
    }
    if (primeroSinDato !== null && ultimoSinDato !== null) {
      huecos.push({ desde: primeroSinDato, hasta: ultimoSinDato })
    }
  }

  return { ean, puntos, huecos }
}

/**
 * El precio de hoy de un EAN: la **última** fila del catálogo que lo menciona.
 *
 * El catálogo real trae el mismo EAN en varios registros con precios distintos (88
 * casos en la medición del 2026-10-28), así que "cuál precio es el de hoy" necesita
 * una regla determinista. Es la misma que el pipeline aplica al escribir cada día del
 * log: gana la última lectura del catálogo, no el primer registro que aparezca.
 *
 * Devuelve `null` cuando ninguna fila corresponde al EAN — incluyendo el catálogo
 * vacío — para que la serie no invente un punto.
 */
export function precioDeHoy(
  filas: ReadonlyArray<{ barcode: string; precio: number } | null | undefined>,
  ean: string,
): number | null {
  const buscado = ean.replace(/\D/g, '')
  if (!buscado) return null
  let precio: number | null = null
  for (const fila of filas) {
    if (!fila) continue
    if (typeof fila.barcode !== 'string') continue
    if (fila.barcode.replace(/\D/g, '') !== buscado) continue
    if (typeof fila.precio !== 'number' || !Number.isFinite(fila.precio)) continue
    precio = fila.precio
  }
  return precio
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
