#!/usr/bin/env node
/**
 * catalog-changes.ts — the `/cambios` feed artifact, all pure.
 *
 * Builds `catalogo-cambios.json` from three inputs only: the previous
 * normalized catalog, the current one, and the previous artifact (which carries
 * the older days of the rolling window). No `fs`, no `child_process`, no clock:
 * the caller passes the extraction moment in, so the module is unit-testable in
 * plain Node.
 *
 * The artifact contract is frozen (see `odd/tasks/cambios-catalogo.md`,
 * "Contrato congelado del artefacto"):
 *   - `version: 1` is the exit door: a previous artifact with another version is
 *     dropped and the window starts fresh (never a crash).
 *   - The window is rolling: `[hoy] + the previous days still inside it`,
 *     replacing today's entry when it already exists (idempotent by date, not by
 *     run).
 *   - `conteo` is exact and each list is capped at `CAP_DAY`, with `truncado`
 *     saying when rows were left out — the `ListaAcotada` idiom of
 *     `catalog-diff.ts`, but holding objects instead of strings.
 *   - `bajaron` and `subieron` are separate, unsigned lists.
 *   - `ean` comes from a join on `id` against the CURRENT normalized catalog, and
 *     is `null` when the barcode is unusable.
 *   - Nothing here derives from the raw: the inputs are the normalized catalogs,
 *     which carry no `costo`/`margen` (finding H4).
 *
 * Everything the UI shows must exist in this file: nothing is simulated (FR-8.4).
 */
import { usableEan } from '../src/lib/images.ts'
import type { ProductoLite } from './catalog-diff.ts'

/** The artifact contract version. A different one means "start fresh". */
export const CHANGES_VERSION = 1

/** Rolling window length, in days (today plus the six before it). */
export const WINDOW_DAYS = 7

/** Rows kept per list per day; `conteo` still reports the exact total. */
export const CAP_DAY = 200

/** A product that appeared for the first time in today's catalog. */
export interface NewProduct {
  ean: string | null
  nombre: string
  precio: number
}

/** A price that moved between the two catalogs. `pct` is signed. */
export interface PriceMove {
  ean: string | null
  nombre: string
  antes: number
  ahora: number
  pct: number
}

/** A list with the exact count and a bounded tail. Generic over object values. */
export interface BoundedList<T> {
  conteo: number
  truncado: boolean
  valores: T[]
}

export interface ChangeDay {
  /** `YYYY-MM-DD`, the extraction day the changes belong to. */
  fecha: string
  nuevos: BoundedList<NewProduct>
  bajaron: BoundedList<PriceMove>
  subieron: BoundedList<PriceMove>
}

/** The frozen `public/data/catalogo-cambios.json` shape. */
export interface ChangesArtifact {
  version: typeof CHANGES_VERSION
  ventanaDias: number
  generado: string
  dias: ChangeDay[]
}

/**
 * Why a previous artifact could not be used. Every one of these degrades the
 * run to a fresh window with today only (risk R3): reading our own previous
 * output must never be fatal.
 */
export type DegradationReason =
  | 'absent'
  | 'invalid-json'
  | 'invalid-shape'
  | 'version-mismatch'
  | 'first-load'

export type PreviousArtifact =
  | { ok: true; artifact: ChangesArtifact }
  | { ok: false; reason: Exclude<DegradationReason, 'first-load'> }

export interface BuildChangesInput {
  /** The previous normalized catalog, or `null` on a first load. */
  previous: ProductoLite[] | null
  /** The freshly written normalized catalog. */
  current: ProductoLite[]
  previousArtifact: PreviousArtifact
  /** The extraction moment (`raw.generada`), the same source the facets date uses. */
  generatedAt: string
  /** Overridable for tests; the frozen contract fixes it at 7. */
  windowDays?: number
}

export interface BuildChangesResult {
  artifact: ChangesArtifact
  /** `null` when the window was continued; otherwise why it restarted. */
  degraded: DegradationReason | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The `YYYY-MM-DD` part of an ISO timestamp, in UTC (the raw writes `…Z`). */
function utcDay(iso: string): string | null {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10)
}

/** Epoch-day number for a `YYYY-MM-DD`, or `null` when it is not a date. */
function dayNumber(fecha: string): number | null {
  if (!FECHA_RE.test(fecha)) return null
  const ms = Date.parse(`${fecha}T00:00:00Z`)
  return Number.isNaN(ms) ? null : Math.round(ms / DAY_MS)
}

function isValidList(value: unknown): value is BoundedList<Record<string, unknown>> {
  if (!isPlainObject(value)) return false
  if (typeof value.conteo !== 'number' || !Number.isFinite(value.conteo)) return false
  if (typeof value.truncado !== 'boolean') return false
  if (!Array.isArray(value.valores)) return false
  return value.valores.every(isPlainObject)
}

function isValidDay(value: unknown): value is ChangeDay {
  if (!isPlainObject(value)) return false
  if (typeof value.fecha !== 'string' || dayNumber(value.fecha) === null) return false
  return isValidList(value.nuevos) && isValidList(value.bajaron) && isValidList(value.subieron)
}

