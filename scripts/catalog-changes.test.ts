import { describe, it, expect } from 'vitest'
import {
  CAP_DAY,
  CHANGES_VERSION,
  WINDOW_DAYS,
  buildChangesArtifact,
  parseChangesArtifact,
} from './catalog-changes.ts'
import type { BuildChangesResult, ChangeDay } from './catalog-changes.ts'
import type { ProductoLite } from './catalog-diff.ts'

/** Minimal valid product builder; `id` is the only required override. */
function prod(over: Partial<ProductoLite> & { id: string }): ProductoLite {
  return {
    id: over.id,
    nombre: over.nombre ?? `Producto ${over.id}`,
    marca: over.marca ?? '',
    categoria: over.categoria ?? 'Categoria A',
    barcode: over.barcode ?? '',
    precio: over.precio ?? 100,
  }
}

/** One day of a previous artifact, with empty lists unless overridden. */
function day(fecha: string, over: Partial<ChangeDay> = {}): ChangeDay {
  return {
    fecha,
    nuevos: { conteo: 0, truncado: false, valores: [] },
    bajaron: { conteo: 0, truncado: false, valores: [] },
    subieron: { conteo: 0, truncado: false, valores: [] },
    ...over,
  }
}

function artifactText(dias: ChangeDay[], over: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, ventanaDias: 7, generado: '2026-10-15T00:00:00Z', dias, ...over })
}

function build(
  previous: ProductoLite[] | null,
  current: ProductoLite[],
  previousText: string | null = null,
  generatedAt = '2026-10-15T12:00:00Z',
): BuildChangesResult {
  return buildChangesArtifact({
    previous,
    current,
    previousArtifact: parseChangesArtifact(previousText),
    generatedAt,
  })
}

