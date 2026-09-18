/**
 * catalogLoader — loads the three catalog data files for the app boot.
 *
 * Strategy (spec FR-4.2):
 *   1. `catalogo-facets.json` is tiny and carries the data `version` hash:
 *      network-first with `cache: 'no-cache'` so a new data build is seen
 *      immediately, plus the last known copy as the offline fallback. Without
 *      that fallback the boot cannot get past this step offline, which makes
 *      every byte of the cache below unreachable: the app would hold 5.5 MB it
 *      can never read.
 *   2. `catalogo.json` and `catalogo-index.json` (the heavy files) are cached
 *      in the Cache API under versioned keys (`path?v=<version>`): first
 *      visit downloads them, every later visit is served from cache with zero
 *      network. A new version changes the key → automatic invalidation.
 *
 * The Cache API only exists in browser (secure) contexts; when absent the
 * loader degrades to plain fetches. All I/O is injectable for tests.
 *
 * Every response is validated: a 200 that carries HTML instead of JSON means
 * the file is missing server-side and an SPA fallback answered (classic cause:
 * a dev server started before public/data/ was generated — its public-file
 * cache is stale). That must fail loudly, never be cached, and never produce
 * a cryptic JSON.parse error.
 */
import type { Catalog, CatalogIndex, Facets, Producto } from './types'

const CACHE_NAME = 'precio-scanner-data-v1'
const CACHEABLE = ['catalogo.json', 'catalogo-index.json']

/** Minimal shape of a Cache entry the loader needs (injectable for tests). */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>
  put(key: string, response: Response): Promise<void>
}
/** Minimal shape of the Cache API the loader needs. */
export interface CacheStore {
  open(name: string): Promise<CacheLike>
}

function defaultBaseUrl(): string {
  // Vite injects import.meta.env in the app; fall back for non-Vite contexts.
  try {
    return (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  } catch {
    return '/'
  }
}

function parseJsonResponse<T>(
  res: Response,
  text: string,
  label: string,
  url: string,
): T {
  if (
    res.headers.get('content-type')?.includes('text/html') ||
    /^\s*<!doctype|<html/i.test(text)
  ) {
    throw new Error(
      `catalogLoader: received HTML instead of JSON for ${label} (${url}). ` +
        `The file is missing server-side; restart \`npm run dev\` so Vite picks up public/data/`,
    )
  }
  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new Error(
      `catalogLoader: invalid JSON for ${label} (${url}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

interface LoaderDeps {
  fetchFn?: typeof fetch
  caches?: CacheStore | null
  baseUrl?: string
}

export interface LoadedCatalog {
  products: Producto[]
  catalogVersion: string
  facets: Facets
  index: CatalogIndex
}

export async function loadCatalog(deps: LoaderDeps = {}): Promise<LoadedCatalog> {
  const fetchFn: typeof fetch = deps.fetchFn ?? fetch
  const cachesApi = deps.caches ?? (globalThis as { caches?: CacheStore }).caches ?? null
  const baseUrl = deps.baseUrl ?? defaultBaseUrl()
  const url = (path: string) => baseUrl + 'data/' + path

  const cache = cachesApi ? await cachesApi.open(CACHE_NAME) : null

  // 1. facets: network-first, so a new data build is still seen immediately, with the
  // last known copy as the offline fallback.
  const facetsKey = url('catalogo-facets.json')
  const facets = await loadFacets()
  const version = facets.version

  async function loadFacets(): Promise<Facets> {
    let response: Response | null = null
    try {
      response = await fetchFn(facetsKey, { cache: 'no-cache' })
    } catch {
      // `fetch` rejects only when the request never completed — the offline signal.
      response = null
    }

    if (!response) {
      const hit = await cache?.match(facetsKey)
      if (!hit) {
        throw new Error(
          `catalogLoader: offline with no cached facets (${facetsKey}). ` +
            'The first visit needs a network connection once.',
        )
      }
      return (await hit.json()) as Facets
    }

    // A server that is reached and answers badly is a deployment problem, not an
    // offline condition. It must keep failing loudly instead of being masked by a
    // stale cached copy.
    if (!response.ok) {
      throw new Error(
        `catalogLoader: failed to download facets (${response.status} ${facetsKey})`,
      )
    }

    const fresh = parseJsonResponse<Facets>(
      response,
      await response.text(),
      'facets',
      facetsKey,
    )
    await cache?.put(
      facetsKey,
      new Response(JSON.stringify(fresh), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    return fresh
  }

  // 2. heavy files: versioned cache, network only on miss

  async function fetchVersioned(path: string): Promise<Catalog | CatalogIndex> {
    const keyedUrl = `${url(path)}?v=${version}`
    if (cache) {
      const hit = await cache.match(keyedUrl)
      if (hit) return (await hit.json()) as Catalog & CatalogIndex
    }
    const res = await fetchFn(keyedUrl)
    if (!res.ok) {
      throw new Error(`catalogLoader: failed to download ${path} (${res.status})`)
    }
    const text = await res.text()
    const data = parseJsonResponse<Catalog & CatalogIndex>(res, text, path, keyedUrl)
    if (cache) {
      // cache the validated JSON (never the raw response: it may be an HTML
      // fallback that must not be poisoned into the versioned cache)
      await cache.put(
        keyedUrl,
        new Response(text, {
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    return data
  }

  const [catalog, index] = (await Promise.all(CACHEABLE.map(fetchVersioned))) as [
    Catalog,
    CatalogIndex,
  ]
  return { products: catalog.products, catalogVersion: catalog.version, facets, index }
}