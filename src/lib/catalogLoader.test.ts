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

interface FakeCache extends CacheLike {
  calls: { match: number; put: number; keys: number; delete: number }
  /** URLs the fake was asked to delete, in call order (normalized absolute). */
  deleted: string[]
  keys(): Promise<Request[]>
  delete(request: Request): Promise<boolean>
}

/**
 * The real Cache stores requests against absolute URLs, so the fake normalizes
 * the string keys the loader puts/matches with and the `Request` objects
 * `keys()`/`delete()` hand back to the same form. `seed` lets a test start from
 * a cache that already holds entries of earlier versions.
 */
function fakeCache(seed: Record<string, unknown> = {}): FakeCache {
  const keyOf = (input: string | Request) =>
    new URL(typeof input === 'string' ? input : input.url, 'http://localhost').toString()
  const store = new Map<string, Response>()
  for (const [key, body] of Object.entries(seed)) {
    store.set(keyOf(key), jsonResponse(body))
  }
  const cache: FakeCache = {
    calls: { match: 0, put: 0, keys: 0, delete: 0 },
    deleted: [],
    async match(key: string) {
      cache.calls.match++
      return store.get(keyOf(key))
    },
    async put(key: string, res: Response) {
      cache.calls.put++
      store.set(keyOf(key), res)
    },
    async keys() {
      cache.calls.keys++
      return [...store.keys()].map((url) => new Request(url))
    },
    async delete(request: Request) {
      cache.calls.delete++
      const key = keyOf(request)
      cache.deleted.push(key)
      return store.delete(key)
    },
  }
  return cache
}

/** The two heavy files cached under a given `?v=` version. */
function versionedEntries(version: string): Record<string, unknown> {
  return {
    [`${BASE}data/catalogo.json?v=${version}`]: CATALOG,
    [`${BASE}data/catalogo-index.json?v=${version}`]: INDEX,
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

  /*
   * Pruning (T9). The cache can only shrink: a daily refresh mints a new `?v=`
   * every day, so without this an installed PWA accumulates ~5.5 MB of heavy
   * files per day, forever. Nothing here may ever cost the user the boot.
   */
  it('prunes the entries of earlier versions after a successful load', async () => {
    const OLD = 'old999'
    const cache = fakeCache({
      ...versionedEntries(OLD),
      ...versionedEntries(FACETS.version), // the version in use
      [`${BASE}data/catalogo-facets.json`]: FACETS,
    })
    const { deps } = makeDeps({ cache })

    const result = await loadCatalog(deps)

    expect(result.products).toEqual(CATALOG.products)
    // exactly the two old-version entries, named one by one
    expect(cache.deleted).toEqual([
      `http://localhost${BASE}data/catalogo.json?v=${OLD}`,
      `http://localhost${BASE}data/catalogo-index.json?v=${OLD}`,
    ])
    // the version in use and the unversioned facets entry survive
    expect(await cache.match(`${BASE}data/catalogo.json?v=${FACETS.version}`)).toBeDefined()
    expect(await cache.match(`${BASE}data/catalogo-index.json?v=${FACETS.version}`)).toBeDefined()
    expect(await cache.match(`${BASE}data/catalogo-facets.json`)).toBeDefined()
  })

  it('deletes nothing on a fresh cache that only holds the current version', async () => {
    const cache = fakeCache()
    const { deps } = makeDeps({ cache })

    await loadCatalog(deps)

    expect(cache.calls.keys).toBe(1) // pruning ran...
    expect(cache.deleted).toEqual([]) // ...and found nothing old
    expect(cache.calls.delete).toBe(0)
  })

  it('prunes nothing on an offline load: the cached version is the version in use', async () => {
    const cache = fakeCache()
    await loadCatalog(makeDeps({ cache }).deps) // online boot populates the current version
    const keysBefore = cache.calls.keys

    const offline: typeof fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    const result = await loadCatalog({
      fetchFn: offline,
      caches: { open: async () => cache },
      baseUrl: BASE,
    })

    expect(result.catalogVersion).toBe(CATALOG.version)
    expect(cache.calls.keys).toBe(keysBefore + 1) // pruning ran on this load too...
    expect(cache.deleted).toEqual([]) // ...and deleted nothing
    // the files the offline boot just read are intact
    expect(await cache.match(`${BASE}data/catalogo.json?v=${FACETS.version}`)).toBeDefined()
  })

  it('deletes nothing when the load fails, and still propagates the error', async () => {
    const OLD = 'old999'
    const cache = fakeCache({
      ...versionedEntries(OLD),
      [`${BASE}data/catalogo-facets.json`]: FACETS,
    })
    const { deps } = makeDeps({ cache, catalogStatus: 500 })

    await expect(loadCatalog(deps)).rejects.toThrow(/catalog/)
    expect(cache.calls.keys).toBe(0) // pruning never even started
    expect(cache.deleted).toEqual([])
    // the last working set is untouched, not partially evicted
    expect(await cache.match(`${BASE}data/catalogo.json?v=${OLD}`)).toBeDefined()
  })

  it('still returns the catalog when pruning fails because keys() rejects', async () => {
    const cache = fakeCache()
    cache.keys = async () => {
      throw new Error('cache refuses to enumerate')
    }
    const { deps } = makeDeps({ cache })

    const result = await loadCatalog(deps)

    expect(result.products).toEqual(CATALOG.products)
    expect(result.index.keys).toEqual(INDEX.keys)
  })

  it('still returns the catalog when a prune delete() rejects', async () => {
    const OLD = 'old999'
    const cache = fakeCache({
      ...versionedEntries(OLD),
      [`${BASE}data/catalogo-facets.json`]: FACETS,
    })
    cache.delete = async () => {
      cache.calls.delete++
      throw new Error('cache refuses to delete')
    }
    const { deps } = makeDeps({ cache })

    const result = await loadCatalog(deps)

    expect(result.products).toEqual(CATALOG.products)
    expect(cache.calls.keys).toBe(1)
    expect(cache.calls.delete).toBe(2) // both old-version entries attempted, both rejected
  })
})