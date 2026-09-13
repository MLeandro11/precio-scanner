/**
 * Domain types for the catalog, search and the persisted collections.
 *
 * `Producto` is the single product shape across the catalog, search results
 * and (later) Lupa's EAN-price tracking. Keep it the one source of truth so
 * the worker, the loader and the UI never disagree about a field.
 */

export interface Producto {
  id: string
  nombre: string
  marca: string
  categoria: string
  /** EAN / UPC barcode. Empty string when the product has none. */
  barcode: string
  /** Unit price in minor (integer) currency units. Always numeric. */
  precio: number
}

/** Shape of `public/data/catalogo.json`. */
export interface Catalog {
  version: string
  products: Producto[]
}

/** Shape of `public/data/catalogo-facets.json`. */
export interface Facets {
  version: string
  categories: string[]
  brands: string[]
  priceBounds: { min: number; max: number }
}

/** Shape of `public/data/catalogo-index.json`. */
export interface CatalogIndex {
  keys: string[]
  /** The serialized Fuse.createIndex payload. */
  fuseIndex: unknown
}

/** Sort orders supported by the search engine. */
export type SortOrder = 'relevance' | 'price-asc' | 'price-desc'

/** Filter set accepted by a worker query. */
export interface QueryFilters {
  categoria?: string
  priceMin?: number | null
  priceMax?: number | null
}

/**
 * Parameters a search query accepts. `ids` is the favorites-mode restriction:
 * a non-empty array limits matches to those product ids; null/undefined/empty
 * means no restriction.
 */
export interface QueryParams extends QueryFilters {
  query?: string
  sort?: SortOrder
  limit?: number
  offset?: number
  ids?: string[] | null
}

/** The result envelope a worker query resolves to. */
export interface QueryResult {
  results: Producto[]
  total: number
}

/** Message protocol between the main thread and the catalog worker. */
export interface WorkerInitMessage {
  type: 'init'
  products: Producto[]
  index?: unknown
  facets?: unknown
}
export interface WorkerQueryMessage extends QueryParams {
  type: 'query'
  id: number
}
export interface WorkerReadyMessage {
  type: 'ready'
}
export interface WorkerResultsMessage {
  type: 'results'
  id: number
  results: Producto[]
  total: number
}
export type WorkerInMessage = WorkerInitMessage | WorkerQueryMessage
export type WorkerOutMessage = WorkerReadyMessage | WorkerResultsMessage