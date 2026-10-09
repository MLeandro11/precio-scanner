#!/usr/bin/env node
/**
 * generate-index.ts — public/data/catalogo.json → search assets
 *
 * Emits, into the given output directory (default: public/data):
 *   - catalogo-index.json   Fuse.js pre-generated index (serialized
 *                           Fuse.createIndex output) over keys
 *                           [nombre, marca, categoria].
 *   - catalogo-facets.json  { version, categories, brands, priceBounds } —
 *                           build-time facet data so the client never scans
 *                           the catalog to populate filters. `version` is the
 *                           sha256 of the input catalog bytes and keys the
 *                           client-side cache (spec FR-4.2).
 *
 * Usage: node scripts/generate-index.ts [catalogo.json] [outputDir]
 *                                        [--generada <ISO>]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import Fuse from 'fuse.js'
import type { Catalog, Facets, Producto } from '../src/lib/types.ts'

function fail(msg: string): never {
  console.error(`generate-index: ${msg}`)
  process.exit(1)
}

/** True when `value` is a non-empty string `Date.parse` can read. */
function esFechaValida(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value))
}

/**
 * `[catalogo.json] [outputDir] [--generada <ISO>]`, in any order. The first two
 * positionals keep their old meaning; `--generada` is new and optional.
 */
function parseArgs(argv: string[]): { input?: string; output?: string; generada: string | null } {
  const positionals: string[] = []
  let generada: string | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--generada') {
      const value = argv[++i]
      // Fail loud instead of writing a facets file the app would display wrongly.
      if (!esFechaValida(value)) {
        fail(`--generada necesita una fecha ISO válida (recibí "${value ?? ''}")`)
      }
      generada = value
    } else if (arg.startsWith('--')) {
      fail(`opción desconocida: ${arg}`)
    } else {
      positionals.push(arg)
    }
  }

  if (positionals.length > 2) fail(`argumento de más: ${positionals[2]}`)
  return { input: positionals[0], output: positionals[1], generada }
}

function main(): void {
  const { input: inputArg, output: outputArg, generada } = parseArgs(process.argv.slice(2))
  const input = resolve(inputArg ?? 'public/data/catalogo.json')
  const outputDir = resolve(outputArg ?? 'public/data')

  let catalog: Catalog
  try {
    catalog = JSON.parse(readFileSync(input, 'utf8')) as Catalog
  } catch (err) {
    fail(`cannot read catalog from ${input}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!Array.isArray(catalog?.products) || catalog.products.length === 0) {
    fail(`catalog has no products array: ${input}`)
  }

  const keys = ['nombre', 'categoria']
  const fuseIndex = JSON.parse(
    JSON.stringify(Fuse.createIndex(keys, catalog.products)),
  )
  writeFileSync(
    resolve(outputDir, 'catalogo-index.json'),
    JSON.stringify({ keys, fuseIndex }),
  )

  const categories = [...new Set(catalog.products.map((p) => p.categoria))].sort()
  // marca is empty in the source data for now; only emit non-empty values so
  // the facet list stays meaningful when a future extraction adds brands.
  const brands = [
    ...new Set(catalog.products.map((p) => p.marca).filter(Boolean)),
  ].sort()
  const prices: number[] = catalog.products.map((p) => p.precio)
  const facets: Facets = {
    version: createHash('sha256').update(readFileSync(input)).digest('hex'),
    categories,
    brands,
    priceBounds: { min: Math.min(...prices), max: Math.max(...prices) },
  }
  // The extraction date belongs to `facets` ONLY, never to `catalogo.json`.
  // `version` above is the sha256 of the whole catalog file and keys the
  // client-side cache, so a field that changes every run inside `catalogo.json`
  // would make every installed PWA re-download the catalog daily even when no
  // product changed. It is also taken from the raw extraction (data), not from
  // the clock here, so the pipeline stays reproducible. Do not "fix" this by
  // moving the field.
  //
  // When no flag is passed the field is omitted entirely (not null/undefined),
  // so callers that never pass a date reproduce the previous file byte for byte.
  if (generada !== null) facets.generada = generada
  writeFileSync(resolve(outputDir, 'catalogo-facets.json'), JSON.stringify(facets))

  console.log(
    `generate-index: wrote index (${catalog.products.length} products, ` +
      `${categories.length} categories, ${brands.length} brands) to ${outputDir}`,
  )
}

main()