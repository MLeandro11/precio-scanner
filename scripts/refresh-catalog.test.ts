import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(__dirname, 'refresh-catalog.ts')

/** A raw record that passes both `validarProductos` and `normalize-catalog`. */
function rawRecord(i: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `r${String(i).padStart(6, '0')}`,
    nombre: `Producto de prueba ${i}`,
    categoria: `Categoria ${i % 5}`,
    barcode: i % 3 === 0 ? '' : `77${String(i).padStart(6, '0')}`,
    // kept by normalize (precio > 0), so nextConteo === raw length
    precio: 100 + (i % 50),
    ...over,
  }
}

/** The real pipeline requires >= 20,000 input records, so fixtures are big. */
function bigRaw(n = 20_001): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => rawRecord(i))
}

const PREV_PRODUCTS = [
  { id: 'p1', nombre: 'Producto que sube', marca: '', categoria: 'Cat', barcode: '999', precio: 100 },
  { id: 'p2', nombre: 'Producto que sale', marca: '', categoria: 'Cat', barcode: '888', precio: 200 },
  { id: 'p3', nombre: 'Otro que sale', marca: '', categoria: 'Otra', barcode: '', precio: 300 },
]

const DATA_DIR = ['public', 'data']

function makeDir(opts: { withCatalog?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'refresh-test-'))
  mkdirSync(join(dir, ...DATA_DIR), { recursive: true })
  if (opts.withCatalog !== false) {
    writeFileSync(
      join(dir, ...DATA_DIR, 'catalogo.json'),
      JSON.stringify({ version: 'old-version', products: PREV_PRODUCTS }),
    )
  }
  // Sentinel bytes: a failing run must leave them untouched.
  writeFileSync(join(dir, ...DATA_DIR, 'catalogo-index.json'), 'INDEX-BYTES-OLD')
  writeFileSync(join(dir, ...DATA_DIR, 'catalogo-facets.json'), 'FACETS-BYTES-OLD')
  return dir
}

function sentinels(dir: string) {
  return {
    catalogo: existsSync(join(dir, ...DATA_DIR, 'catalogo.json'))
      ? readFileSync(join(dir, ...DATA_DIR, 'catalogo.json'), 'utf8')
      : null,
    index: readFileSync(join(dir, ...DATA_DIR, 'catalogo-index.json'), 'utf8'),
    facets: readFileSync(join(dir, ...DATA_DIR, 'catalogo-facets.json'), 'utf8'),
  }
}

function runRefresh(cwd: string, args: string[] = []) {
  // spawnSync (not execFileSync) so stdout AND stderr are captured on every
  // exit code, including 0.
  const r = spawnSync('node', [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' }
}

describe('scripts/refresh-catalog.ts', () => {
  it('--help describes usage without running anything', () => {
    const dir = makeDir()
    const before = sentinels(dir)
    const r = runRefresh(dir, ['--help'])
    expect(r.code).toBe(0)
    expect(r.out.toLowerCase()).toContain('uso')
    expect(r.out).toContain('--esperado')
    expect(sentinels(dir)).toEqual(before)
  })

  it('invalid JSON is a validation failure (exit 1) with a clear message, not a stack trace', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'raw-catalog.json'), '{not json at all')
    const before = sentinels(dir)

    const r = runRefresh(dir)
    expect(r.code).toBe(1)
    expect(r.err).toContain('JSON')
    expect(r.err).not.toContain('at Object.')
    expect(sentinels(dir)).toEqual(before)
  })

  it('a failed validation writes NOTHING — catalog and index bytes are untouched', () => {
    const dir = makeDir()
    // raw is a valid array but record 3 has no nombre, and it carries a
    // commercial field that must never reach the logs.
    const raw = bigRaw(30)
    raw[3] = { ...raw[3], nombre: undefined, costo: 987654 }
    writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify(raw))
    const before = sentinels(dir)

    const r = runRefresh(dir)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/nombre/)
    // hygiene: the offending record's fields are never echoed
    expect(r.err).not.toContain('987654')
    expect(r.err).not.toContain('costo')
    expect(sentinels(dir)).toEqual(before)
  })

  it('exits 2 (distinct from 1) when the raw count differs from --esperado', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify(bigRaw(30)))
    const before = sentinels(dir)

    const r = runRefresh(dir, ['--esperado', '31'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('30')
    expect(r.err).toContain('31')
    expect(sentinels(dir)).toEqual(before)
  })

  it('exits 3 when a pipeline step fails (valid raw, but too small for normalize)', () => {
    const dir = makeDir()
    // Small but structurally valid: validation passes, then normalize refuses
    // it (its own 20,000-record floor), which is a pipeline failure.
    writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify(bigRaw(30)))
    const before = sentinels(dir)

    const r = runRefresh(dir)
    expect(r.code).toBe(3)
    expect(r.err).toContain('normalize-catalog')
    expect(sentinels(dir)).toEqual(before)
  })

  it('accepts the raw path positionally', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'custom-raw.json'), JSON.stringify(bigRaw(30)))
    const r = runRefresh(dir, ['custom-raw.json'])
    // With the default raw-catalog.json missing this would be exit 1; reaching
    // the pipeline (exit 3, too small) proves the positional arg was honored.
    expect(r.code).toBe(3)
  })

  it(
    'happy path: validates, runs the pipeline and prints the report with the counts (exit 0)',
    () => {
      const dir = makeDir()
      const raw = bigRaw()
      raw[0] = rawRecord(0, {
        id: 'p1',
        nombre: 'Producto que sube',
        categoria: 'Cat',
        barcode: '999',
        precio: 150,
      })
      writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify(raw))

      const r = runRefresh(dir, ['--esperado', '20001'])
      expect(r.code).toBe(0)
      // prose mode inherits the pipeline output
      expect(r.out).toContain('normalize-catalog:')
      expect(r.out).toContain('generate-index:')
      // report vocabulary: prev/next counts, altas/bajas, orphans, price change
      expect(r.out).toContain('20001')
      expect(r.out).toContain('3')
      expect(r.out).toContain('20000')
      expect(r.out).toContain('bajas: 2')
      expect(r.out).toContain('p2')
      expect(r.out).toContain('p3')
      expect(r.out).toContain('+50.00%')

      // the catalog was really rewritten
      const written = JSON.parse(readFileSync(join(dir, ...DATA_DIR, 'catalogo.json'), 'utf8')) as {
        version: string
        products: unknown[]
      }
      expect(written.products).toHaveLength(20001)
      expect(written.version).not.toBe('old-version')
    },
    120_000,
  )

  it(
    '--json prints the report as a single JSON object, keeping pipeline prose off stdout',
    () => {
      const dir = makeDir({ withCatalog: false })
      writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify(bigRaw()))

      const r = runRefresh(dir, ['--json'])
      expect(r.code).toBe(0)
      expect(r.out.trim().startsWith('{')).toBe(true)
      expect(r.out).not.toContain('normalize-catalog:')

      const report = JSON.parse(r.out) as {
        primeraCarga: boolean
        prevConteo: number | null
        nextConteo: number
        altas: { conteo: number }
      }
      // no previous catalog: reported as a first refresh, not as 20k altas
      expect(report.primeraCarga).toBe(true)
      expect(report.prevConteo).toBeNull()
      expect(report.nextConteo).toBe(20001)
      expect(report.altas.conteo).toBe(0)

      // pipeline output is still visible, on stderr
      expect(r.err).toContain('normalize-catalog:')
    },
    120_000,
  )
})
