import { useEffect, useMemo, useState } from 'react'
import { normalizeEan } from '../lib/lupa/list'
import type { WorkerClient } from '../lib/workerClient'
import type { Producto } from '../lib/types'

/**
 * Resolves a list of EANs to their products. Returns a parallel array
 * (undefined when the ean is unknown). Only the unique eans are resolved; the
 * worker owns the catalog.
 *
 * ONE round-trip per list change: the whole burst goes through the worker's
 * `resolve` message (exact barcode/id lookup — no fuzzy search, no shared
 * generation with the interactive search stream). Before the protocol gained
 * `resolve`, this hook issued one `client.query` per EAN; on the same worker
 * a 30-item list meant 30 round-trips (and the single in-flight query slot
 * made them effectively serial).
 */
export function useResolveEans(
  client: WorkerClient,
  eans: string[],
): Array<Producto | undefined> {
  const unique = useMemo(() => [...new Set(eans.map(normalizeEan))], [eans])
  const [resolved, setResolved] = useState<Record<string, Producto>>({})

  useEffect(() => {
    let alive = true
    setResolved({})
    const eansByDigits: string[] = []
    const catalogIds: string[] = []
    for (const ean of unique) {
      // item keyed by catalog id (products without barcode) vs a real EAN
      if (ean.replace(/\D/g, '').length >= 6) eansByDigits.push(ean)
      else catalogIds.push(ean)
    }
    client
      .resolveMany({ eans: eansByDigits, ids: catalogIds })
      .then((products) => {
        if (!alive) return
        setResolved(products)
      })
      .catch(() => {
        // worker failure on resolve: leave unresolved (list still renders names)
      })
    return () => {
      alive = false
    }
  }, [client, unique])

  return eans.map((ean) => resolved[normalizeEan(ean)])
}