describe('buildChangesArtifact', () => {
  it('carries the frozen contract fields and nothing else', () => {
    const r = build([], [], null)

    expect(r.artifact.version).toBe(CHANGES_VERSION)
    expect(r.artifact.ventanaDias).toBe(WINDOW_DAYS)
    expect(r.artifact.generado).toBe('2026-10-15T12:00:00Z')
    expect(Object.keys(r.artifact).sort()).toEqual(['dias', 'generado', 'ventanaDias', 'version'])
    expect(r.artifact.dias).toHaveLength(1)
    expect(r.artifact.dias[0].fecha).toBe('2026-10-15')
  })

  it('builds the day from the two catalogs: new products, rises and drops', () => {
    const previous = [
      prod({ id: 'p1', nombre: 'Sube', barcode: '7790000000001', precio: 100 }),
      prod({ id: 'p2', nombre: 'Baja', barcode: '7790000000002', precio: 200 }),
      prod({ id: 'p3', nombre: 'Igual', barcode: '7790000000003', precio: 300 }),
    ]
    const current = [
      prod({ id: 'p1', nombre: 'Sube', barcode: '7790000000001', precio: 150 }),
      prod({ id: 'p2', nombre: 'Baja', barcode: '7790000000002', precio: 150 }),
      prod({ id: 'p3', nombre: 'Igual', barcode: '7790000000003', precio: 300 }),
      prod({ id: 'p4', nombre: 'Nuevo', barcode: '7790000000004', precio: 400 }),
    ]

    const [hoy] = build(previous, current).artifact.dias

    expect(hoy.fecha).toBe('2026-10-15')
    expect(hoy.nuevos).toEqual({
      conteo: 1,
      truncado: false,
      valores: [{ ean: '7790000000004', nombre: 'Nuevo', precio: 400 }],
    })
    expect(hoy.subieron.conteo).toBe(1)
    expect(hoy.subieron.valores[0]).toEqual({
      ean: '7790000000001',
      nombre: 'Sube',
      antes: 100,
      ahora: 150,
      pct: 50,
    })
    expect(hoy.bajaron.conteo).toBe(1)
    expect(hoy.bajaron.valores[0]).toEqual({
      ean: '7790000000002',
      nombre: 'Baja',
      antes: 200,
      ahora: 150,
      pct: -25,
    })
    // "Igual" never appears: an unchanged price is not a change.
    expect(JSON.stringify(hoy)).not.toContain('7790000000003')
  })

  it('keeps bajaron and subieron as separate unsigned lists', () => {
    const previous = [
      prod({ id: 'r', barcode: '7790000000011', precio: 100 }),
      prod({ id: 'd', barcode: '7790000000012', precio: 100 }),
    ]
    const current = [
      prod({ id: 'r', barcode: '7790000000011', precio: 200 }),
      prod({ id: 'd', barcode: '7790000000012', precio: 50 }),
    ]

    const [hoy] = build(previous, current).artifact.dias

    expect(hoy.subieron.valores.map((v) => v.pct)).toEqual([100])
    expect(hoy.bajaron.valores.map((v) => v.pct)).toEqual([-50])
  })

  it('rounds pct to two decimals as the sample contract shows', () => {
    const previous = [prod({ id: 'a', precio: 1290 }), prod({ id: 'b', precio: 240 })]
    const current = [prod({ id: 'a', precio: 1150 }), prod({ id: 'b', precio: 2900 })]

    const [hoy] = build(previous, current).artifact.dias

    expect(hoy.bajaron.valores[0].pct).toBe(-10.85)
    expect(hoy.subieron.valores[0].pct).toBe(1108.33)
  })

  it('nulls the ean when the barcode is unusable and keeps it when it is a real code', () => {
    const current = [
      prod({ id: 'p1', nombre: 'Sin barcode', barcode: '', precio: 10 }),
      prod({ id: 'p2', nombre: 'Corto', barcode: '12345', precio: 10 }),
      prod({ id: 'p3', nombre: 'Once dígitos', barcode: '77984796000', precio: 10 }),
      prod({ id: 'p4', nombre: 'Real', barcode: '7798479600021', precio: 10 }),
    ]

    const [hoy] = build([], current, artifactText([day('2026-10-14')])).artifact.dias

    expect(hoy.nuevos.valores.map((v) => v.ean)).toEqual([null, null, '77984796000', '7798479600021'])
  })

  it('resolves the ean by joining on id against the current catalog, never the previous barcode', () => {
    const previous = [prod({ id: 'p1', nombre: 'Viejo', barcode: '0000000000000', precio: 100 })]
    const current = [prod({ id: 'p1', nombre: 'Nuevo', barcode: '7790000000099', precio: 120 })]

    const [hoy] = build(previous, current).artifact.dias

    expect(hoy.subieron.valores[0].ean).toBe('7790000000099')
  })

  it('caps each list at CAP_DAY per day and keeps the exact count', () => {
    const total = CAP_DAY + 50
    const previous = Array.from({ length: total }, (_, i) => prod({ id: `id-${i}`, precio: 100 }))
    const current = Array.from({ length: total }, (_, i) => prod({ id: `id-${i}`, precio: 90 }))

    const [hoy] = build(previous, current).artifact.dias

    expect(hoy.bajaron.conteo).toBe(total)
    expect(hoy.bajaron.truncado).toBe(true)
    expect(hoy.bajaron.valores).toHaveLength(CAP_DAY)
    expect(hoy.subieron.conteo).toBe(0)
    expect(hoy.nuevos.conteo).toBe(0)
  })

  it('does not mark a list as truncated when it fits exactly', () => {
    const previous = Array.from({ length: CAP_DAY }, (_, i) => prod({ id: `id-${i}`, precio: 100 }))
    const current = Array.from({ length: CAP_DAY }, (_, i) => prod({ id: `id-${i}`, precio: 90 }))

    const [hoy] = build(previous, current).artifact.dias

    expect(hoy.bajaron.conteo).toBe(CAP_DAY)
    expect(hoy.bajaron.truncado).toBe(false)
    expect(hoy.bajaron.valores).toHaveLength(CAP_DAY)
  })

  it('keeps the biggest move first, so the cap drops the smallest ones', () => {
    const previous = [prod({ id: 'small', precio: 100 }), prod({ id: 'big', precio: 100 })]
    const current = [prod({ id: 'small', precio: 99 }), prod({ id: 'big', precio: 10 })]

    const [hoy] = build(previous, current).artifact.dias

    expect(hoy.bajaron.valores.map((v) => v.nombre)).toEqual([
      'Producto big',
      'Producto small',
    ])
  })

  it('accumulates the previous days inside the window', () => {
    const keepA = day('2026-10-14', { bajaron: { conteo: 2, truncado: false, valores: [] } })
    const keepB = day('2026-10-10')
    const keepC = day('2026-10-09')
    const drop = day('2026-10-08')

    const r = build([], [], artifactText([keepA, keepB, keepC, drop]))

    expect(r.degraded).toBeNull()
    expect(r.artifact.dias.map((d) => d.fecha)).toEqual([
      '2026-10-15',
      '2026-10-14',
      '2026-10-10',
      '2026-10-09',
    ])
    // Older days are carried forward untouched: we have no catalog for them.
    expect(r.artifact.dias[1]).toEqual(keepA)
    expect(r.artifact.dias[3]).toEqual(keepC)
  })

  it("replaces today's entry instead of duplicating it", () => {
    const staleToday = day('2026-10-15', {
      subieron: { conteo: 999, truncado: false, valores: [] },
    })
    const previous = [prod({ id: 'p1', precio: 100 })]
    const current = [prod({ id: 'p1', precio: 150 })]

    const r = build(previous, current, artifactText([staleToday, day('2026-10-14')]))

    expect(r.artifact.dias.map((d) => d.fecha)).toEqual(['2026-10-15', '2026-10-14'])
    expect(r.artifact.dias[0].subieron.conteo).toBe(1)
  })

  it('is idempotent by date: rebuilding from its own output changes nothing', () => {
    const previous = [prod({ id: 'p1', precio: 100 })]
    const current = [prod({ id: 'p1', precio: 150 })]
    const first = build(previous, current, artifactText([day('2026-10-14')]))

    const second = build(previous, current, JSON.stringify(first.artifact))

    expect(second.artifact).toEqual(first.artifact)
  })

  it('starts a fresh window on a first load and never lists the whole catalog as new', () => {
    const current = Array.from({ length: 20_001 }, (_, i) => prod({ id: `id-${i}` }))

    const r = build(null, current, artifactText([day('2026-10-14')]))

    expect(r.degraded).toBe('first-load')
    expect(r.artifact.dias.map((d) => d.fecha)).toEqual(['2026-10-15'])
    expect(r.artifact.dias[0].nuevos.conteo).toBe(0)
  })

  it('degrades to today only on absent, corrupt, invalid-shape and version-mismatched artifacts', () => {
    const cases: Array<{ text: string | null; reason: string }> = [
      { text: null, reason: 'absent' },
      { text: '{no soy JSON', reason: 'invalid-json' },
      { text: JSON.stringify({ version: 1, dias: 'no-es-array' }), reason: 'invalid-shape' },
      { text: artifactText([day('2026-10-14')], { version: 2 }), reason: 'version-mismatch' },
    ]

    for (const { text, reason } of cases) {
      const r = build([], [], text)
      expect(r.degraded).toBe(reason)
      expect(r.artifact.dias.map((d) => d.fecha)).toEqual(['2026-10-15'])
      expect(r.artifact.version).toBe(CHANGES_VERSION)
    }
  })

  it('degrades instead of copying a malformed day', () => {
    const r = build([], [], JSON.stringify({ version: 1, dias: [{ fecha: 'ayer' }] }))

    expect(r.degraded).toBe('invalid-shape')
    expect(r.artifact.dias.map((d) => d.fecha)).toEqual(['2026-10-15'])
  })
})

describe('parseChangesArtifact', () => {
  it('accepts a well-formed v1 artifact', () => {
    const parsed = parseChangesArtifact(artifactText([day('2026-10-14')]))

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.artifact.dias).toHaveLength(1)
  })

  it('rejects text that is not an object and a list that is not shaped right', () => {
    expect(parseChangesArtifact('"una cadena"')).toEqual({ ok: false, reason: 'invalid-shape' })
    const badList = artifactText([day('2026-10-14')])
      .replace('"conteo":0', '"conteo":"cero"')
    expect(parseChangesArtifact(badList)).toEqual({ ok: false, reason: 'invalid-shape' })
  })
})
