#!/usr/bin/env node
/**
 * generate-index.mjs — public/data/catalogo.json → search assets
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
 * Usage: node scripts/generate-index.mjs [catalogo.json] [outputDir]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import Fuse from 'fuse.js'

function fail(msg) {
  console.error(`generate-index: ${msg}`)
  process.exit(1)
}

function main() {
  const [, , inputArg, outputArg] = process.argv
  const input = resolve(inputArg ?? 'public/data/catalogo.json')
  const outputDir = resolve(outputArg ?? 'public/data')

  let catalog
  try {
    catalog = JSON.parse(readFileSync(input, 'utf8'))
  } catch (err) {
    fail(`cannot read catalog from ${input}: ${err.message}`)
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
  const prices = catalog.products.map((p) => p.precio)
  const facets = {
    version: createHash('sha256').update(readFileSync(input)).digest('hex'),
    categories,
    brands,
    priceBounds: { min: Math.min(...prices), max: Math.max(...prices) },
  }
  writeFileSync(
    resolve(outputDir, 'catalogo-facets.json'),
    JSON.stringify(facets),
  )

  console.log(
    `generate-index: wrote index (${catalog.products.length} products, ` +
      `${categories.length} categories, ${brands.length} brands) to ${outputDir}`,
  )
}

main()
