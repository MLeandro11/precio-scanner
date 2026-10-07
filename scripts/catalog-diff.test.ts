import { describe, it, expect } from 'vitest'
import { compararCatalogos, validarProductos, MAX_LISTA, UMBRAL_GRANDE } from './catalog-diff.ts'
import type { FechasDelRaw, ProductoLite, ReporteDiff, ValidacionError } from './catalog-diff.ts'

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

function motivoDe(errores: ValidacionError[], motivo: string) {
  return errores.find((e) => e.motivo === motivo)
}

// The report feeds an issue body through --json, so the two lists that grow
// with the catalog must stay bounded while the count stays exact.
describe('bounded lists', () => {
  it('caps the orphan and disappeared-EAN lists and keeps the exact count', () => {
    const prev = Array.from({ length: MAX_LISTA + 5 }, (_, i) =>
      prod({ id: `id-${i}`, barcode: `ean-${i}` }),
    )
    const r = compararCatalogos(prev, [])

    expect(r.idsHuerfanos.conteo).toBe(MAX_LISTA + 5)
    expect(r.idsHuerfanos.truncado).toBe(true)
    expect(r.idsHuerfanos.valores).toHaveLength(MAX_LISTA)

    expect(r.coberturaEan.barcodesDesaparecidos.conteo).toBe(MAX_LISTA + 5)
    expect(r.coberturaEan.barcodesDesaparecidos.truncado).toBe(true)
    expect(r.coberturaEan.barcodesDesaparecidos.valores).toHaveLength(MAX_LISTA)
  })

  it('does not mark a list as truncated when it fits', () => {
    const prev = Array.from({ length: MAX_LISTA }, (_, i) => prod({ id: `id-${i}` }))
    const r = compararCatalogos(prev, [])

    expect(r.idsHuerfanos.conteo).toBe(MAX_LISTA)
    expect(r.idsHuerfanos.truncado).toBe(false)
    expect(r.idsHuerfanos.valores).toHaveLength(MAX_LISTA)
  })
})

