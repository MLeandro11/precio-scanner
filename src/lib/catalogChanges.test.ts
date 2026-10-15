import { describe, it, expect } from 'vitest'
import { loadCatalogChanges } from './catalogChanges'
import type { CacheLike, CacheStore, ChangesArtifact } from './catalogChanges'

/**
 * The loader is tested exactly like `catalogLoader.ts`: every byte of I/O is
 * injected (`fetch`, `caches`, `baseUrl`), so the tests run in plain Node and
 * assert the public result — never internal storage.
 *
 * The four honest outcomes the screen needs are pinned here: valid (network),
 * absent (the pipeline has not published it), invalid (wrong version / malformed
 * / not JSON), and the offline fallback to the last known copy. The extra
 * `offline` (nothing cached) and `error` (server answered badly) outcomes keep
 * the UI from collapsing distinct realities into one vague message.
 */

const BASE = '/precio-scanner/'
const ENDPOINT = `${BASE}data/catalogo-cambios.json`

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** What a dev server / SPA fallback answers when a public file is missing. */
function htmlResponse(): Response {
  return new Response('<!doctype html><html lang="es"><body>app</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  })
}

function artifact(): ChangesArtifact {
  return {
    version: 1,
    ventanaDias: 7,
    generado: '2026-10-15T12:28:27Z',
    dias: [
      {
        fecha: '2026-10-15',
        nuevos: {
          conteo: 1,
          truncado: false,
          valores: [{ ean: '7798479600021', nombre: 'ALFAJOR DAMAS GRATIS 80G', precio: 3450 }],
        },
        bajaron: {
          conteo: 20,
          truncado: false,
          valores: [{ ean: '7790895000430', nombre: 'YERBA', antes: 1290, ahora: 1150, pct: -10.85 }],
        },
        subieron: {
          conteo: 121,
          truncado: true,
          valores: [{ ean: null, nombre: 'GASEOSA', antes: 240, ahora: 2900, pct: 1108.33 }],
        },
      },
    ],
  }
}

/** A raw artifact for the rejection cases where the type no longer applies. */
function raw(value: unknown): Response {
  return jsonResponse(value)
}

interface FetchCall {
  url: string
  init?: RequestInit
}

function makeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: FetchCall[] = []
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, init: init as RequestInit | undefined })
    return handler(url)
  }
  return { fetchFn, calls }
}

function fakeCache(seed: Record<string, unknown> = {}): CacheLike & {
  calls: { match: number; put: number }
  deleted: string[]
} {
  const keyOf = (input: string) =>
    new URL(input, 'http://localhost').toString()
  const store = new Map<string, Response>()
  for (const [key, body] of Object.entries(seed)) {
    store.set(keyOf(key), jsonResponse(body))
  }
  const cache = {
    calls: { match: 0, put: 0 },
    deleted: [] as string[],
    async match(key: string) {
      cache.calls.match++
      return store.get(keyOf(key))
    },
    async put(key: string, res: Response) {
      cache.calls.put++
      store.set(keyOf(key), res)
    },
  }
  return cache
}

function withCache(cache: CacheLike | null): CacheStore | undefined {
  return cache ? { open: async () => cache } : undefined
}

