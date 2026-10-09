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
  /**
   * When the dataset was extracted, taken from the raw extraction's own
   * `generada` (never the clock at generate time). Optional and absent when
   * the raw carried no usable date.
   *
   * It deliberately lives here and NOT in `catalogo.json`: `version` above is
   * the sha256 of the whole catalog file and keys the client-side cache, so a
   * field that changes on every run inside `catalogo.json` would make every
   * installed PWA re-download the catalog daily. A future reader moving this
   * field into the catalog would break the cache.
   */
  generada?: string
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
/**
 * Bulk exact resolution for list views: given EANs (and/or product ids for
 * barcode-less items), answer each with its product, without running the
 * search/fuzzy pipeline and without touching the search query generation.
 * Unlike `query`, several resolve requests may be in flight — list resolution
 * is not the interactive search stream.
 */
export interface WorkerResolveMessage {
  type: 'resolve'
  id: number
  /** Exact barcodes (digits-only, ≥ 6 digits per the UI's EAN rule). */
  eans?: string[]
  /** Product ids (items keyed by catalog id — products without barcode). */
  ids?: string[]
}
export interface WorkerResolvedMessage {
  type: 'resolved'
  id: number
  /** Parallel to the request: ean → product, id → product. Unknown keys are absent. */
  products: Record<string, Producto>
}
export type WorkerInMessage = WorkerInitMessage | WorkerQueryMessage | WorkerResolveMessage
export type WorkerOutMessage =
  | WorkerReadyMessage
  | WorkerResultsMessage
  | WorkerResolvedMessage