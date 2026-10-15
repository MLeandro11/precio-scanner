/**
 * catalogChanges — types and loader for `data/catalogo-cambios.json`, the
 * artifact the pipeline publishes for the `/cambios` feed.
 *
 * The artifact contract is frozen in `odd/tasks/cambios-catalogo.md`; this module
 * mirrors it exactly.
 *
 * Strategy (finding H3): the artifact is small, so it follows the
 * `catalogo-facets.json` path of `catalogLoader.ts` — network-first with
 * `cache: 'no-cache'`, plus the last known copy from the Cache API as the offline
 * fallback. It is NEVER versioned with `?v=` (the daily prune would delete it and
 * re-download every day) and it is NOT part of the boot path: it is only fetched
 * when the `/cambios` screen mounts, so the three boot downloads and the 5.5 MB
 * cache math stay untouched.
 *
 * Every response is validated before it is trusted. A 200 carrying HTML means
 * the file is missing server-side and an SPA fallback answered — the artifact is
 * then genuinely absent, which the screen can say honestly. Wrong version,
 * invalid JSON or an ill-formed `dias` are unreadable data. Nothing throws: the
 * loader returns a discriminated result the UI renders as-is.
 *
 * All I/O is injectable so the module is unit-testable in plain Node.
 */

import { CACHE_NAME } from './catalogLoader'

/** The artifact version this build understands. A different one is unreadable. */
export const CHANGES_VERSION = 1

/*
 * `CACHE_NAME` is imported from `catalogLoader`, never duplicated: the artifact shares that
 * store, and its unversioned `data/` key carries no `?v=`, so the loader's prune keeps it by
 * construction (the offline fallback), exactly like the facets copy. Two hardcoded copies of
 * the name would drift and silently orphan this fallback.
 */

export interface NewProduct {
  ean: string | null
  nombre: string
  precio: number
}

export interface PriceMove {
  ean: string | null
  nombre: string
  antes: number
  ahora: number
  pct: number
}

export interface BoundedList<T> {
  conteo: number
  truncado: boolean
  valores: T[]
}

export interface ChangeDay {
  fecha: string
  nuevos: BoundedList<NewProduct>
  bajaron: BoundedList<PriceMove>
  subieron: BoundedList<PriceMove>
}

export interface ChangesArtifact {
  version: number
  ventanaDias: number
  generado: string
  dias: ChangeDay[]
}

/** Minimal shape of a Cache entry the loader needs (injectable for tests). */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>
  put(key: string, response: Response): Promise<void>
}

/** Minimal shape of the Cache API the loader needs. */
export interface CacheStore {
  open(name: string): Promise<CacheLike>
}

export interface LoaderDeps {
  fetchFn?: typeof fetch
  caches?: CacheStore | null
  baseUrl?: string
}

/**
 * The loader's honest outcomes:
 *   - `ready` with `source: 'network'` — fresh artifact.
 *   - `ready` with `source: 'cache'` — offline, showing the last known copy.
 *   - `absent` — the pipeline has not published it yet (404 or SPA fallback).
 *   - `invalid` — present but unreadable (wrong version, bad JSON, bad shape).
 *   - `offline` — the network is unreachable and no copy is stored.
 *   - `error` — the server was reached and answered badly (not a 404).
 */
