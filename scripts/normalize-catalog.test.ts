import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

type TestRawItem = {
  id?: unknown
  nombre?: unknown
  categoria?: unknown
  subcategoria?: unknown
  precio: unknown
  enTienda: unknown
}
type TestProduct = {
  id: string
  nombre: string
  marca: string
  categoria: string
  barcode: string
  precio: number
}

const SCRIPT = join(__dirname, 'normalize-catalog.ts')

// Real raw shape contract (confirmed against the actual extraction, 2025):
// top-level array (or { products: [...] }) of items like:
//   { id: uuid, nombre, categoria, subcategoria, precio, enTienda, ... }
// Transformation (documented in scripts/normalize-catalog.mjs):
//   - output record: { id, nombre, marca: '', categoria, precio }
//   - id comes from the raw item id (stable across re-extractions);
//     stableId(nombre) is the fallback when the raw id is missing/empty
//   - excluded from output: precio <= 0 or null. enTienda is NOT an exclusion
//     criterion (real data: only 8 of 23,230 are true — the flag does not
//     mean "available"; verified against the real extraction)
//   - fail-loud: invalid JSON, <20,000 input records, missing nombre,
//     non-numeric precio on an included record
function rawItem(i: number): TestRawItem {
  return {
    id: randomUUID(),
    nombre: `PRODUCTO DE PRUEBA ${i} 500ML`,
    categoria: i % 5 === 0 ? 'Sin categoría' : `Categoria ${i % 20}`,
    subcategoria: '',
    precio: i % 7 === 0 ? 0 : 100 + (i % 500),
    enTienda: i % 10 !== 0,
  }
}

function validRawCatalog(n = 23000): TestRawItem[] {
  return Array.from({ length: n }, (_, i) => rawItem(i))
}

function isIncluded(item: TestRawItem) {
  return typeof item.precio === 'number' && item.precio > 0
}

function runScript(cwd: string, ...args: string[]) {
  try {
    const out = execFileSync('node', [SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (err) {
      const e = err as { status?: number; stderr?: string | Buffer }
    return { code: e.status ?? 1, err: String(e.stderr ?? err) }
  }
}

describe('scripts/normalize-catalog.mjs', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'normalize-test-'))
  })

  it('accepts a valid catalog (exit 0) and emits minimal normalized records with raw ids', () => {
    const input = join(dir, 'valid.json')
    const output = join(dir, 'out', 'catalogo.json')
    const items = validRawCatalog()
    writeFileSync(input, JSON.stringify(items))

    const r = runScript(dir, input, output)
    expect(r.code).toBe(0)

    const catalog = JSON.parse(readFileSync(output, 'utf8')) as { version: string; products: TestProduct[] }
    const expected = items.filter(isIncluded)
    expect(catalog.products.length).toBe(expected.length)
    expect(catalog.version).toEqual(expect.any(String))

    const first = catalog.products[0]
    expect(Object.keys(first).sort()).toEqual([
      'barcode',
      'categoria',
      'id',
      'marca',
      'nombre',
      'precio',
    ])
    expect(first.marca).toBe('')
    expect(first.barcode).toEqual(expect.any(String))
    // ids are the raw extraction ids, preserving order
    expect(catalog.products.map((p) => p.id)).toEqual(
      expected.map((p) => p.id),
    )
  })

  it('excludes zero-price items only (enTienda does not exclude), reporting the counts', () => {
    const input = join(dir, 'valid.json')
    const output = join(dir, 'out', 'catalogo.json')
    const r = runScript(dir, input, output)
    expect(r.code).toBe(0)
    const items = JSON.parse(readFileSync(input, 'utf8')) as TestRawItem[]
    const expectedKept = items.filter(isIncluded).length
    expect(r.out).toContain(`wrote ${expectedKept} records`)
    expect(r.out).toContain('excluded')
    const catalog = JSON.parse(readFileSync(output, 'utf8')) as { version: string; products: TestProduct[] }
    expect(catalog.products.every((p) => p.precio > 0)).toBe(true)
    // enTienda:false must NOT exclude (real data: only 8 of 23,230 are true)
    const keptIds = new Set(catalog.products.map((p) => p.id))
    const notInStoreKept = items.filter(
      (i) => i.enTienda === false && keptIds.has(i.id as string),
    ).length
    expect(notInStoreKept).toBeGreaterThan(0)
  })

  it('falls back to stableId when the raw id is missing or empty', () => {
    const input = join(dir, 'noid.json')
    const output = join(dir, 'noid-out.json')
    const items = validRawCatalog(20001)
    items[101].id = ''
    items[201] = { ...items[201], id: undefined }
    writeFileSync(input, JSON.stringify(items))

    const r = runScript(dir, input, output)
    expect(r.code).toBe(0)
    const catalog = JSON.parse(readFileSync(output, 'utf8')) as { version: string; products: TestProduct[] }
    const byNombre = Object.fromEntries(
      catalog.products.map((p) => [p.nombre, p]),
    )
    expect(byNombre['PRODUCTO DE PRUEBA 101 500ML'].id).toMatch(/^[0-9a-f]{16}$/)
    expect(byNombre['PRODUCTO DE PRUEBA 201 500ML'].id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('fails loud on corrupt JSON (non-zero exit, clear message)', () => {
    const input = join(dir, 'corrupt.json')
    const output = join(dir, 'corrupt-out.json')
    writeFileSync(input, '{not json at all')

    const r = runScript(dir, input, output)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain('catalog')
    expect(() => readFileSync(output)).toThrow()
  })

  it('fails loud when an included record is missing nombre', () => {
    const input = join(dir, 'missing-name.json')
    const output = join(dir, 'missing-out.json')
    const items = validRawCatalog(20001)
    items[501] = { ...items[501], nombre: undefined }
    writeFileSync(input, JSON.stringify(items))

    const r = runScript(dir, input, output)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain('501')
  })

  it('fails loud when the catalog has fewer than 20,000 records', () => {
    const input = join(dir, 'small.json')
    const output = join(dir, 'small-out.json')
    writeFileSync(input, JSON.stringify([rawItem(0), rawItem(1)]))

    const r = runScript(dir, input, output)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain('20,000')
  })

  it('fails loud when an included record has a non-numeric precio', () => {
    const input = join(dir, 'bad-price.json')
    const output = join(dir, 'bad-price-out.json')
    const items = validRawCatalog(20001)
    items[11].precio = 'caro'
    writeFileSync(input, JSON.stringify(items))

    const r = runScript(dir, input, output)
    expect(r.code).not.toBe(0)
  })

  it('accepts an object wrapper { products: [...] }', () => {
    const input = join(dir, 'wrapped.json')
    const output = join(dir, 'wrapped-out.json')
    writeFileSync(input, JSON.stringify({ products: validRawCatalog(20001) }))

    const r = runScript(dir, input, output)
    expect(r.code).toBe(0)
    expect(JSON.parse(readFileSync(output, 'utf8')).products.length).toBeGreaterThan(0)
  })
})
