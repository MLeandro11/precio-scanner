import type { ProductoLite } from './catalog-diff'

/**
 * El log **acumulativo** de cambios de precio, por día, que hace posible el
 * historial de cada producto sin publicar los snapshots completos.
 *
 * La razón de existir es de peso: el catálogo entero pesa ~3.300 KB por corrida y
 * el diff diario ~8 KB. Una serie por EAN se sirve mejor con un log de cambios que
 * con treinta copias del catálogo. Acumular es lo que pidió el usuario ("todo lo
 * que haya, sin recorte"), así que **nada se recorta**: cada día que corre queda.
 *
 * La forma: un bucket por fecha (`YYYY-MM-DD`, el día UTC de la extracción) con las
 * filas `{ean, precio}` de los EAN cuyo precio **cambió** ese día, más los EAN que
 * aparecieron por primera vez (su punto inicial). `precio` es el valor **después**
 * del cambio, que es lo que permite reconstruir la serie hacia atrás desde el
 * precio de hoy.
 *
 * Módulo puro: no toca el filesystem ni lee el reloj, igual que
 * `catalog-changes.ts`. La lectura y la escritura son del pipeline.
 */

export const HISTORIAL_VERSION = 1 as const

export interface HistorialCambio {
  ean: string
  /** Precio después del cambio del día. */
  precio: number
}

export interface HistorialDia {
  /** `YYYY-MM-DD`, el día UTC de la extracción. */
  fecha: string
  cambios: HistorialCambio[]
}

/** La forma congelada de `public/data/historial.json`. */
export interface HistorialArtifact {
  version: typeof HISTORIAL_VERSION
  generado: string
  dias: HistorialDia[]
}

export type HistorialPrevious =
  | { ok: true; artifact: HistorialArtifact }
  | { ok: false; reason: string }

export interface BuildHistorialInput {
  /** El catálogo normalizado de ayer, o `null` en la primera carga. */
  previous: ProductoLite[] | null
  /** El catálogo recién normalizado. */
  current: ProductoLite[]
  previousArtifact: HistorialPrevious
  /** El momento de la extracción (`raw.generada`), la misma fuente que `fecha`. */
  generatedAt: string
}

export interface BuildHistorialResult {
  artifact: HistorialArtifact
  /** `null` cuando el log se continuó; si no, por qué arrancó de nuevo. */
  degraded: string | null
}

/** `YYYY-MM-DD` del momento dado, en UTC. `null` si no es una fecha. */
function utcDay(iso: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().slice(0, 10)
}

function dayNumber(fecha: string): number | null {
  const ms = Date.parse(`${fecha}T00:00:00Z`)
  if (Number.isNaN(ms)) return null
  return Math.floor(ms / 86_400_000)
}

/**
 * El recorte de un EAN, el mismo del cliente y la lista: solo dígitos, mínimo 6.
 * El catálogo del POS trae barcodes que no son códigos (`HG`, `1890X4`, `AM`, `2Q`):
 * esos no tienen serie que anclar y no entran al log.
 */
function isEan(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value) && value.length >= 6
}

/**
 * Valida la forma de un archivo leído del disco, sin confiar en su contenido.
 *
 * Tolerante con una FILA, estricto con el archivo (S5): una fila cuyo barcode no es
 * un EAN se descarta y el log se conserva entero. Rechazar el baseline por una fila
 * de basura lo reiniciaría, y el log es acumulativo (R4): reiniciarlo borra la
 * historia. Un archivo estructuralmente roto (no-objeto, versión, `dias`, fecha de
 * un día, precio no finito) sigue reportándose igual que antes.
 */
