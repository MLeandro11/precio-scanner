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

/**
 * A big raw that turns the two PREV_PRODUCTS ids into big changes: p1 carries
 * the raw's date fields, p2 does not.
 */
function rawConCambiosGrandes(): Array<Record<string, unknown>> {
  const raw = bigRaw()
  raw[0] = rawRecord(0, {
    id: 'p1',
    nombre: 'Producto que sube',
    categoria: 'Cat',
    barcode: '999',
    precio: 1000,
    actualizado: '2026-09-02T10:00:00.000Z',
    precioCambiado: '2026-09-01T10:00:00.000Z',
  })
  raw[1] = rawRecord(1, {
    id: 'p2',
    nombre: 'Producto sin fecha',
    categoria: 'Cat',
    barcode: '888',
    precio: 2000,
  })
  return raw
}

const PREV_PRODUCTS = [
  { id: 'p1', nombre: 'Producto que sube', marca: '', categoria: 'Cat', barcode: '999', precio: 100 },
  { id: 'p2', nombre: 'Producto que sale', marca: '', categoria: 'Cat', barcode: '888', precio: 200 },
  { id: 'p3', nombre: 'Otro que sale', marca: '', categoria: 'Otra', barcode: '', precio: 300 },
]

/**
 * A catalog that is NOT the baseline. It lives at the `--catalogo` path so a
 * test can tell "read the baseline from --baseline" apart from "read it from the
 * output file": its ids (x1/x2) never appear in PREV_PRODUCTS.
 */
