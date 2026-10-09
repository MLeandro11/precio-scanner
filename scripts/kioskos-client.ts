#!/usr/bin/env node
/**
 * kioskos-client.ts — the kioskos.app HTTP contract, dependency-injected.
 *
 * This module is deliberately free of I/O and process state: no `fs`, no
 * `child_process`, no `process.exit`, no console, no environment reading. Every
 * request goes through the injected `fetch`, so the whole contract — login, the
 * oracle count and the paginated catalog — is testable without a network and
 * without credentials. `extract-catalog.ts` owns the environment, the file and
 * the exit codes.
 *
 * Verified upstream contract (read from the real app, not guessed):
 *   POST /api/entrar                  {email, clave} → {token, negocio, negocios}
 *   GET  /api/productos-cuantos       Bearer         → {cuantos, conGondola, conAlgo}
 *   GET  /api/productos?tope=&desde=  Bearer         → {productos: [...]}
 *
 * Rules this module enforces, because the caller cannot enforce them from
 * outside:
 *   - Every request is bounded by `AbortSignal.timeout` (15 s by default).
 *   - There are NO retries, ever — not for the login and not for a page. The
 *     token lives 12 hours and retrying a rejected credential is the fast path
 *     to an account lockout (spec hygiene rule 3).
 *   - A failed login never echoes the response body, because that body can
 *     repeat the submitted credential. Only a reason and a status.
 *   - Pagination is strictly sequential, starts at `desde=0` and advances by
 *     `tope`; it stops on a short (or empty) page. The `contar` oracle bounds a
 *     runaway full-page stream, but only once the count overshoots it by more
 *     than a page, so the small over-count of a shifted walk reaches validation
 *     (risk R8).
 */

/** Milliseconds any single request is allowed to take before it aborts. */
export const TIMEOUT_MS = 15_000

/** Page size the site's own client uses for the catalog walk. */
export const TOPE_DEFAULT = 500

/**
 * Absolute backstop for a stream that never comes up short. Only reachable
 * when the caller does not pass the oracle count (`cuantos`): with it in hand,
 * overshooting the oracle by more than a page is caught on the offending page
 * instead.
 */
export const MAX_PAGINAS = 1000

export interface KioskosDeps {
  fetch: (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
  baseUrl: string
  timeoutMs?: number
}

export interface Credenciales {
  email: string
  clave: string
}

export interface Sesion {
  token: string
  negocio: unknown
  negocios: unknown[]
}

export interface OpcionesExtraccion {
  /** Records per request (default `TOPE_DEFAULT`). */
  tope?: number
  /**
   * The oracle count from `contar`. When present it also bounds a runaway: a
   * page that pushes the accumulated count past `cuantos + tope` is a failure,
   * not another request. A smaller over-count is data drift and is returned so
   * the caller can validate it (risk R8).
   */
  cuantos?: number
  /** Called after each page with the accumulated record count. */
  alAvanzar?: (acumulado: number) => void
}

export interface Extraccion {
  productos: unknown[]
  paginas: number
  tope: number
}

/**
 * Why an operation failed. Deliberately coarse: every login problem is one
 * `login` failure, so callers branch on the operation and not on a taxonomy
 * they would have to keep growing.
 */
export type MotivoError = 'login' | 'api' | 'tope-invalido' | 'bucle-infinito'

export class KioskosError extends Error {
  readonly motivo: MotivoError

  constructor(motivo: MotivoError, mensaje: string) {
    super(mensaje)
    this.name = 'KioskosError'
    this.motivo = motivo
  }
}

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A finite, positive number, accepting a numeric string the API might send. */
function aNumeroPositivo(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  if (typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v.trim())) {
    const n = Number(v.trim())
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

/**
 * Only the error's class name, never its message: a `fetch` failure message
 * can quote the URL or headers, and this module's whole point is that no
 * request body ever reaches a log.
 */
function claseDeError(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'error'
}

interface Pedido {
  method: 'GET' | 'POST'
  /** JSON body. Present only on the login request. */
  body?: string
  /** Bearer token; absent on the login request. */
  token?: string
  /** Failure motive for this request's stage. */
  motivo: MotivoError
}

/** One bounded request. Network failures become typed errors of `motivo`. */
async function pedir(deps: KioskosDeps, path: string, p: Pedido) {
  const base = deps.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (p.token !== undefined) headers.Authorization = `Bearer ${p.token}`
  if (p.body !== undefined) headers['Content-Type'] = 'application/json'

  const signal = AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS)
  try {
    return await deps.fetch(`${base}${path}`, {
      method: p.method,
      headers,
      body: p.body,
      signal,
    })
  } catch (err) {
    throw new KioskosError(p.motivo, `${path}: falló la conexión (${claseDeError(err)})`)
  }
}

/** Parses a response body, turning "not JSON" into a typed failure. */
async function cuerpoJson(
  res: { status: number; json(): Promise<unknown> },
  path: string,
  motivo: MotivoError,
): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    throw new KioskosError(motivo, `${path}: la respuesta no es JSON (HTTP ${res.status})`)
  }
}