export function parseHistorialArtifact(
  value: unknown,
): { ok: true; artifact: HistorialArtifact } | { ok: false; reason: string } {
  // `null` es la AUSENCIA del archivo, no un objeto malformado: el pipeline decide
  // distinto en cada caso (degradar o fallar), así que no se pueden confundir.
  if (value === null || value === undefined) return { ok: false, reason: 'absent' }
  if (typeof value !== 'object') return { ok: false, reason: 'not-an-object' }
  const raw = value as Record<string, unknown>
  if (raw.version !== HISTORIAL_VERSION) return { ok: false, reason: 'unknown-version' }
  if (typeof raw.generado !== 'string') return { ok: false, reason: 'missing-generado' }
  if (!Array.isArray(raw.dias)) return { ok: false, reason: 'invalid-shape' }
  const dias: HistorialDia[] = []
  for (const day of raw.dias) {
    if (typeof day !== 'object' || day === null) return { ok: false, reason: 'invalid-shape' }
    const d = day as Record<string, unknown>
    if (typeof d.fecha !== 'string' || dayNumber(d.fecha) === null) {
      return { ok: false, reason: 'invalid-shape' }
    }
    if (!Array.isArray(d.cambios)) return { ok: false, reason: 'invalid-shape' }
    const cambios: HistorialCambio[] = []
    for (const cambio of d.cambios) {
      if (typeof cambio !== 'object' || cambio === null) return { ok: false, reason: 'invalid-shape' }
      const c = cambio as Record<string, unknown>
      if (typeof c.ean !== 'string' || !c.ean) return { ok: false, reason: 'invalid-shape' }
      if (typeof c.precio !== 'number' || !Number.isFinite(c.precio)) {
        return { ok: false, reason: 'invalid-shape' }
      }
      // La fila mala se descarta; el día (y el archivo) se conservan.
      if (!isEan(c.ean)) continue
      cambios.push({ ean: c.ean, precio: c.precio })
    }
    dias.push({ fecha: d.fecha, cambios })
  }
  return {
    ok: true,
    artifact: {
      version: HISTORIAL_VERSION,
      generado: raw.generado,
      dias,
    },
  }
}

/** La clave de identidad de una fila, la misma de la lista: el EAN. */
function eanKey(producto: ProductoLite): string | null {
  const ean = typeof producto.barcode === 'string' ? producto.barcode.trim() : ''
  return isEan(ean) ? ean : null
}

/**
 * Las filas de hoy: todo EAN cuyo precio difiere del catálogo anterior, más los
 * que aparecieron por primera vez. Un EAN sin código no entra (no hay serie que
 * anclar a un producto).
 */
function cambiosDeHoy(previous: ProductoLite[] | null, current: ProductoLite[]): HistorialCambio[] {
  const antes = new Map<string, number>()
  for (const p of previous ?? []) {
    const ean = eanKey(p)
    if (ean) antes.set(ean, p.precio)
  }

  // **Un punto por EAN y por día**, aunque el catálogo repita el código (pasa:
  // el mismo EAN en dos registros con distinto id). Si dos registros del mismo EAN
  // discrepan en precio, gana el último: es una regla determinista, no un empate
  // silencioso, y el archivo no crece con filas duplicadas.
  const porEan = new Map<string, number>()
  for (const p of current) {
    const ean = eanKey(p)
    if (!ean) continue
    const previo = antes.get(ean)
    // Primera aparición (previo === undefined) o precio distinto: es un punto.
    if (previo === undefined || previo !== p.precio || porEan.has(ean)) porEan.set(ean, p.precio)
  }
  // Determinista: el orden del archivo no puede depender del orden del catálogo.
  return [...porEan.entries()]
    .map(([ean, precio]) => ({ ean, precio }))
    .sort((a, b) => a.ean.localeCompare(b.ean))
}

/**
 * Construye el artefacto. `previousArtifact` trae los días viejos; **hoy siempre se
 * reconstruye** (idempotente por fecha, no por corrida), y los días futuros se
 * descartan. Nada más se recorta: el log es acumulativo por decisión (`S2`).
 */
export function buildHistorialArtifact(input: BuildHistorialInput): BuildHistorialResult {
  const fecha = utcDay(input.generatedAt)
  if (fecha === null) {
    throw new TypeError(`generatedAt no es una fecha: ${input.generatedAt}`)
  }

  const hoy: HistorialDia = { fecha, cambios: cambiosDeHoy(input.previous, input.current) }
  const hoyNumber = dayNumber(fecha)!

  let degraded: string | null = null
  const anteriores: HistorialDia[] = []

  if (input.previous === null) {
    // Sin catálogo anterior no hay diff posible: el log arranca hoy. No se
    // inventan puntos para los días que no se vieron.
    degraded = 'first-load'
  } else if (!input.previousArtifact.ok) {
    degraded = input.previousArtifact.reason
  } else {
    const seen = new Set<string>([fecha])
    for (const day of input.previousArtifact.artifact.dias) {
      const n = dayNumber(day.fecha)
      if (n === null || n > hoyNumber) continue
      if (seen.has(day.fecha)) continue
      seen.add(day.fecha)
      anteriores.push(day)
    }
  }

  const dias = [hoy, ...anteriores].sort((a, b) => b.fecha.localeCompare(a.fecha))

  return {
    artifact: { version: HISTORIAL_VERSION, generado: input.generatedAt, dias },
    degraded,
  }
}
