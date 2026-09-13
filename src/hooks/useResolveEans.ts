import { useEffect, useMemo, useState } from 'react'
import { normalizeEan } from '../lib/lupa/list'
import type { WorkerClient } from '../lib/workerClient'
import type { Producto } from '../lib/types'

/**
 * Resolves a list of EANs to their products via the catalog worker's exact
 * barcode path. Returns a parallel array (undefined when the ean is unknown).
 * Only the unique eans are queried; the worker owns the catalog.
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
    Promise.all(
      unique.map(async (ean) => {
        const digits = ean.replace(/\D/g, '')
        let product: Producto | undefined
        if (digits.length >= 6) {
          const r = await client.query({ query: digits, limit: 30 })
          product = r.results.find(
            (p) => normalizeEan(p.barcode).replace(/\D/g, '') === digits,
          )
        } else {
          // item keyed by catalog id (products without barcode)
          const byId = await client.query({ query: '', ids: [ean], limit: 1 })
          product = byId.results[0]
        }
        return [ean, product] as const
      }),
    )
      .then((pairs) => {
        if (!alive) return
        const obj: Record<string, Producto> = {}
        for (const [ean, product] of pairs) {
          if (product) obj[ean] = product
        }
        setResolved(obj)
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