/**
 * Logs in. Any failure — HTTP status, non-JSON body, body that is not an
 * object, or a token that is missing/empty/not a string — is one `login`
 * failure whose message never contains the response body. The body of a
 * rejected login can echo the credential back, so it is never read on failure.
 */
export async function entrar(deps: KioskosDeps, credenciales: Credenciales): Promise<Sesion> {
  const res = await pedir(deps, '/api/entrar', {
    method: 'POST',
    body: JSON.stringify(credenciales),
    motivo: 'login',
  })
  if (!res.ok) {
    // status only; the body is never touched here.
    throw new KioskosError('login', `login rechazado (HTTP ${res.status})`)
  }

  const json = await cuerpoJson(res, '/api/entrar', 'login')
  if (!esObjetoPlano(json)) {
    throw new KioskosError('login', 'la respuesta del login no es un objeto')
  }
  const token = json.token
  if (typeof token !== 'string' || token.trim() === '') {
    throw new KioskosError('login', 'la respuesta del login no trae un token utilizable')
  }

  return {
    token,
    negocio: json.negocio,
    negocios: Array.isArray(json.negocios) ? json.negocios : [],
  }
}

/** The oracle count, `GET /api/productos-cuantos`. */
export async function contar(deps: KioskosDeps, token: string): Promise<number> {
  const res = await pedir(deps, '/api/productos-cuantos', { method: 'GET', token, motivo: 'api' })
  if (!res.ok) {
    throw new KioskosError('api', `/api/productos-cuantos: falló (HTTP ${res.status})`)
  }

  const json = await cuerpoJson(res, '/api/productos-cuantos', 'api')
  const cuantos = esObjetoPlano(json) ? aNumeroPositivo(json.cuantos) : null
  if (cuantos === null) {
    throw new KioskosError('api', '/api/productos-cuantos: cuantos no es un número mayor que cero')
  }
  return cuantos
}

/**
 * Walks the catalog, one request at a time, from `desde=0` by `tope`.
 *
 * Stops when a page returns fewer than `tope` records — that is what the
 * site's own client does, and it is why an exact multiple of `tope` costs one
 * extra (empty) request. A malformed page is a failure, never a silent zero.
 */
export async function extraerTodo(
  deps: KioskosDeps,
  token: string,
  opts: OpcionesExtraccion = {},
): Promise<Extraccion> {
  const tope = opts.tope ?? TOPE_DEFAULT
  if (!Number.isInteger(tope) || tope <= 0) {
    throw new KioskosError('tope-invalido', `tope inválido: ${tope}`)
  }

  const productos: unknown[] = []
  let paginas = 0
  let desde = 0

  for (;;) {
    if (paginas >= MAX_PAGINAS) {
      throw new KioskosError(
        'bucle-infinito',
        `se alcanzaron ${MAX_PAGINAS} páginas sin terminar; se corta la extracción`,
      )
    }

    const path = `/api/productos?tope=${tope}&desde=${desde}`
    const res = await pedir(deps, path, { method: 'GET', token, motivo: 'api' })
    if (!res.ok) {
      throw new KioskosError('api', `${path}: falló (HTTP ${res.status})`)
    }

    const json = await cuerpoJson(res, path, 'api')
    const pagina = esObjetoPlano(json) ? json.productos : undefined
    if (!Array.isArray(pagina)) {
      throw new KioskosError('api', `${path}: la respuesta no trae un array productos`)
    }

    paginas++
    productos.push(...pagina)
    opts.alAvanzar?.(productos.length)

    // A small over-count is data drift, not a runaway. The walk pages over
    // mutable data, so a record added mid-walk shifts the offsets and makes a
    // row appear twice with no compensating skip (risk R8): the walk then ends
    // at `cuantos + 1` or so. Only an over-count larger than a whole page is
    // proof the API is ignoring `desde`, because a shift cannot add a whole
    // page. A smaller over-count is returned so the caller validates it. The
    // guard runs BEFORE the stop conditions, so an over-counting final full
    // page still fails rather than being mistaken for a completed walk.
    if (opts.cuantos !== undefined && productos.length > opts.cuantos + tope) {
      throw new KioskosError(
        'bucle-infinito',
        `la extracción superó el oráculo (${productos.length} > ${opts.cuantos} registros); ` +
          'se corta para no paginar sin fin',
      )
    }

    if (pagina.length === 0) break
    if (pagina.length < tope) break

    desde += tope
  }

  return { productos, paginas, tope }
}