/**
 * Parses the previous artifact. `null` means the file was absent or unreadable;
 * everything else is the file's text. Any failure to make sense of it is a
 * reason to start a fresh window, never a crash.
 */
export function parseChangesArtifact(text: string | null): PreviousArtifact {
  if (text === null) return { ok: false, reason: 'absent' }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (!isPlainObject(value)) return { ok: false, reason: 'invalid-shape' }
  if (value.version !== CHANGES_VERSION) return { ok: false, reason: 'version-mismatch' }
  if (!Array.isArray(value.dias)) return { ok: false, reason: 'invalid-shape' }
  if (!value.dias.every(isValidDay)) return { ok: false, reason: 'invalid-shape' }
  return { ok: true, artifact: value as unknown as ChangesArtifact }
}

/** The EAN the app can link to, or `null` when the barcode is unusable. */
function eanOf(product: ProductoLite): string | null {
  return usableEan(product.barcode) ?? null
}

function bound<T>(values: T[]): BoundedList<T> {
  return {
    conteo: values.length,
    truncado: values.length > CAP_DAY,
    valores: values.slice(0, CAP_DAY),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Today's entry. A first load (`previous === null`) has no comparable past, so
 * the lists are empty on purpose: reporting 20k `nuevos` would be a lie, the
 * same one `compararCatalogos` refuses to tell with its `primeraCarga`.
 */
function buildDay(fecha: string, previous: ProductoLite[] | null, current: ProductoLite[]): ChangeDay {
  const nuevos: NewProduct[] = []
  const bajaron: PriceMove[] = []
  const subieron: PriceMove[] = []

  if (previous !== null) {
    const previousById = new Map(previous.map((p) => [p.id, p]))
    const currentById = new Map(current.map((p) => [p.id, p]))

    for (const product of current) {
      if (previousById.has(product.id)) continue
      nuevos.push({ ean: eanOf(product), nombre: product.nombre, precio: product.precio })
    }

    for (const [id, before] of previousById) {
      const after = currentById.get(id)
      if (!after || after.precio === before.precio) continue
      // A zero baseline has no computable percentage; normalized catalogs never
      // carry one (normalize excludes `precio <= 0`), so this is only a guard.
      if (before.precio === 0) continue
      const pct = ((after.precio - before.precio) / before.precio) * 100
      const move: PriceMove = {
        ean: eanOf(after),
        nombre: after.nombre,
        antes: before.precio,
        ahora: after.precio,
        pct: round2(pct),
      }
      // Classified by the exact sign, then rounded: a tiny move must not vanish.
      if (pct > 0) subieron.push(move)
      else if (pct < 0) bajaron.push(move)
    }
  }

  // Biggest move first, so capping keeps the changes that matter most. The sort
  // is stable, so equal magnitudes keep the catalog's own order.
  const byMagnitude = (a: PriceMove, b: PriceMove): number => Math.abs(b.pct) - Math.abs(a.pct)
  bajaron.sort(byMagnitude)
  subieron.sort(byMagnitude)

  return {
    fecha,
    nuevos: bound(nuevos),
    bajaron: bound(bajaron),
    subieron: bound(subieron),
  }
}

/**
 * Builds the artifact. Pure: it never touches the filesystem and never reads a
 * clock. `previousArtifact` carries the older days; today is always rebuilt.
 */
export function buildChangesArtifact(input: BuildChangesInput): BuildChangesResult {
  const windowDays = input.windowDays ?? WINDOW_DAYS
  const fecha = utcDay(input.generatedAt)
  if (fecha === null) {
    throw new TypeError(`generatedAt no es una fecha: ${input.generatedAt}`)
  }

  const today = buildDay(fecha, input.previous, input.current)
  const todayNumber = dayNumber(fecha)!
  const cutoff = todayNumber - (windowDays - 1)
  const previousDays: ChangeDay[] = []
  let degraded: DegradationReason | null = null

  if (input.previous === null) {
    // No catalog to diff against: continuity is broken anyway, so the window
    // restarts. The prose report says `primeraCarga` for the same reason.
    degraded = 'first-load'
  } else if (!input.previousArtifact.ok) {
    degraded = input.previousArtifact.reason
  } else {
    const seen = new Set<string>()
    for (const day of input.previousArtifact.artifact.dias) {
      // Today is rebuilt, not carried: idempotent by date, not by run.
      if (day.fecha === fecha) continue
      const n = dayNumber(day.fecha)
      // Drop anything outside the rolling window (past the cutoff, or dated in
      // the future) and any duplicate date.
      if (n === null || n < cutoff || n > todayNumber) continue
      if (seen.has(day.fecha)) continue
      seen.add(day.fecha)
      previousDays.push(day)
    }
  }

  const dias = [today, ...previousDays].sort((a, b) => b.fecha.localeCompare(a.fecha))

  return {
    artifact: {
      version: CHANGES_VERSION,
      ventanaDias: windowDays,
      generado: input.generatedAt,
      dias,
    },
    degraded,
  }
}