describe('validarProductos', () => {
  it('rejects input that is not an array', () => {
    const r = validarProductos({ products: [] })
    expect(r.ok).toBe(false)
    expect(r.conteo).toBe(0)
    expect(r.idsDuplicados).toEqual([])
    expect(r.errores.map((e) => e.motivo)).toContain('no-es-array')
  })

  it('rejects a record that is not a plain object, pointing at its index', () => {
    const r = validarProductos([prod({ id: 'a' }), 42, null, ['array']])
    expect(r.ok).toBe(false)
    const err = motivoDe(r.errores, 'registro-no-objeto')
    expect(err).toBeDefined()
    expect(err?.indice).toBe(1)
    // every offending record is reported, not just the first
    expect(r.errores.filter((e) => e.motivo === 'registro-no-objeto')).toHaveLength(3)
  })

  it('rejects a missing / empty / non-string id with distinct motivos', () => {
    const r = validarProductos([
      { nombre: 'n', precio: 1 },
      { id: '   ', nombre: 'n', precio: 1 },
      { id: 7, nombre: 'n', precio: 1 },
    ])
    expect(r.ok).toBe(false)
    expect(r.errores.map((e) => e.motivo)).toEqual(
      expect.arrayContaining(['id-ausente', 'id-vacio', 'id-no-string']),
    )
    expect(motivoDe(r.errores, 'id-ausente')?.indice).toBe(0)
    expect(motivoDe(r.errores, 'id-vacio')?.indice).toBe(1)
    expect(motivoDe(r.errores, 'id-no-string')?.indice).toBe(2)
  })

  it('rejects a missing / empty / non-string nombre with distinct motivos', () => {
    const r = validarProductos([
      { id: 'a', precio: 1 },
      { id: 'b', nombre: '  ', precio: 1 },
      { id: 'c', nombre: 9, precio: 1 },
    ])
    expect(r.ok).toBe(false)
    expect(r.errores.map((e) => e.motivo)).toEqual(
      expect.arrayContaining(['nombre-ausente', 'nombre-vacio', 'nombre-no-string']),
    )
  })

  it('rejects only a precio that is not numeric at all (NaN, Infinity, boolean, object, non-numeric string)', () => {
    const r = validarProductos([
      { id: 'a', nombre: 'n', precio: Number.NaN },
      { id: 'b', nombre: 'n', precio: Number.POSITIVE_INFINITY },
      { id: 'c', nombre: 'n', precio: true },
      { id: 'd', nombre: 'n', precio: { v: 1 } },
      { id: 'e', nombre: 'n', precio: 'diez' },
    ])
    expect(r.ok).toBe(false)
    expect(r.errores.filter((e) => e.motivo === 'precio-no-numerico')).toHaveLength(5)
    expect(motivoDe(r.errores, 'precio-no-numerico')?.indice).toBe(0)
  })

  // Mirrors normalize-catalog's own contract: absent/null and <= 0 are records
  // it EXCLUDES on purpose, so they must not read as a broken extraction.
  it('accepts an absent or null precio as an exclusion, not an error, and counts it', () => {
    const r = validarProductos([
      { id: 'a', nombre: 'n' },
      { id: 'b', nombre: 'n', precio: null },
      { id: 'c', nombre: 'n', precio: 10 },
    ])
    expect(r.ok).toBe(true)
    expect(r.errores).toEqual([])
    expect(r.sinPrecio).toBe(2)
    expect(r.precioNoPositivo).toBe(0)
  })

  it('accepts a precio <= 0 and a numeric string, and counts the non-positive ones', () => {
    const r = validarProductos([
      { id: 'a', nombre: 'n', precio: 0 },
      { id: 'b', nombre: 'n', precio: -5 },
      { id: 'c', nombre: 'n', precio: '1234,50' },
      { id: 'd', nombre: 'n', precio: '10' },
    ])
    expect(r.ok).toBe(true)
    expect(r.precioNoPositivo).toBe(2)
    expect(r.sinPrecio).toBe(0)
  })

  // The pipeline's own reader (normalize-catalog's NUMBER_RE) does not accept a
  // thousands separator, so this validator must not either: `1.234,50` is a
  // non-numeric string for both, and it has to fail loudly rather than be
  // silently read as 1.234.
  it('rejects a thousands-separator string, exactly like normalize-catalog does', () => {
    const r = validarProductos([{ id: 'a', nombre: 'n', precio: '1.234,50' }])
    expect(r.ok).toBe(false)
    expect(r.errores.filter((e) => e.motivo === 'precio-no-numerico')).toHaveLength(1)
  })

  it('rejects a non-string barcode / categoria / marca when present, but allows null/absent', () => {
    const bad = validarProductos([
      { id: 'a', nombre: 'n', precio: 1, barcode: 5 },
      { id: 'b', nombre: 'n', precio: 1, categoria: 5 },
      { id: 'c', nombre: 'n', precio: 1, marca: 5 },
    ])
    expect(bad.ok).toBe(false)
    expect(bad.errores.map((e) => e.motivo)).toEqual(
      expect.arrayContaining(['barcode-no-string', 'categoria-no-string', 'marca-no-string']),
    )

    // absent or null optional fields are not a validation error
    const ok = validarProductos([
      { id: 'a', nombre: 'n', precio: 1 },
      { id: 'b', nombre: 'n', precio: 1, barcode: null, categoria: null, marca: null },
    ])
    expect(ok.ok).toBe(true)
  })

  it('collects duplicates by id across every occurrence (not just the second one)', () => {
    const r = validarProductos([
      { id: 'x', nombre: 'n', precio: 1 },
      { id: 'y', nombre: 'n', precio: 1 },
      { id: 'x', nombre: 'n', precio: 1 },
      { id: 'z', nombre: 'n', precio: 1 },
      { id: 'x', nombre: 'n', precio: 1 },
    ])
    expect(r.ok).toBe(false)
    expect(r.idsDuplicados).toEqual(['x'])
    const dup = motivoDe(r.errores, 'id-duplicado')
    expect(dup).toBeDefined()
    expect(dup?.indices).toEqual([0, 2, 4])
  })

  it('reports an esperado mismatch with its own distinct motivo naming both numbers', () => {
    const raw = [prod({ id: 'a' }), prod({ id: 'b' }), prod({ id: 'c' })]
    const r = validarProductos(raw, { esperado: 5 })
    expect(r.ok).toBe(false)
    expect(r.conteo).toBe(3)
    const err = motivoDe(r.errores, 'conteo-esperado')
    expect(err).toBeDefined()
    expect(err?.detalle).toContain('3')
    expect(err?.detalle).toContain('5')
    // no structural error on otherwise valid records
    expect(r.errores).toHaveLength(1)
  })

  it('accepts a matching esperado and passes when no esperado is given', () => {
    const raw = [prod({ id: 'a' }), prod({ id: 'b' })]
    expect(validarProductos(raw, { esperado: 2 }).ok).toBe(true)
    expect(validarProductos(raw).ok).toBe(true)
    expect(validarProductos(raw, { esperado: null }).ok).toBe(true)
  })

  it('compares esperado against the RAW record count, not the normalized/post-exclusion count', () => {
    // 3 raw records; one has precio 0 and would be excluded by normalize.
    const raw = [prod({ id: 'a', precio: 10 }), prod({ id: 'b', precio: 0 }), prod({ id: 'c', precio: 5 })]
    expect(validarProductos(raw, { esperado: 3 }).ok).toBe(true)
    const mismatch = validarProductos(raw, { esperado: 2 })
    expect(mismatch.ok).toBe(false)
    expect(mismatch.conteo).toBe(3)
    expect(motivoDe(mismatch.errores, 'conteo-esperado')).toBeDefined()
  })

  it('never mutates its input', () => {
    const raw = [prod({ id: 'a' }), prod({ id: 'a' })]
    const before = JSON.stringify(raw)
    validarProductos(raw, { esperado: 1 })
    expect(JSON.stringify(raw)).toBe(before)
  })
})