export type ChangesLoadResult =
  | { status: 'ready'; source: 'network' | 'cache'; artifact: ChangesArtifact }
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** `YYYY-MM-DD` and a real calendar date, the same gate the pipeline applies. */
function isFecha(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

/**
 * An `ean` is either `null` or the digits-only string `usableEan` accepts (≥6).
 * Deliberately not `≥13`: the artifact's own rule is the UI's usable-EAN cut
 * (H5), so one digits-only barcode cannot be dropped on the client.
 */
function isEan(value: unknown): value is string | null {
  if (value === null) return true
  return typeof value === 'string' && /^\d+$/.test(value) && value.length >= 6
}

function isNewProduct(value: unknown): value is NewProduct {
  if (!isPlainObject(value)) return false
  return (
    isEan(value.ean) &&
    typeof value.nombre === 'string' &&
    isFiniteNumber(value.precio)
  )
}

function isPriceMove(value: unknown): value is PriceMove {
  if (!isPlainObject(value)) return false
  return (
    isEan(value.ean) &&
    typeof value.nombre === 'string' &&
    isFiniteNumber(value.antes) &&
    isFiniteNumber(value.ahora) &&
    isFiniteNumber(value.pct)
  )
}

function isBoundedList<T>(
  value: unknown,
  isItem: (item: unknown) => item is T,
): value is BoundedList<T> {
  if (!isPlainObject(value)) return false
  if (!isFiniteNumber(value.conteo) || value.conteo < 0) return false
  if (typeof value.truncado !== 'boolean') return false
  if (!Array.isArray(value.valores)) return false
  return value.valores.every(isItem)
}

function isChangeDay(value: unknown): value is ChangeDay {
  if (!isPlainObject(value)) return false
  return (
    isFecha(value.fecha) &&
    isBoundedList(value.nuevos, isNewProduct) &&
    isBoundedList(value.bajaron, isPriceMove) &&
    isBoundedList(value.subieron, isPriceMove)
  )
}

/**
 * The single authority over the artifact's shape. `reason: 'absent'` is reserved
 * for the SPA-fallback HTML answer (the file is missing server-side); everything
 * else that cannot be read is `'invalid'`.
 */
type ParseOutcome =
  | { ok: true; artifact: ChangesArtifact }
  | { ok: false; reason: 'absent' | 'invalid' }

function isHtml(text: string, contentType: string | null): boolean {
  return (
    (contentType?.includes('text/html') ?? false) || /^\s*(<!doctype|<html)/i.test(text)
  )
}

export function parseChangesArtifact(text: string, contentType: string | null = null): ParseOutcome {
  if (isHtml(text, contentType)) return { ok: false, reason: 'absent' }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (!isPlainObject(value)) return { ok: false, reason: 'invalid' }
  if (value.version !== CHANGES_VERSION) return { ok: false, reason: 'invalid' }
  if (!isFiniteNumber(value.ventanaDias) || value.ventanaDias < 1) {
    return { ok: false, reason: 'invalid' }
  }
  if (typeof value.generado !== 'string' || value.generado === '') {
    return { ok: false, reason: 'invalid' }
  }
  if (!Array.isArray(value.dias) || !value.dias.every(isChangeDay)) {
    return { ok: false, reason: 'invalid' }
  }

  return { ok: true, artifact: value as unknown as ChangesArtifact }
}

async function readBody(response: Response): Promise<{ text: string; contentType: string | null }> {
  const text = await response.text()
  return { text, contentType: response.headers.get('content-type') }
}

/**
 * Loads `public/data/catalogo-cambios.json`.
 *
 * Mirrors `catalogLoader.loadFacets`: the network is always tried first with
 * `cache: 'no-cache'`; a request that never completed (the offline signal) falls
 * back to the stored copy; a server that is reached and answers badly stays a
 * loud `error`/`absent` and is never masked by a stale copy.
 */
export async function loadCatalogChanges(deps: LoaderDeps = {}): Promise<ChangesLoadResult> {
  const fetchFn: typeof fetch = deps.fetchFn ?? fetch
  const cachesApi = deps.caches ?? (globalThis as { caches?: CacheStore }).caches ?? null
  const baseUrl = deps.baseUrl ?? defaultBaseUrl()
  const key = `${baseUrl}data/catalogo-cambios.json`
  const cache = cachesApi ? await cachesApi.open(CACHE_NAME) : null

  let response: Response | null = null
  try {
    response = await fetchFn(key, { cache: 'no-cache' })
  } catch {
    // `fetch` rejects only when the request never completed — the offline signal.
    response = null
  }

  if (!response) {
    const hit = cache ? await cache.match(key) : undefined
    if (!hit) return { status: 'offline' }
    // The copy was validated when it was stored; re-validating keeps a platform
    // anomaly from rendering invented rows, and never throws.
    const { text, contentType } = await readBody(hit)
    const parsed = parseChangesArtifact(text, contentType)
    if (!parsed.ok) return { status: 'invalid' }
    return { status: 'ready', source: 'cache', artifact: parsed.artifact }
  }

  if (response.status === 404) return { status: 'absent' }
  if (!response.ok) return { status: 'error' }

  const { text, contentType } = await readBody(response)
  const parsed = parseChangesArtifact(text, contentType)
  if (!parsed.ok) return { status: parsed.reason }

  // Store the validated JSON (never the raw response: an HTML fallback must not
  // be poisoned into the offline copy).
  await cache?.put(
    key,
    new Response(JSON.stringify(parsed.artifact), {
      headers: { 'content-type': 'application/json' },
    }),
  )

  return { status: 'ready', source: 'network', artifact: parsed.artifact }
}
