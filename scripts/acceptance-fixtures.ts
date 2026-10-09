/**
 * acceptance-fixtures — derive the acceptance harness's product fixture from the
 * catalog the app itself serves.
 *
 * Why this exists: `scripts/acceptance.ts` used to hardcode the EAN
 * `7793940219009` in ten places. Once the catalog started refreshing daily from
 * the shop's own system, that product stopped being a fixture and became a real
 * row that can be edited or removed tomorrow — and when it goes, the acceptance
 * run fails for a reason that has nothing to do with the app. The harness now
 * picks a product that satisfies every requirement its code rows impose, and the
 * tests below pin which requirement each error names.
 *
 * Pure: no `fs`, no `fetch`, no `console`, no `process.exit`. The caller reads the
 * catalog; this module only decides.
 */
import type { Producto } from '../src/lib/types.ts'

export interface Requisitos {
  /**
   * Exact digit count a barcode must have to be usable by the harness's code
   * rows. Those rows call the fixture "an exact 13-digit EAN" (FR-2.8a) and
   * re-group it as `779 3940 219009` (FR-2.8b), a 3-4-6 split of exactly 13
   * digits. A shorter code would still take the engine's barcode branch (its
   * floor is 6 digits), but the row would no longer test the criterion it prints.
   */
  digitosDeBarcode: number
}

export type EleccionDeProducto = { producto: Producto } | { error: string }

/**
 * Picks the product every code row in `scripts/acceptance.ts` runs against, or
 * explains which requirement the catalog could not satisfy.
 *
 * Requirements, each read off a row in the harness:
 *  - **Barcode length.** `FR-2.8a` prints "exact 13-digit EAN" and asserts the
 *    query resolves to one product; `FR-2.8b` builds the separated form
 *    (`779 3940 219009`) from it. `separarEan` reconstructs that literal from
 *    whatever EAN this returns, so the barcode must have exactly that many digits.
 *  - **Uniqueness.** `FR-2.8a`, `FR-2.8b`, `SCAN-manual` and `LIST-badge-live` all
 *    assert the code resolves to exactly one product. The search engine's barcode
 *    map returns *every* product stored under a code (`src/lib/searchEngine.ts`,
 *    `barcoMap` is a `Map<string, Producto[]>`), so a repeated barcode would make
 *    those rows read 2 and fail on the data, not on the app.
 *
 * The stored barcode is matched as the raw 13-digit string, not the stripped
 * digits: the engine keys its map by the stored value while the query is stripped,
 * so a barcode like `779-3940-219009` would never be found by a code row at all.
 *
 * Deterministic: candidate products are visited in catalog order, so the same
 * catalog always yields the same product.
 */
export function elegirProductoDePrueba(
  productos: Producto[],
  req: Requisitos,
): EleccionDeProducto {
  const barcodeExacto = new RegExp(`^\\d{${req.digitosDeBarcode}}$`)
  const porBarcode = new Map<string, Producto[]>()

  for (const producto of productos) {
    const barcode = producto?.barcode
    if (typeof barcode !== 'string' || !barcodeExacto.test(barcode)) continue
    const hits = porBarcode.get(barcode)
    if (hits) hits.push(producto)
    else porBarcode.set(barcode, [producto])
  }

  if (porBarcode.size === 0) {
    return {
      error:
        `el catálogo no tiene ningún producto con un código de barras de ` +
        `${req.digitosDeBarcode} dígitos exactos, que es lo que exigen las filas de códigos ` +
        `(FR-2.8a/FR-2.8b: "exact ${req.digitosDeBarcode}-digit EAN")`,
    }
  }

  for (const hits of porBarcode.values()) {
    if (hits.length === 1) return { producto: hits[0]! }
  }

  return {
    error:
      `el catálogo tiene códigos de barras de ${req.digitosDeBarcode} dígitos, pero ninguno ` +
      `identifica a un único producto: todos están repetidos y las filas FR-2.8a/FR-2.8b ` +
      `esperan exactamente 1 resultado`,
  }
}

/**
 * Rebuilds the display grouping the separator row searches for. The historical
 * literal was `779 3940 219009`, i.e. the 13 digits split 3-4-6; this generalizes
 * that split to whatever EAN the picker returns, so the row keeps asserting
 * "separators are stripped" instead of a specific product's rendering. Stripping
 * the separators back off always recovers the original digits.
 */
export function separarEan(ean: string): string {
  const digitos = ean.replace(/\D/g, '')
  const tamanos = [3, 4, 6]
  const partes: string[] = []
  let i = 0
  for (const n of tamanos) {
    if (i >= digitos.length) break
    partes.push(digitos.slice(i, i + n))
    i += n
  }
  if (i < digitos.length) partes.push(digitos.slice(i))
  return partes.join(' ')
}