const STALE_PRODUCTS = [
  { id: 'x1', nombre: 'Stale uno', marca: '', categoria: 'Vieja', barcode: '111', precio: 10 },
  { id: 'x2', nombre: 'Stale dos', marca: '', categoria: 'Vieja', barcode: '222', precio: 20 },
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

      // This raw predates the `generada` field (a bare array): no date reaches
      // the facets...
      const facets = JSON.parse(
        readFileSync(join(dir, ...DATA_DIR, 'catalogo-facets.json'), 'utf8'),
      )
      expect(facets).not.toHaveProperty('generada')
      // ...and catalogo.json NEVER carries one, date or no date: its sha256 is
      // the client cache key, so a changing field there would re-download the
      // catalog on every run.
      expect(written).not.toHaveProperty('generada')
      expect(Object.keys(written).sort()).toEqual(['products', 'version'])
    },
    120_000,
  )

  it(
    'a raw with a generada passes the date to the facets and never into catalogo.json',
    () => {
      const dir = makeDir()
      writeFileSync(
        join(dir, 'raw-catalog.json'),
        JSON.stringify({ generada: '2026-10-02T04:00:15.123Z', products: bigRaw() }),
      )

      const r = runRefresh(dir)
      expect(r.code).toBe(0)

      const facets = JSON.parse(
        readFileSync(join(dir, ...DATA_DIR, 'catalogo-facets.json'), 'utf8'),
      )
      expect(facets.generada).toBe('2026-10-02T04:00:15.123Z')

      // The cache key lives in catalogo.json: the date must not get in there.
      const written = JSON.parse(readFileSync(join(dir, ...DATA_DIR, 'catalogo.json'), 'utf8'))
      expect(written).not.toHaveProperty('generada')
      expect(Object.keys(written).sort()).toEqual(['products', 'version'])
    },
    120_000,
  )

  it('a raw with a generada that is not a usable date is treated as no date', () => {
    const dir = makeDir()
    writeFileSync(
      join(dir, 'raw-catalog.json'),
      JSON.stringify({ generada: 'ayer', products: bigRaw() }),
    )

    const r = runRefresh(dir)
    expect(r.code).toBe(0)

    // No valid date to pass, so no flag and no field: the facets stays clean.
    const facets = JSON.parse(
      readFileSync(join(dir, ...DATA_DIR, 'catalogo-facets.json'), 'utf8'),
    )
    expect(facets).not.toHaveProperty('generada')
  }, 120_000)

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

  it(
    'prose report annotates big changes with the raw dates',
    () => {
      const dir = makeDir()
      // Production shape: `extract-catalog` writes {"products": [...]}, so the
      // date map has to be read through `raw.products ?? raw`.
      writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify({ products: rawConCambiosGrandes() }))

      const r = runRefresh(dir, ['--esperado', '20001'])
      expect(r.code).toBe(0)
      // p1 (+900%, with dates) and p2 (+900%, no dates)
      expect(r.out).toContain('cambios grandes (>50%): 2')
      expect(r.out).toContain('con fecha de cambio registrada: 1 · sin fecha: 1')
      expect(r.out).toContain('precioCambiado 2026-09-01T10:00:00.000Z')
      expect(r.out).toContain('actualizado 2026-09-02T10:00:00.000Z')
    },
    120_000,
  )

  it(
    '--baseline reads the diff baseline from its own path and writes the catalog to --catalogo',
    () => {
      // The output path holds a stale, unrelated catalog: if the CLI wrongly used
      // it as the baseline, the report would describe x1/x2, not p1/p2/p3.
      const dir = makeDir({ withCatalog: false })
      const outDir = join(dir, ...DATA_DIR)
      writeFileSync(
        join(outDir, 'catalogo.json'),
        JSON.stringify({ version: 'stale', products: STALE_PRODUCTS }),
      )

      const baselineDir = join(dir, 'baseline')
      mkdirSync(baselineDir, { recursive: true })
      const baselinePath = join(baselineDir, 'catalogo.json')
      const baselineBytes = JSON.stringify({ version: 'baseline', products: PREV_PRODUCTS })
      writeFileSync(baselinePath, baselineBytes)

      const raw = bigRaw()
      raw[0] = rawRecord(0, {
        id: 'p1',
        nombre: 'Producto que sube',
        categoria: 'Cat',
        barcode: '999',
        precio: 150,
      })
      writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify(raw))

      const r = runRefresh(dir, [
        '--json',
        '--baseline',
        baselinePath,
        '--catalogo',
        join('public', 'data', 'catalogo.json'),
        '--esperado',
        '20001',
      ])
      expect(r.code).toBe(0)

      const report = JSON.parse(r.out) as {
        prevConteo: number | null
        bajas: { conteo: number; ejemplos: Array<{ id: string }> }
      }
      // The baseline file was read: 3 products, p2/p3 gone. The output file's
      // x1/x2 are absent, which proves it was not used as the baseline.
      expect(report.prevConteo).toBe(3)
      expect(report.bajas.conteo).toBe(2)
      expect(report.bajas.ejemplos.map((b) => b.id).sort()).toEqual(['p2', 'p3'])
      expect(r.out).not.toContain('x1')

      // The baseline is read-only: byte-identical after the run.
      expect(readFileSync(baselinePath, 'utf8')).toBe(baselineBytes)

      // The regenerated catalog went to --catalogo, not to the baseline.
      const written = JSON.parse(readFileSync(join(outDir, 'catalogo.json'), 'utf8')) as {
        version: string
        products: unknown[]
      }
      expect(written.products).toHaveLength(20001)
      expect(written.version).not.toBe('stale')
      expect(written.version).not.toBe('baseline')
    },
    120_000,
  )

  it(
    'without --baseline the diff baseline is --catalogo itself (behaviour unchanged)',
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

      const r = runRefresh(dir, ['--json', '--esperado', '20001'])
      expect(r.code).toBe(0)
      const report = JSON.parse(r.out) as {
        prevConteo: number | null
        bajas: { conteo: number }
      }
      // The pre-existing public/data/catalogo.json (PREV_PRODUCTS) is the baseline.
      expect(report.prevConteo).toBe(3)
      expect(report.bajas.conteo).toBe(2)
    },
    120_000,
  )

  it('an explicit --baseline that does not exist fails (exit 3) before anything is written', () => {
    const dir = makeDir()
    // A raw big enough to pass validation: if the missing baseline were silently
    // treated as "no baseline", the run would succeed and overwrite public/data.
    writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify(bigRaw()))
    const before = sentinels(dir)

    const r = runRefresh(dir, ['--baseline', join(dir, 'baseline', 'catalogo.json')])
    expect(r.code).toBe(3)
    expect(r.err).toContain('baseline')
    expect(r.err).not.toContain('at Object.')
    expect(sentinels(dir)).toEqual(before)
  })

  it('an unreadable baseline (a directory) fails (exit 3) before anything is written', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify(bigRaw()))
    const dirBaseline = join(dir, 'baseline-is-a-dir')
    mkdirSync(dirBaseline)
    const before = sentinels(dir)

    const r = runRefresh(dir, ['--baseline', dirBaseline])
    expect(r.code).toBe(3)
    expect(r.err).toContain('baseline')
    expect(r.err).not.toContain('at Object.')
    expect(sentinels(dir)).toEqual(before)
  })

  it('a baseline without a products array fails (exit 3) before anything is written', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify(bigRaw()))
    const badBaseline = join(dir, 'bad-baseline.json')
    writeFileSync(badBaseline, JSON.stringify({ version: 'sin-products' }))
    const before = sentinels(dir)

    const r = runRefresh(dir, ['--baseline', badBaseline])
    expect(r.code).toBe(3)
    expect(r.err).toContain('products')
    expect(sentinels(dir)).toEqual(before)
  })

  it(
    '--json report carries the cambios grandes section built from the raw dates',
    () => {
      const dir = makeDir()
      writeFileSync(join(dir, 'raw-catalog.json'), JSON.stringify(rawConCambiosGrandes()))

      const r = runRefresh(dir, ['--json', '--esperado', '20001'])
      expect(r.code).toBe(0)
      const report = JSON.parse(r.out) as {
        cambiosGrandes: {
          umbralPct: number
          conteo: number
          conFechaDeCambio: number | null
          sinFechaDeCambio: number | null
          fechasDisponibles: boolean
          ejemplos: Array<Record<string, unknown>>
        }
      }
      expect(report.cambiosGrandes.umbralPct).toBe(50)
      expect(report.cambiosGrandes.fechasDisponibles).toBe(true)
      expect(report.cambiosGrandes.conteo).toBe(2)
      expect(report.cambiosGrandes.conFechaDeCambio).toBe(1)
      expect(report.cambiosGrandes.sinFechaDeCambio).toBe(1)

      const p1 = report.cambiosGrandes.ejemplos.find((e) => e.id === 'p1')
      expect(p1).toMatchObject({
        id: 'p1',
        nombre: 'Producto que sube',
        precioPrev: 100,
        precioNext: 1000,
        actualizado: '2026-09-02T10:00:00.000Z',
        precioCambiado: '2026-09-01T10:00:00.000Z',
      })
      expect(p1?.pct).toBeCloseTo(900)
      const p2 = report.cambiosGrandes.ejemplos.find((e) => e.id === 'p2')
      expect(p2?.precioCambiado).toBeUndefined()
      expect(p2?.actualizado).toBeUndefined()
    },
    120_000,
  )
})