describe('loadCatalogChanges', () => {
  it('loads network-first from the exact path, stores the copy and never uses ?v=', async () => {
    const cache = fakeCache()
    const { fetchFn, calls } = makeFetch(() => jsonResponse(artifact()))

    const result = await loadCatalogChanges({ fetchFn, caches: withCache(cache), baseUrl: BASE })

    expect(result).toEqual({ status: 'ready', source: 'network', artifact: artifact() })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(ENDPOINT)
    // network-first is the whole point: the feed must be seen fresh, exactly
    // like catalogo-facets.json (H3).
    expect(calls[0].init?.cache).toBe('no-cache')
    // never versioned: the `?v=` prune would delete it every day and T9's
    // version key belongs to the heavy catalog files only.
    expect(calls.every((c) => !c.url.includes('?v='))).toBe(true)
    expect(cache.calls.put).toBe(1)
  })

  it('returns absent on a 404 and caches nothing', async () => {
    const cache = fakeCache()
    const { fetchFn } = makeFetch(() => new Response('not found', { status: 404 }))

    const result = await loadCatalogChanges({ fetchFn, caches: withCache(cache), baseUrl: BASE })

    expect(result).toEqual({ status: 'absent' })
    expect(cache.calls.put).toBe(0)
  })

  it('treats an SPA-fallback HTML answer as absent and never caches it', async () => {
    const cache = fakeCache()
    const { fetchFn } = makeFetch(() => htmlResponse())

    const result = await loadCatalogChanges({ fetchFn, caches: withCache(cache), baseUrl: BASE })

    expect(result).toEqual({ status: 'absent' })
    expect(cache.calls.put).toBe(0)
  })

  it('rejects a wrong version as invalid and does not cache it', async () => {
    const cache = fakeCache()
    const bad = { ...artifact(), version: 2 }
    const { fetchFn } = makeFetch(() => raw(bad))

    const result = await loadCatalogChanges({ fetchFn, caches: withCache(cache), baseUrl: BASE })

    expect(result).toEqual({ status: 'invalid' })
    expect(cache.calls.put).toBe(0)
  })

  it('rejects a malformed artifact (invalid JSON) as invalid', async () => {
    const { fetchFn } = makeFetch(
      () =>
        new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    const result = await loadCatalogChanges({ fetchFn, baseUrl: BASE })

    expect(result).toEqual({ status: 'invalid' })
  })

  it.each([
    ['dias missing', { version: 1, ventanaDias: 7, generado: '2026-10-15T12:28:27Z' }],
    ['dias not an array', { version: 1, ventanaDias: 7, generado: 'x', dias: 'nope' }],
    [
      'a day without a valid fecha',
      {
        version: 1,
        ventanaDias: 7,
        generado: 'x',
        dias: [
          {
            fecha: 'ayer',
            nuevos: { conteo: 0, truncado: false, valores: [] },
            bajaron: { conteo: 0, truncado: false, valores: [] },
            subieron: { conteo: 0, truncado: false, valores: [] },
          },
        ],
      },
    ],
    [
      'a list with a broken conteo',
      {
        version: 1,
        ventanaDias: 7,
        generado: 'x',
        dias: [
          {
            fecha: '2026-10-15',
            nuevos: { conteo: 'many', truncado: false, valores: [] },
            bajaron: { conteo: 0, truncado: false, valores: [] },
            subieron: { conteo: 0, truncado: false, valores: [] },
          },
        ],
      },
    ],
    [
      'a price move missing fields',
      {
        version: 1,
        ventanaDias: 7,
        generado: 'x',
        dias: [
          {
            fecha: '2026-10-15',
            nuevos: { conteo: 0, truncado: false, valores: [] },
            bajaron: { conteo: 1, truncado: false, valores: [{ nombre: 'YERBA' }] },
            subieron: { conteo: 0, truncado: false, valores: [] },
          },
        ],
      },
    ],
  ])('rejects %s as invalid', async (_label, body) => {
    const { fetchFn } = makeFetch(() => raw(body))

    const result = await loadCatalogChanges({ fetchFn, baseUrl: BASE })

    expect(result).toEqual({ status: 'invalid' })
  })

  it('returns error when the server answers with a non-404 failure', async () => {
    const { fetchFn } = makeFetch(() => new Response('boom', { status: 500 }))

    const result = await loadCatalogChanges({ fetchFn, baseUrl: BASE })

    expect(result).toEqual({ status: 'error' })
  })

  it('falls back to the last known copy when the network is unreachable', async () => {
    const cache = fakeCache()
    // one online load populates the offline copy
    await loadCatalogChanges({
      fetchFn: makeFetch(() => jsonResponse(artifact())).fetchFn,
      caches: withCache(cache),
      baseUrl: BASE,
    })

    const offline = makeFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const result = await loadCatalogChanges({
      fetchFn: offline.fetchFn,
      caches: withCache(cache),
      baseUrl: BASE,
    })

    expect(result).toEqual({ status: 'ready', source: 'cache', artifact: artifact() })
  })

  it('returns offline when the network is unreachable and nothing is cached', async () => {
    const offline = makeFetch(() => {
      throw new TypeError('Failed to fetch')
    })

    const result = await loadCatalogChanges({
      fetchFn: offline.fetchFn,
      caches: withCache(fakeCache()),
      baseUrl: BASE,
    })

    expect(result).toEqual({ status: 'offline' })
  })

  it('does not trust a poisoned cache entry and reports it unreadable', async () => {
    // Defensive: only validated JSON is ever written, but a platform quirk must
    // still degrade to `invalid` (never a raw parse error) instead of rendering
    // invented rows from whatever the cache happened to hold.
    const cache = fakeCache()
    cache.match = async () => new Response('<html>', { status: 200 })
    const offline = makeFetch(() => {
      throw new TypeError('Failed to fetch')
    })

    const result = await loadCatalogChanges({
      fetchFn: offline.fetchFn,
      caches: withCache(cache),
      baseUrl: BASE,
    })

    expect(result).toEqual({ status: 'invalid' })
  })
})
