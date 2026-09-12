#!/usr/bin/env node
/**
 * normalize-catalog.mjs — raw extraction JSON → public/data/catalogo.json
 *
 * Raw shape contract (confirmed against the real extraction): a top-level
 * array (or { products: [...] }) of items with at least:
 *     id (uuid, source-stable), nombre, categoria, precio, enTienda
 *
 * Transformation:
 *   - Output record: { id, nombre, marca, categoria, barcode, precio }.
 *     `marca` is always '' for now: the source has no brand field. The field
 *     is kept in the model so a future extraction (e.g. proveedorNombre) can
 *     fill it without another shape change. `barcode` is the raw EAN/code
 *     string ('' when absent); it is displayed in the UI and kept for future
 *     code-based lookup, but is not a search key.
 *   - `id` is the raw extraction id (stable across re-extractions). If a raw
 *     id is missing/empty, the fallback is stableId(nombre) — 16 hex chars.
 *   - Excluded from output (noise, not catalog errors): null precio or
 *     precio <= 0. enTienda is NOT an exclusion criterion (real extraction:
 *     only 8 of 23,230 records are true — the flag does not mean
 *     "available"). Exclusion counts are printed.
 *   - Fail-loud (exit non-zero): invalid JSON, fewer than 20,000 INPUT
 *     records (truncated extraction), an included record missing nombre, or
 *     a non-numeric precio on an included record.
 *
 * Usage: node scripts/normalize-catalog.mjs [input.json] [output.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { stableId } from '../src/lib/stableId.mjs'

const MIN_RECORDS = 20_000

const NUMBER_RE = /^-?\d+(?:[.,]\d+)?$/

function fail(msg) {
  console.error(`normalize-catalog: ${msg}`)
  process.exit(1)
}

function parseIncludedPrice(raw, index) {
  if (raw === null || raw === undefined) {
    fail(`record ${index}: included record has no precio`)
  }
  const s = String(raw).trim().replace(',', '.')
  if (!NUMBER_RE.test(s)) {
    fail(`record ${index}: precio is not numeric: "${raw}"`)
  }
  return Number(s)
}

function main() {
  const [, , inputArg, outputArg] = process.argv
  const input = resolve(inputArg ?? 'raw-catalog.json')
  const output = resolve(outputArg ?? 'public/data/catalogo.json')

  let parsed
  try {
    parsed = JSON.parse(readFileSync(input, 'utf8'))
  } catch (err) {
    fail(`cannot read catalog JSON from ${input}: ${err.message}`)
  }

  const items = Array.isArray(parsed) ? parsed : parsed?.products
  if (!Array.isArray(items) || items.length === 0) {
    fail(`input catalog has no products array: ${input}`)
  }
  if (items.length < MIN_RECORDS) {
    fail(
      `catalog has ${items.length} records; expected at least ${MIN_RECORDS.toLocaleString('en-US')} ` +
        `(a smaller file probably means a truncated extraction)`,
    )
  }

  const products = []
  let excludedNoPrice = 0
  let excludedBadPrice = 0
  let fallbackIds = 0

  items.forEach((item, i) => {
    const nombre = String(item?.nombre ?? '').trim()
    if (!nombre) fail(`record ${i}: missing nombre`)
    const precioRaw = item?.precio
    if (precioRaw === null || precioRaw === undefined) {
      excludedNoPrice++
      return
    }
    const precio = parseIncludedPrice(precioRaw, i)
    if (precio <= 0) {
      excludedBadPrice++
      return
    }
    const categoria = String(item?.categoria ?? '').trim()
    const rawId = typeof item?.id === 'string' ? item.id.trim() : ''
    const id = rawId || (fallbackIds++, stableId(nombre))
    const barcode = String(item?.barcode ?? '').trim()
    products.push({ id, nombre, marca: '', categoria, barcode, precio })
  })

  const catalog = { version: '', products }
  catalog.version = createHash('sha256')
    .update(JSON.stringify({ products }))
    .digest('hex')
    .slice(0, 16)

  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify(catalog))

  const excluded = excludedNoPrice + excludedBadPrice
  console.log(
    `normalize-catalog: ${items.length} input records → wrote ${products.length} records to ${output} ` +
      `(version ${catalog.version}); excluded ${excluded} ` +
      `(null precio: ${excludedNoPrice}, precio <= 0: ${excludedBadPrice})` +
      (fallbackIds > 0 ? `; fallback ids generated: ${fallbackIds}` : ''),
  )
}

main()
