import { describe, it, expect } from 'vitest'
import { loadCatalog } from './catalogLoader'
import type { CacheLike, CacheStore } from './catalogLoader'
import type { Facets, Catalog, CatalogIndex } from './types'

const BASE = '/precio-scanner/'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const FACETS: Facets = { version: 'abc123', categories: ['A'], brands: [], priceBounds: { min: 1, max: 10 } }
const CATALOG: Catalog = {
  version: 'catver1',
  products: [{ id: 'x', nombre: 'N', marca: '', categoria: 'A', barcode: '', precio: 5 }],
}
const INDEX: CatalogIndex = { keys: ['nombre', 'categoria'], fuseIndex: { tags: {} } }

function fakeCache(): CacheLike & { calls: { match: number; put: number } } {
  const store = new Map<string, Response>()
  return {
    calls: { match: 0, put: 0 },
    async match(key: string) {
      this.calls.match++
      return store.get(key) ?? undefined
    },
    async put(key: string, res: Response) {
      this.calls.put++
      store.set(key, res)
    },
  }
}

function makeDeps({ cache = null, catalogStatus = 200 }: { cache?: CacheLike | null; catalogStatus?: number } = {}) {
  const fetched: string[] = []
  const fetchFn: typeof fetch = async (url: RequestInfo | URL) => {
    fetched.push(String(url))
    if (String(url).includes('catalogo-facets.json')) return jsonResponse(FACETS)
    if (String(url).includes('catalogo-index.json')) return jsonResponse(INDEX)
    if (catalogStatus !== 200) return new Response('nope', { status: catalogStatus })
    return jsonResponse(CATALOG)
  }
  const caches: CacheStore | undefined = cache ? { open: async () => cache } : undefined
  return { deps: { fetchFn, caches, baseUrl: BASE }, fetched }
}

describe('catalogLoader', () => {
  it('fetches facets network-first and the catalog+index files, storing all three', async () => {
    const cache = fakeCache()
    const { deps, fetched } = makeDeps({ cache })

    const result = await loadCatalog(deps)

    expect(result.products).toEqual(CATALOG.products)
    expect(result.facets.version).toBe('abc123')
    expect(result.index.keys).toEqual(['nombre', 'categoria'])
    // facets try the network first (fresh version check) and use the exact
    // public/data/ path (this caught a real bug: URLs missing /data/)
    expect(fetched.some((u) => u.endsWith('/data/catalogo-facets.json'))).toBe(true)
    // all three are stored: facets under a stable key, the heavy two versioned
    expect(cache.calls.put).toBe(3)
    expect(fetched.some((u) => u.endsWith('/data/catalogo.json?v=abc123'))).toBe(true)
    expect(fetched.some((u) => u.endsWith('/data/catalogo-index.json?v=abc123'))).toBe(true)
  })

  it('serves catalog+index from cache on a version hit (no network for the big files)', async () => {
    const cache = fakeCache()
    // pre-warm: first load populates the cache
    await loadCatalog(makeDeps({ cache }).deps)

    // second load: track network calls; facets still fetched, big files not
    const { deps, fetched } = makeDeps({ cache })
    const result = await loadCatalog(deps)

    expect(result.products).toEqual(CATALOG.products)
    expect(cache.calls.match).toBeGreaterThanOrEqual(2)
    expect(fetched.some((u) => u.includes('catalogo.json?v='))).toBe(false)
    expect(fetched.some((u) => u.includes('catalogo-index.json?v='))).toBe(false)
  })

  it('re-downloads big files when the facets version changes (cache miss by new key)', async () => {
    const cache = fakeCache()
    await loadCatalog(makeDeps({ cache }).deps)

    // new data version → different ?v= keys → misses → network
    const FACETS2: Facets = { ...FACETS, version: 'def456' }
    const fetchFn: typeof fetch = async (url: RequestInfo | URL) => {
      if (String(url).includes('catalogo-facets.json')) return jsonResponse(FACETS2)
      if (String(url).includes('catalogo-index.json')) return jsonResponse(INDEX)
      return jsonResponse(CATALOG)
    }
    const result = await loadCatalog({
      fetchFn,
      caches: { open: async () => cache },
      baseUrl: BASE,
    })
    expect(result.products).toEqual(CATALOG.products)
    expect(cache.calls.put).toBe(6) // 3 from the first load + 3 from the re-download
  })

  it('throws a clear error when the dev server returns HTML instead of JSON', async () => {
    // e.g. Vite 7 dev server started before public/data existed: its public
    // files Set lacks the JSONs and the SPA fallback answers with index.html
    const fetchFn: typeof fetch = async () =>
      new Response('<!doctype html><html lang="es">...', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    await expect(
      loadCatalog({ fetchFn, baseUrl: BASE }),
    ).rejects.toThrow(/HTML.*restart `npm run dev`/i)
  })

  it('throws a clear error when facets cannot be fetched', async () => {
    const fetchFn: typeof fetch = async () => new Response('nope', { status: 404 })
    await expect(
      loadCatalog({ fetchFn, baseUrl: BASE }),
    ).rejects.toThrow(/facets/)
  })

  /*
   * Offline (FR-11.2). What matters is the distinction these two tests pin down: a
   * request that never completed is offline and may fall back to the last known facets,
   * while a server that answers badly stays fatal. Collapsing the two would let a stale
   * cached copy hide a deployment where public/data/ stopped being published.
   */
  it('falls back to the cached facets when the network is unreachable', async () => {
    const cache = fakeCache()
    // one online boot populates both the facets copy and the versioned heavy files
    await loadCatalog(makeDeps({ cache }).deps)

    // offline: fetch rejects the way it does when the request never completes
    const offline: typeof fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    const result = await loadCatalog({
      fetchFn: offline,
      caches: { open: async () => cache },
      baseUrl: BASE,
    })

    expect(result.facets.version).toBe('abc123')
    expect(result.products).toEqual(CATALOG.products)
    expect(result.index.keys).toEqual(['nombre', 'categoria'])
  })

  it('offline, reaches the network only for the facets and serves the heavy files from cache', async () => {
    const cache = fakeCache()
    await loadCatalog(makeDeps({ cache }).deps)

    const attempts: string[] = []
    const offline: typeof fetch = async (url: RequestInfo | URL) => {
      attempts.push(String(url))
      throw new TypeError('Failed to fetch')
    }
    const result = await loadCatalog({
      fetchFn: offline,
      caches: { open: async () => cache },
      baseUrl: BASE,
    })

    expect(result.catalogVersion).toBe(CATALOG.version)
    // The facets are attempted (network-first) and that is the ONLY request. The
    // versioned catalog and index come from the cache, which is the whole point of
    // storing 5.5 MB that was previously unreachable offline.
    expect(attempts).toEqual([`${BASE}data/catalogo-facets.json`])
  })

  it('fails clearly when offline on a first visit, with nothing cached', async () => {
    const offline: typeof fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(
      loadCatalog({ fetchFn: offline, caches: { open: async () => fakeCache() }, baseUrl: BASE }),
    ).rejects.toThrow(/offline with no cached facets/)
  })

  it('throws a clear error when the catalog fails to download', async () => {
    const { deps } = makeDeps({ catalogStatus: 500 })
    await expect(loadCatalog(deps)).rejects.toThrow(/catalog/)
  })
})