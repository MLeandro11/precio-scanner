/**
 * catalogLoader — loads the three catalog data files for the app boot.
 *
 * Strategy (spec FR-4.2):
 *   1. `catalogo-facets.json` is tiny and carries the data `version` hash:
 *      always fetched with cache: 'no-cache' so a new data build is seen
 *      immediately.
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

async function fetchJson<T>(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  label: string,
): Promise<T> {
  const res = await fetchFn(url, init)
  if (!res.ok) {
    throw new Error(`catalogLoader: failed to download ${label} (${res.status} ${url})`)
  }
  const text = await res.text()
  return parseJsonResponse<T>(res, text, label, url)
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

  // 1. facets: always fresh (tiny file, carries the version)
  const facets = await fetchJson<Facets>(
    fetchFn,
    url('catalogo-facets.json'),
    { cache: 'no-cache' },
    'facets',
  )
  const version = facets.version

  // 2. heavy files: versioned cache, network only on miss
  const cache = cachesApi ? await cachesApi.open(CACHE_NAME) : null

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