describe('compararCatalogos', () => {
  it('reports the first refresh as such instead of listing everything as new', () => {
    const r = compararCatalogos(null, [prod({ id: 'a' }), prod({ id: 'b', barcode: '111' })])
    expect(r.primeraCarga).toBe(true)
    expect(r.prevConteo).toBeNull()
    expect(r.nextConteo).toBe(2)
    expect(r.deltaConteo).toBeNull()
    expect(r.altas.conteo).toBe(0)
    expect(r.bajas.conteo).toBe(0)
    expect(r.idsHuerfanos).toEqual({ conteo: 0, truncado: false, valores: [] })
    expect(r.cambiosDePrecio.conteo).toBe(0)
    expect(r.coberturaEan.next).toBe(1)
    expect(r.coberturaEan.prev).toBe(0)
    expect(r.coberturaEan.prevPorcentaje).toBeNull()
  })

  it('counts altas / bajas, the delta, and caps examples at 10', () => {
    const prev = Array.from({ length: 15 }, (_, i) => prod({ id: `prev-${i}`, barcode: `9${i}` }))
    const next = [
      ...Array.from({ length: 12 }, (_, i) => prod({ id: `next-${i}`, barcode: `8${i}` })),
      ...prev.slice(0, 5),
    ]
    const r = compararCatalogos(prev, next)
    expect(r.prevConteo).toBe(15)
    expect(r.nextConteo).toBe(17)
    expect(r.deltaConteo).toBe(2)
    expect(r.altas.conteo).toBe(12)
    expect(r.altas.ejemplos).toHaveLength(10)
    expect(r.altas.ejemplos[0]).toEqual({
      id: 'next-0',
      nombre: 'Producto next-0',
      barcode: '80',
    })
    expect(r.bajas.conteo).toBe(10)
    expect(r.bajas.ejemplos).toHaveLength(10)
    expect(r.idsHuerfanos.valores).toEqual(prev.slice(5).map((p) => p.id))
    expect(r.idsHuerfanos.conteo).toBe(prev.length - 5)
  })

  it('computes price-change count, median, max and the top 10 by absolute change', () => {
    const prev = [
      prod({ id: 'a', precio: 100 }),
      prod({ id: 'b', precio: 200 }),
      prod({ id: 'c', precio: 50 }),
      prod({ id: 'd', precio: 0 }),
      prod({ id: 'e', precio: 100 }),
      prod({ id: 'f', precio: 10 }),
    ]
    const next = [
      prod({ id: 'a', precio: 110 }), // +10%
      prod({ id: 'b', precio: 150 }), // -25%
      prod({ id: 'c', precio: 50 }), // unchanged
      prod({ id: 'd', precio: 80 }), // prev 0: pct not computable
      prod({ id: 'e', precio: 300 }), // +200%
      prod({ id: 'f', precio: 9 }), // -10%
    ]
    const r = compararCatalogos(prev, next)
    expect(r.cambiosDePrecio.conteo).toBe(5)
    expect(r.cambiosDePrecio.conBaseCero).toBe(1)
    // median of [-25, -10, 10, 200] = (-10 + 10) / 2
    expect(r.cambiosDePrecio.mediana).toBe(0)
    expect(r.cambiosDePrecio.maximo).toBe(200)
    expect(r.cambiosDePrecio.top10.map((c) => c.id)).toEqual(['e', 'b', 'a', 'f'])
  })

  it('truncates the top 10 to the 10 largest absolute changes', () => {
    const prev = Array.from({ length: 15 }, (_, i) => prod({ id: `p${i}`, precio: 100 }))
    const next = prev.map((p, i) => prod({ id: p.id, precio: 100 + (i + 1) }))
    const r = compararCatalogos(prev, next)
    expect(r.cambiosDePrecio.conteo).toBe(15)
    expect(r.cambiosDePrecio.top10).toHaveLength(10)
    expect(r.cambiosDePrecio.top10.map((c) => c.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `p${14 - i}`),
    )
  })

  it('reports numeric price-change samples even when every baseline is zero', () => {
    const prev = [prod({ id: 'a', precio: 0 }), prod({ id: 'b', precio: 0 })]
    const next = [prod({ id: 'a', precio: 10 }), prod({ id: 'b', precio: 0 })]
    const r = compararCatalogos(prev, next)
    expect(r.cambiosDePrecio.conteo).toBe(1)
    expect(r.cambiosDePrecio.conBaseCero).toBe(1)
    expect(r.cambiosDePrecio.mediana).toBeNull()
    expect(r.cambiosDePrecio.maximo).toBeNull()
    expect(r.cambiosDePrecio.top10).toEqual([])
  })

  it('reports EAN coverage and the EANs that disappeared', () => {
    const prev = [
      prod({ id: 'a', barcode: '111' }),
      prod({ id: 'b', barcode: '222' }),
      prod({ id: 'c', barcode: '' }),
      prod({ id: 'd', barcode: '333' }),
    ]
    const next = [
      prod({ id: 'a', barcode: '222' }),
      prod({ id: 'b', barcode: '333' }),
      prod({ id: 'c', barcode: '' }),
      prod({ id: 'e', barcode: '444' }),
    ]
    const r = compararCatalogos(prev, next)
    expect(r.coberturaEan.prev).toBe(3)
    expect(r.coberturaEan.next).toBe(3)
    expect(r.coberturaEan.prevPorcentaje).toBe(75)
    expect(r.coberturaEan.nextPorcentaje).toBe(75)
    expect(r.coberturaEan.barcodesDesaparecidos.valores).toEqual(['111'])
    expect(r.coberturaEan.barcodesDesaparecidos.conteo).toBe(1)
  })

  it('lists category altas / bajas, ignoring the empty category', () => {
    const prev = [prod({ id: 'a', categoria: 'A' }), prod({ id: 'b', categoria: 'B' }), prod({ id: 'c', categoria: '' })]
    const next = [prod({ id: 'a', categoria: 'B' }), prod({ id: 'b', categoria: 'C' }), prod({ id: 'd', categoria: '' })]
    const r = compararCatalogos(prev, next)
    expect(r.categoriasAltas).toEqual(['C'])
    expect(r.categoriasBajas).toEqual(['A'])
  })

  it('never mutates its inputs', () => {
    const prev = [prod({ id: 'a', precio: 10 })]
    const next = [prod({ id: 'a', precio: 20 }), prod({ id: 'b' })]
    const beforePrev = JSON.stringify(prev)
    const beforeNext = JSON.stringify(next)
    compararCatalogos(prev, next)
    expect(JSON.stringify(prev)).toBe(beforePrev)
    expect(JSON.stringify(next)).toBe(beforeNext)
  })
})

