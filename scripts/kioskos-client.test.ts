/**
 * kioskos-client.test.ts — the HTTP contract, driven entirely by fake `fetch`.
 *
 * No test here touches the network: every request goes through an injected
 * fake, which also records the URLs it was asked for. That recording is how
 * "strictly sequential" and "starts at desde=0, advances by tope" are proven
 * rather than asserted in prose.
 *
 * Hygiene is part of the contract under test: a failed login never echoes the
 * credential it was handed, so these tests deliberately answer login failures
 * with a body that repeats the fake password and check the error does not.
 */
import { describe, it, expect } from 'vitest'
import {
  contar,
  entrar,
  extraerTodo,
  KioskosError,
  MAX_PAGINAS,
  TOPE_DEFAULT,
} from './kioskos-client.ts'
import type { KioskosDeps } from './kioskos-client.ts'

type RespuestaFalsa = Awaited<ReturnType<KioskosDeps['fetch']>>
type Init = Parameters<KioskosDeps['fetch']>[1]

/** A successful JSON response, as the real `fetch` would hand it back. */
function ok(body: unknown, status = 200): RespuestaFalsa {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** A response whose body is not JSON at all. */
function sinJson(status = 200): RespuestaFalsa {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('la respuesta no es JSON')
    },
  }
}

interface Llamada {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  signal: AbortSignal
}

/**
 * Builds deps around a fake server. The fake yields once before answering (so
 * two overlapping calls would both be in flight at the same time) and tracks
 * the peak number of concurrent calls: `picoParalelo()` is 1 exactly when the
 * caller awaited each request before issuing the next.
 */
function clienteFalso(
  manejador: (url: URL, init: { method: string; body?: string }) => RespuestaFalsa,
) {
  const llamadas: Llamada[] = []
  let enVuelo = 0
  let picoParalelo = 0

  const fetch: KioskosDeps['fetch'] = async (url, init: Init) => {
    enVuelo++
    picoParalelo = Math.max(picoParalelo, enVuelo)
    llamadas.push({ url, method: init.method, headers: init.headers, body: init.body, signal: init.signal })
    try {
      await new Promise((r) => setTimeout(r, 0))
      return manejador(new URL(url), { method: init.method, body: init.body })
    } finally {
      enVuelo--
    }
  }

  return {
    llamadas,
    picoParalelo: () => picoParalelo,
    deps: (baseUrl = 'https://kioskos.app'): KioskosDeps => ({ fetch, baseUrl }),
  }
}

