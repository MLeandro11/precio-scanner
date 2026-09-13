import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const SCRIPT = join(__dirname, 'generate-index.ts')

function smallCatalog() {
  const products = Array.from({ length: 30 }, (_, i) => ({
    id: `id${String(i).padStart(4, '0')}`,
    nombre: `Producto ${i} lata 500ml`,
    marca: '',
    categoria: `Categoria ${i % 3}`,
    precio: 100 + i,
  }))
  return { version: 'abc123', products }
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

describe('scripts/generate-index.mjs', () => {
  it('emits a Fuse pre-index, facets with data.version, and price bounds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'genidx-test-'))
    const input = join(dir, 'catalogo.json')
    const catalogJson = JSON.stringify(smallCatalog())
    writeFileSync(input, catalogJson)

    const r = runScript(dir, input, dir)
    expect(r.code).toBe(0)

    const index = JSON.parse(
      readFileSync(join(dir, 'catalogo-index.json'), 'utf8'),
    )
    expect(index.keys).toEqual(['nombre', 'categoria'])
    expect(index.fuseIndex).toEqual(expect.anything())

    const facets = JSON.parse(
      readFileSync(join(dir, 'catalogo-facets.json'), 'utf8'),
    )
    expect(facets.version).toBe(
      createHash('sha256').update(catalogJson).digest('hex'),
    )
    expect(facets.categories).toEqual([
      'Categoria 0',
      'Categoria 1',
      'Categoria 2',
    ])
    // marca is empty in the source data for now: no brand facet in Phase 1
    expect(facets.brands).toEqual([])
    expect(facets.priceBounds).toEqual({ min: 100, max: 129 })
  })

  it('is deterministic: same input, same version hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'genidx-det-'))
    const input = join(dir, 'catalogo.json')
    writeFileSync(input, JSON.stringify(smallCatalog()))

    runScript(dir, input, dir)
    const v1 = JSON.parse(
      readFileSync(join(dir, 'catalogo-facets.json'), 'utf8'),
    ).version

    runScript(dir, input, dir)
    const v2 = JSON.parse(
      readFileSync(join(dir, 'catalogo-facets.json'), 'utf8'),
    ).version

    expect(v1).toBe(v2)
    expect(existsSync(join(dir, 'catalogo-index.json'))).toBe(true)
  })

  it('fails loud when the input catalog is missing or unreadable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'genidx-miss-'))
    const r = runScript(dir, join(dir, 'nope.json'), dir)
    expect(r.code).not.toBe(0)
  })
})