// The whole point of the section: a big change arrives annotated, not naked.
// R7 could not be closed because the raw's date fields never reach the report.
describe('compararCatalogos — cambios grandes', () => {
  it('exports the 50% threshold and reports the value it applied', () => {
    expect(UMBRAL_GRANDE).toBe(50)
    const r = compararCatalogos([prod({ id: 'a', precio: 100 })], [prod({ id: 'a', precio: 101 })])
    expect(r.cambiosGrandes.umbralPct).toBe(UMBRAL_GRANDE)
    expect(r.cambiosGrandes.umbralPct).toBe(50)
  })

  it('counts a change only when |pct| is strictly greater than the threshold', () => {
    // 49.9% is not big; 50.0% is not big either (strict >); 50.1% is on both sides.
    const prev = [
      prod({ id: 'up-49.9', precio: 1000 }),
      prod({ id: 'up-50.1', precio: 1000 }),
      prod({ id: 'down-50.0', precio: 1000 }),
      prod({ id: 'down-50.1', precio: 1000 }),
    ]
    const next = [
      prod({ id: 'up-49.9', precio: 1499 }),
      prod({ id: 'up-50.1', precio: 1501 }),
      prod({ id: 'down-50.0', precio: 500 }),
      prod({ id: 'down-50.1', precio: 499 }),
    ]
    const r = compararCatalogos(prev, next)

    expect(r.cambiosDePrecio.conteo).toBe(4)
    expect(r.cambiosGrandes.conteo).toBe(2)
    expect(r.cambiosGrandes.ejemplos.map((e) => e.id).sort()).toEqual(['down-50.1', 'up-50.1'])
  })

  it('reuses the percentage already computed for the price changes', () => {
    const prev = [prod({ id: 'a', precio: 100 }), prod({ id: 'b', precio: 400 })]
    const next = [prod({ id: 'a', precio: 900 }), prod({ id: 'b', precio: 100 })]
    const r = compararCatalogos(prev, next)

    for (const e of r.cambiosGrandes.ejemplos) {
      const match = r.cambiosDePrecio.top10.find((c) => c.id === e.id)
      expect(match?.pct).toBe(e.pct)
    }
    expect(r.cambiosGrandes.ejemplos.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('does NOT claim knowledge when no date map was passed: false and null, never 0', () => {
    const prev = [prod({ id: 'a', precio: 100 })]
    const next = [prod({ id: 'a', precio: 1000 })]

    const sinOpts = compararCatalogos(prev, next)
    expect(sinOpts.cambiosGrandes.conteo).toBe(1)
    expect(sinOpts.cambiosGrandes.fechasDisponibles).toBe(false)
    expect(sinOpts.cambiosGrandes.conFechaDeCambio).toBeNull()
    expect(sinOpts.cambiosGrandes.sinFechaDeCambio).toBeNull()

    const conNull = compararCatalogos(prev, next, { fechas: null })
    expect(conNull.cambiosGrandes.fechasDisponibles).toBe(false)
    expect(conNull.cambiosGrandes.conFechaDeCambio).toBeNull()
    expect(conNull.cambiosGrandes.sinFechaDeCambio).toBeNull()
    // `actualizado` is context, not evidence: it must not leak into the count.
    expect(conNull.cambiosGrandes.ejemplos[0]).not.toHaveProperty('precioCambiado')
  })

  it('a map with no entries still counts as available (0/0 is a real measurement)', () => {
    const r = compararCatalogos([prod({ id: 'a', precio: 100 })], [prod({ id: 'a', precio: 1000 })], {
      fechas: new Map(),
    })
    expect(r.cambiosGrandes.fechasDisponibles).toBe(true)
    expect(r.cambiosGrandes.conFechaDeCambio).toBe(0)
    expect(r.cambiosGrandes.sinFechaDeCambio).toBe(1)
  })

  it('counts as with-date only a non-empty precioCambiado, and carries actualizado as context', () => {
    const prev = ['a', 'b', 'c', 'd'].map((id) => prod({ id, precio: 100 }))
    const next = ['a', 'b', 'c', 'd'].map((id) => prod({ id, precio: 1000 }))
    const fechas = new Map<string, FechasDelRaw>([
      ['a', { actualizado: '2026-09-02', precioCambiado: '2026-09-01' }],
      // `actualizado` alone must NOT make this one "with date".
      ['b', { actualizado: '2026-08-01', precioCambiado: '   ' }],
      ['c', {}],
      // d is deliberately absent from the map.
    ])

    const r = compararCatalogos(prev, next, { fechas })
    expect(r.cambiosGrandes.fechasDisponibles).toBe(true)
    expect(r.cambiosGrandes.conteo).toBe(4)
    expect(r.cambiosGrandes.conFechaDeCambio).toBe(1)
    expect(r.cambiosGrandes.sinFechaDeCambio).toBe(3)

    const a = r.cambiosGrandes.ejemplos.find((e) => e.id === 'a')
    expect(a?.precioCambiado).toBe('2026-09-01')
    expect(a?.actualizado).toBe('2026-09-02')
    expect(a).toMatchObject({ precioPrev: 100, precioNext: 1000 })

    const b = r.cambiosGrandes.ejemplos.find((e) => e.id === 'b')
    expect(b?.precioCambiado).toBeUndefined()
    expect(b?.actualizado).toBe('2026-08-01')

    const d = r.cambiosGrandes.ejemplos.find((e) => e.id === 'd')
    expect(d?.precioCambiado).toBeUndefined()
    expect(d?.actualizado).toBeUndefined()
  })

  it('orders the examples by absolute percentage and truncates them to 10', () => {
    const prev = Array.from({ length: 15 }, (_, i) => prod({ id: `p${i}`, precio: 100 }))
    const next = Array.from({ length: 15 }, (_, i) => prod({ id: `p${i}`, precio: 160 + i * 10 }))

    const r = compararCatalogos(prev, next)
    expect(r.cambiosGrandes.conteo).toBe(15)
    expect(r.cambiosGrandes.ejemplos).toHaveLength(10)
    expect(r.cambiosGrandes.ejemplos.map((e) => e.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `p${14 - i}`),
    )
  })

  it('excludes a zero previous price (there is no percentage to judge)', () => {
    const prev = [prod({ id: 'zero', precio: 0 }), prod({ id: 'big', precio: 100 })]
    const next = [prod({ id: 'zero', precio: 5000 }), prod({ id: 'big', precio: 1000 })]

    const r = compararCatalogos(prev, next)
    expect(r.cambiosDePrecio.conBaseCero).toBe(1)
    expect(r.cambiosGrandes.conteo).toBe(1)
    expect(r.cambiosGrandes.ejemplos.map((e) => e.id)).toEqual(['big'])
    expect(r.cambiosGrandes.sinFechaDeCambio).toBeNull()
  })

  it('reports an empty section on a first load while staying honest about the map', () => {
    const fechas = new Map<string, FechasDelRaw>([['a', { precioCambiado: '2026-09-01' }]])

    const conMapa = compararCatalogos(null, [prod({ id: 'a', precio: 1000 })], { fechas })
    expect(conMapa.cambiosGrandes.conteo).toBe(0)
    expect(conMapa.cambiosGrandes.ejemplos).toEqual([])
    expect(conMapa.cambiosGrandes.fechasDisponibles).toBe(true)
    expect(conMapa.cambiosGrandes.conFechaDeCambio).toBe(0)
    expect(conMapa.cambiosGrandes.sinFechaDeCambio).toBe(0)
    expect(conMapa.cambiosGrandes.umbralPct).toBe(UMBRAL_GRANDE)

    const sinMapa = compararCatalogos(null, [prod({ id: 'a', precio: 1000 })])
    expect(sinMapa.cambiosGrandes.conteo).toBe(0)
    expect(sinMapa.cambiosGrandes.fechasDisponibles).toBe(false)
    expect(sinMapa.cambiosGrandes.conFechaDeCambio).toBeNull()
    expect(sinMapa.cambiosGrandes.sinFechaDeCambio).toBeNull()
  })

  it('never mutates the date map it receives', () => {
    const fechas = new Map<string, FechasDelRaw>([['a', { precioCambiado: '2026-09-01' }]])
    const before = JSON.stringify([...fechas])
    compararCatalogos([prod({ id: 'a', precio: 100 })], [prod({ id: 'a', precio: 1000 })], { fechas })
    expect(JSON.stringify([...fechas])).toBe(before)
  })
})

// Type-level guard: the public report shape stays assignable.
const _shape: ReporteDiff | null = null
void _shape