function productos(n: number, desde = 0): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${desde + i}`,
    nombre: `Producto ${desde + i}`,
    categoria: 'Cat',
    barcode: '',
    precio: 100 + i,
  }))
}

/** Serves slices of `catalogo` exactly like the real paginated endpoint. */
function servicio(catalogo: unknown[]) {
  return (url: URL): RespuestaFalsa => {
    if (url.pathname === '/api/productos') {
      const tope = Number(url.searchParams.get('tope'))
      const desde = Number(url.searchParams.get('desde'))
      return ok({ productos: catalogo.slice(desde, desde + tope) })
    }
    return sinJson(404)
  }
}

function paginados(llamadas: Llamada[]): Array<{ tope: number; desde: number }> {
  return llamadas
    .filter((l) => new URL(l.url).pathname === '/api/productos')
    .map((l) => {
      const u = new URL(l.url)
      return { tope: Number(u.searchParams.get('tope')), desde: Number(u.searchParams.get('desde')) }
    })
}

async function motivoDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa
  } catch (err) {
    expect(err).toBeInstanceOf(KioskosError)
    return (err as KioskosError).motivo
  }
  throw new Error('se esperaba un fallo y no hubo ninguno')
}

const EMAIL_FALSO = 'duenio@ejemplo.com'
const CLAVE_FALSA = 'clave-secreta-1234'
const TOKEN_FALSO = 'token-secreto.abcdef'

describe('entrar', () => {
  it('returns the token, the business and the businesses list on a normal login', async () => {
    const c = clienteFalso(() =>
      ok({
        token: TOKEN_FALSO,
        empleado: { id: 'e1' },
        negocio: { id: 'n1', nombre: 'Kiosco Norte' },
        negocios: [{ id: 'n1' }],
      }),
    )

    const sesion = await entrar(c.deps(), { email: EMAIL_FALSO, clave: CLAVE_FALSA })

    expect(sesion.token).toBe(TOKEN_FALSO)
    expect(sesion.negocio).toEqual({ id: 'n1', nombre: 'Kiosco Norte' })
    expect(sesion.negocios).toEqual([{ id: 'n1' }])
    expect(c.llamadas).toHaveLength(1)
    expect(c.llamadas[0].method).toBe('POST')
    expect(c.llamadas[0].url).toBe('https://kioskos.app/api/entrar')
    // the login request is the one request with no bearer token
    expect(c.llamadas[0].headers.Authorization).toBeUndefined()
    expect(JSON.parse(c.llamadas[0].body ?? '{}')).toEqual({ email: EMAIL_FALSO, clave: CLAVE_FALSA })
  })

  it('rejects a non-2xx login without ever echoing the response body', async () => {
    // The body deliberately repeats the credential: a naive implementation
    // that includes the body in the error would leak it.
    const c = clienteFalso(() =>
      ok({ error: `clave incorrecta: ${CLAVE_FALSA}` }, 401),
    )

    let capturado: KioskosError | null = null
    try {
      await entrar(c.deps(), { email: EMAIL_FALSO, clave: CLAVE_FALSA })
    } catch (err) {
      capturado = err as KioskosError
    }

    expect(capturado).toBeInstanceOf(KioskosError)
    expect(capturado?.motivo).toBe('login')
    expect(capturado?.message).toMatch(/401/)
    expect(capturado?.message).not.toContain(CLAVE_FALSA)
    expect(capturado?.message).not.toContain(EMAIL_FALSO)
    expect(String(capturado?.stack)).not.toContain(CLAVE_FALSA)
  })

  it('rejects a body that is not JSON', async () => {
    const c = clienteFalso(() => sinJson(200))
    expect(await motivoDe(entrar(c.deps(), { email: EMAIL_FALSO, clave: CLAVE_FALSA }))).toBe('login')
  })

  it('rejects a JSON body that is not an object', async () => {
    const c = clienteFalso(() => ok(['no', 'es', 'un', 'objeto']))
    expect(await motivoDe(entrar(c.deps(), { email: EMAIL_FALSO, clave: CLAVE_FALSA }))).toBe('login')
  })

  it('rejects a missing token', async () => {
    const c = clienteFalso(() => ok({ negocio: { id: 'n1' } }))
    expect(await motivoDe(entrar(c.deps(), { email: EMAIL_FALSO, clave: CLAVE_FALSA }))).toBe('login')
  })

  it('rejects an empty token', async () => {
    const c = clienteFalso(() => ok({ token: '   ' }))
    expect(await motivoDe(entrar(c.deps(), { email: EMAIL_FALSO, clave: CLAVE_FALSA }))).toBe('login')
  })

  it('rejects a non-string token', async () => {
    const c = clienteFalso(() => ok({ token: 12345 }))
    expect(await motivoDe(entrar(c.deps(), { email: EMAIL_FALSO, clave: CLAVE_FALSA }))).toBe('login')
  })

  it('turns a network failure into a login failure without echoing the credential', async () => {
    const fetch: KioskosDeps['fetch'] = async () => {
      throw new TypeError(`fetch failed for ${EMAIL_FALSO}`)
    }
    const deps: KioskosDeps = { fetch, baseUrl: 'https://kioskos.app' }

    let capturado: KioskosError | null = null
    try {
      await entrar(deps, { email: EMAIL_FALSO, clave: CLAVE_FALSA })
    } catch (err) {
      capturado = err as KioskosError
    }
    expect(capturado?.motivo).toBe('login')
    expect(capturado?.message).not.toContain(CLAVE_FALSA)
  })

  it('hands the login request a real, un-aborted AbortSignal', async () => {
    const c = clienteFalso(() => ok({ token: TOKEN_FALSO }))

    await entrar(c.deps(), { email: EMAIL_FALSO, clave: CLAVE_FALSA })

    expect(c.llamadas[0].signal).toBeInstanceOf(AbortSignal)
    expect(c.llamadas[0].signal.aborted).toBe(false)
  })

  it('surfaces an aborted login as the typed connection error, not an unhandled rejection', async () => {
    // The fake honors the signal exactly like real `fetch`: when the bound
    // fires the request rejects. A short timeout drives it directly instead of
    // waiting the 15 s default.
    const fetch: KioskosDeps['fetch'] = (_url, init) =>
      new Promise<RespuestaFalsa>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      })
    const deps: KioskosDeps = { fetch, baseUrl: 'https://kioskos.app', timeoutMs: 5 }

    expect(await motivoDe(entrar(deps, { email: EMAIL_FALSO, clave: CLAVE_FALSA }))).toBe('login')
  })
})

describe('contar', () => {
  it('parses cuantos and sends the bearer token', async () => {
    const c = clienteFalso(() => ok({ cuantos: 23_230, conGondola: 2, conAlgo: 5 }))

    expect(await contar(c.deps(), TOKEN_FALSO)).toBe(23_230)
    expect(c.llamadas[0].url).toBe('https://kioskos.app/api/productos-cuantos')
    expect(c.llamadas[0].headers.Authorization).toBe(`Bearer ${TOKEN_FALSO}`)
  })

  it('fails when cuantos is not a finite number greater than zero', async () => {
    for (const cuantos of [undefined, null, 0, -3, 'muchos', true, Number.NaN]) {
      const c = clienteFalso(() => ok({ cuantos }))
      expect(await motivoDe(contar(c.deps(), TOKEN_FALSO))).toBe('api')
    }
  })

  it('fails on a non-2xx count response', async () => {
    const c = clienteFalso(() => ok({ cuantos: 10 }, 500))
    expect(await motivoDe(contar(c.deps(), TOKEN_FALSO))).toBe('api')
  })

  it('hands the count request a real, un-aborted AbortSignal', async () => {
    const c = clienteFalso(() => ok({ cuantos: 23_230 }))

    await contar(c.deps(), TOKEN_FALSO)

    expect(c.llamadas[0].signal).toBeInstanceOf(AbortSignal)
    expect(c.llamadas[0].signal.aborted).toBe(false)
  })
})

describe('extraerTodo', () => {
  it('paginates strictly sequentially from desde=0 by tope, stopping on a partial page', async () => {
    const c = clienteFalso(servicio(productos(1200)))

    const r = await extraerTodo(c.deps(), TOKEN_FALSO)

    expect(r.productos).toHaveLength(1200)
    expect(r.paginas).toBe(3)
    expect(r.tope).toBe(TOPE_DEFAULT)
    expect(paginados(c.llamadas)).toEqual([
      { tope: 500, desde: 0 },
      { tope: 500, desde: 500 },
      { tope: 500, desde: 1000 },
    ])
    // the exact sequence of desde values plus a peak of one in-flight request
    // is the sequentiality proof
    expect(c.picoParalelo()).toBe(1)
  })

  it('requests one extra empty page when the total is an exact multiple of tope', async () => {
    const c = clienteFalso(servicio(productos(1000)))

    const r = await extraerTodo(c.deps(), TOKEN_FALSO)

    expect(r.productos).toHaveLength(1000)
    expect(r.paginas).toBe(3)
    expect(paginados(c.llamadas).map((p) => p.desde)).toEqual([0, 500, 1000])
  })

  it('stops safely on an empty first page', async () => {
    const c = clienteFalso(servicio([]))

    const r = await extraerTodo(c.deps(), TOKEN_FALSO)

    expect(r.productos).toEqual([])
    expect(r.paginas).toBe(1)
    expect(paginados(c.llamadas)).toEqual([{ tope: 500, desde: 0 }])
  })

  it('honors a tope override and advances by it', async () => {
    const c = clienteFalso(servicio(productos(700)))

    const r = await extraerTodo(c.deps(), TOKEN_FALSO, { tope: 300 })

    expect(r.tope).toBe(300)
    expect(r.productos).toHaveLength(700)
    expect(r.paginas).toBe(3)
    expect(paginados(c.llamadas)).toEqual([
      { tope: 300, desde: 0 },
      { tope: 300, desde: 300 },
      { tope: 300, desde: 600 },
    ])
  })

  it('reports progress through alAvanzar with the accumulated count', async () => {
    const c = clienteFalso(servicio(productos(1200)))
    const visto: number[] = []

    await extraerTodo(c.deps(), TOKEN_FALSO, { alAvanzar: (n) => visto.push(n) })

    expect(visto).toEqual([500, 1000, 1200])
  })

  it('sends the bearer token on every page', async () => {
    const c = clienteFalso(servicio(productos(600)))
    await extraerTodo(c.deps(), TOKEN_FALSO)
    expect(c.llamadas.map((l) => l.headers.Authorization)).toEqual([
      `Bearer ${TOKEN_FALSO}`,
      `Bearer ${TOKEN_FALSO}`,
    ])
  })

  it('hands every page request a real, un-aborted AbortSignal', async () => {
    const c = clienteFalso(servicio(productos(1200)))

    await extraerTodo(c.deps(), TOKEN_FALSO)

    expect(c.llamadas).toHaveLength(3)
    for (const llamada of c.llamadas) {
      expect(llamada.signal).toBeInstanceOf(AbortSignal)
      expect(llamada.signal.aborted).toBe(false)
    }
  })

  it('surfaces an aborted page as the typed api connection error, not an unhandled rejection', async () => {
    const fetch: KioskosDeps['fetch'] = (_url, init) =>
      new Promise<RespuestaFalsa>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      })
    const deps: KioskosDeps = { fetch, baseUrl: 'https://kioskos.app', timeoutMs: 5 }

    expect(await motivoDe(extraerTodo(deps, TOKEN_FALSO))).toBe('api')
  })

  it('rejects a page whose productos is missing', async () => {
    const c = clienteFalso((url) =>
      url.pathname === '/api/productos' ? ok({ paginas: 1 }) : sinJson(404),
    )
    expect(await motivoDe(extraerTodo(c.deps(), TOKEN_FALSO))).toBe('api')
  })

  it('rejects a page whose productos is not an array', async () => {
    const c = clienteFalso((url) =>
      url.pathname === '/api/productos' ? ok({ productos: 'no' }) : sinJson(404),
    )
    expect(await motivoDe(extraerTodo(c.deps(), TOKEN_FALSO))).toBe('api')
  })

  it('rejects a non-2xx page', async () => {
    const c = clienteFalso((url) =>
      url.pathname === '/api/productos' ? ok({ productos: [] }, 502) : sinJson(404),
    )
    expect(await motivoDe(extraerTodo(c.deps(), TOKEN_FALSO))).toBe('api')
  })

  it('lets a one-row over-count reach the caller instead of calling it a runaway', async () => {
    // R8's third direction: a product is added while the walk is in progress,
    // so the offsets shift and one row is fetched twice with no compensating
    // skip. The walk ends with oracle + 1 rows — data drift, not an API that
    // ignores `desde`. It must return the rows so the caller can validate them.
    const pagina0 = productos(500)
    const pagina1 = [{ ...pagina0[499] }, ...productos(100, 500)]
    const c = clienteFalso((url) => {
      if (url.pathname !== '/api/productos') return sinJson(404)
      const desde = Number(url.searchParams.get('desde'))
      return ok({ productos: desde === 0 ? pagina0 : pagina1 })
    })

    const r = await extraerTodo(c.deps(), TOKEN_FALSO, { cuantos: 600 })

    expect(r.productos).toHaveLength(601)
    expect(paginados(c.llamadas)).toEqual([
      { tope: 500, desde: 0 },
      { tope: 500, desde: 500 },
    ])
  })

  it('lets an over-count of a whole page through, because a shift cannot be larger', async () => {
    // The boundary: exactly `cuantos + tope` is still data drift, and is the
    // largest over-count that reaches validation instead of the runaway guard.
    const c = clienteFalso(servicio(productos(1000)))

    const r = await extraerTodo(c.deps(), TOKEN_FALSO, { cuantos: 500 })

    expect(r.productos).toHaveLength(1000)
    expect(paginados(c.llamadas)).toEqual([
      { tope: 500, desde: 0 },
      { tope: 500, desde: 500 },
      { tope: 500, desde: 1000 },
    ])
  })

  it('still cuts a full-page stream that overshoots the oracle by more than a page', async () => {
    // A server that always returns a full page: without the guard this loops
    // forever. With `cuantos` it must stop on the page that pushes the
    // accumulated count past `cuantos + tope` (600 + 500 here).
    const c = clienteFalso((url) =>
      url.pathname === '/api/productos' ? ok({ productos: productos(500) }) : sinJson(404),
    )

    expect(await motivoDe(extraerTodo(c.deps(), TOKEN_FALSO, { cuantos: 600 }))).toBe('bucle-infinito')
    expect(c.llamadas).toHaveLength(3)
  })

  it('has a page cap backstop for an unbounded stream when cuantos is not given', async () => {
    const c = clienteFalso((url) =>
      url.pathname === '/api/productos' ? ok({ productos: productos(500) }) : sinJson(404),
    )

    expect(await motivoDe(extraerTodo(c.deps(), TOKEN_FALSO))).toBe('bucle-infinito')
    expect(c.llamadas).toHaveLength(MAX_PAGINAS)
  })

  it('rejects an invalid tope before issuing any request', async () => {
    const c = clienteFalso(() => ok({ productos: [] }))
    expect(await motivoDe(extraerTodo(c.deps(), TOKEN_FALSO, { tope: 0 }))).toBe('tope-invalido')
    expect(c.llamadas).toHaveLength(0)
  })
})
