import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { UMBRAL_MISMA_CIUDAD_KM, agruparPorCercania } from './cercania'
import { mapSucursales } from './map'
import type { SucursalPrecio } from './map'
import type { ProductoResponse } from './schema'

/**
 * Real recorded responses, loaded from disk (same pattern as `map.test.ts`):
 * plain Node (vitest default env), read-only inputs, no network. The two
 * measured cases really go through `mapSucursales` — the grouping must survive
 * the production price-first ordering, so hand-built arrays would prove nothing.
 */
function fixture(name: string): ProductoResponse {
  const url = new URL(`./fixtures/${name}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as ProductoResponse
}

/** A minimal `SucursalPrecio`; every field is overridable so tests stay focused. */
function sucursal(overrides: Partial<SucursalPrecio> = {}): SucursalPrecio {
  return {
    clave: '15-1-1',
    precio: 100,
    banderaDescripcion: null,
    sucursalNombre: null,
    direccion: null,
    localidad: null,
    provincia: null,
    distanciaNumero: null,
    distanciaDescripcion: null,
    actualizadoHoy: null,
    lat: null,
    lng: null,
    ...overrides,
  }
}

function claves(sucursales: SucursalPrecio[]): string[] {
  return sucursales.map((s) => s.clave)
}

describe('agruparPorCercania — sin grupo cercano', () => {
  it('regla 1: input vacío → todo vacío', () => {
    expect(agruparPorCercania([])).toEqual({ localidad: null, cerca: [], lejos: [] })
  })

  it('regla 2: todas las distancias null → no se declara ciudad y todo queda lejos', () => {
    const sucursales = [
      sucursal({ clave: 'a', localidad: 'Rio Gallegos', distanciaNumero: null }),
      sucursal({ clave: 'b', localidad: 'Rio Gallegos', distanciaNumero: null }),
    ]
    expect(agruparPorCercania(sucursales)).toEqual({
      localidad: null,
      cerca: [],
      lejos: sucursales,
    })
  })

  it('regla 3: la más cercana supera el umbral → no se declara ciudad', () => {
    const sucursales = [
      sucursal({ clave: 'cerca', localidad: 'Rada Tilly', distanciaNumero: UMBRAL_MISMA_CIUDAD_KM + 1 }),
      sucursal({ clave: 'lejos', localidad: 'Rada Tilly', distanciaNumero: 900 }),
    ]
    const grupos = agruparPorCercania(sucursales)
    expect(grupos.localidad).toBeNull()
    expect(grupos.cerca).toEqual([])
    expect(claves(grupos.lejos)).toEqual(['cerca', 'lejos'])
  })

  it('regla 3: la más cercana tiene localidad null → no se declara ciudad', () => {
    const sucursales = [
      sucursal({ clave: 'cerca', localidad: null, distanciaNumero: 1 }),
      sucursal({ clave: 'lejos', localidad: 'Rio Gallegos', distanciaNumero: 2 }),
    ]
    const grupos = agruparPorCercania(sucursales)
    expect(grupos.localidad).toBeNull()
    expect(grupos.cerca).toEqual([])
    expect(claves(grupos.lejos)).toEqual(['cerca', 'lejos'])
  })

  it('regla 3: la localidad de la más cercana es solo espacios → no se declara ciudad', () => {
    const grupos = agruparPorCercania([
      sucursal({ clave: 'cerca', localidad: '   ', distanciaNumero: 1 }),
    ])
    expect(grupos.localidad).toBeNull()
    expect(grupos.cerca).toEqual([])
  })
})

describe('agruparPorCercania — umbral', () => {
  it('regla 3: distancia exactamente igual al umbral está DENTRO (<=)', () => {
    const sucursales = [
      sucursal({ clave: 'borde', localidad: 'X', distanciaNumero: UMBRAL_MISMA_CIUDAD_KM }),
      sucursal({ clave: 'afuera', localidad: 'X', distanciaNumero: UMBRAL_MISMA_CIUDAD_KM + 10 }),
    ]
    const grupos = agruparPorCercania(sucursales)
    expect(grupos.localidad).toBe('X')
    expect(claves(grupos.cerca)).toEqual(['borde'])
    expect(claves(grupos.lejos)).toEqual(['afuera'])
  })

  it('regla 3: justo por encima del umbral ya no hay ciudad', () => {
    const grupos = agruparPorCercania([
      sucursal({ clave: 'apenas', localidad: 'X', distanciaNumero: UMBRAL_MISMA_CIUDAD_KM + 0.001 }),
    ])
    expect(grupos.localidad).toBeNull()
    expect(grupos.cerca).toEqual([])
  })

  it('regla 8: el umbral por defecto es UMBRAL_MISMA_CIUDAD_KM', () => {
    expect(UMBRAL_MISMA_CIUDAD_KM).toBe(50)
    const dentro = agruparPorCercania([
      sucursal({ clave: 'a', localidad: 'X', distanciaNumero: 50 }),
    ])
    const fuera = agruparPorCercania([
      sucursal({ clave: 'a', localidad: 'X', distanciaNumero: 50.001 }),
    ])
    expect(dentro.localidad).toBe('X')
    expect(fuera.localidad).toBeNull()
  })
})

describe('agruparPorCercania — localidad y orden', () => {
  it('regla 5: normaliza trim/case/espacios para agrupar y devuelve el valor original', () => {
    const sucursales = [
      sucursal({ clave: 'a', localidad: '  ACASSUSO ', distanciaNumero: 1 }),
      sucursal({ clave: 'b', localidad: 'acassuso', distanciaNumero: 2 }),
      sucursal({ clave: 'c', localidad: 'Acassuso', distanciaNumero: 3 }),
    ]
    const grupos = agruparPorCercania(sucursales)
    // The returned label is the nearest branch's string, verbatim.
    expect(grupos.localidad).toBe('  ACASSUSO ')
    expect(claves(grupos.cerca)).toEqual(['a', 'b', 'c'])
    expect(grupos.lejos).toEqual([])
  })

  it('regla 5: colapsa runs internos de espacios, no solo trim', () => {
    const sucursales = [
      sucursal({ clave: 'a', localidad: '9  de  julio', distanciaNumero: 1 }),
      sucursal({ clave: 'b', localidad: '9 de julio', distanciaNumero: 2 }),
    ]
    const grupos = agruparPorCercania(sucursales)
    expect(grupos.localidad).toBe('9  de  julio')
    expect(claves(grupos.cerca)).toEqual(['a', 'b'])
  })

  it('regla 6: preserva el orden de entrada, no re-ordena por distancia ni por precio', () => {
    const sucursales = [
      // Prices deliberately out of order (300, 100, 200): a re-sort by price
      // would move c2/c3 ahead of c1, and a re-sort by distance would too.
      sucursal({ clave: 'c1', localidad: 'X', distanciaNumero: 5, precio: 300 }),
      sucursal({ clave: 'f1', localidad: 'Y', distanciaNumero: 200, precio: 100 }),
      sucursal({ clave: 'c2', localidad: 'X', distanciaNumero: 1, precio: 100 }),
      sucursal({ clave: 'c3', localidad: 'X', distanciaNumero: 3, precio: 200 }),
      sucursal({ clave: 'f2', localidad: 'Z', distanciaNumero: 300, precio: 400 }),
    ]
    const grupos = agruparPorCercania(sucursales)
    expect(grupos.localidad).toBe('X')
    expect(claves(grupos.cerca)).toEqual(['c1', 'c2', 'c3'])
    expect(claves(grupos.lejos)).toEqual(['f1', 'f2'])
  })

  it('regla 7: cerca y lejos son una partición, sin duplicados ni pérdidas', () => {
    const sucursales = [
      sucursal({ clave: 'c1', localidad: 'X', distanciaNumero: 2 }),
      sucursal({ clave: 'n1', localidad: 'X', distanciaNumero: null }),
      sucursal({ clave: 'f1', localidad: 'Y', distanciaNumero: 200 }),
      sucursal({ clave: 'c2', localidad: 'X', distanciaNumero: 4 }),
    ]
    const grupos = agruparPorCercania(sucursales)
    const todas = [...grupos.cerca, ...grupos.lejos]
    expect(todas).toHaveLength(sucursales.length)
    expect(new Set(claves(todas)).size).toBe(sucursales.length)
    expect([...claves(todas)].sort()).toEqual([...claves(sucursales)].sort())
    // A null distance can never be in `cerca` even with a matching locality.
    expect(claves(grupos.lejos)).toContain('n1')
  })
})

describe('agruparPorCercania — los dos casos medidos (fixtures reales)', () => {
  it('Río Gallegos: la ciudad del usuario queda primero, con sus 10 sucursales', () => {
    const sucursales = mapSucursales(fixture('lat-lng-rio-gallegos.json'))
    expect(sucursales).toHaveLength(50)

    const grupos = agruparPorCercania(sucursales)

    // Hard literals: 10 in-city / 40 elsewhere, not computed with the function
    // under test.
    expect(grupos.localidad).toBe('Rio Gallegos')
    expect(grupos.cerca).toHaveLength(10)
    expect(grupos.lejos).toHaveLength(40)
    expect(grupos.cerca.every((s) => s.localidad === 'Rio Gallegos')).toBe(true)

    // The measured defect: price-first ordering puts a 260 km branch at the top.
    expect(sucursales[0].localidad).toBe('Rio Grande')
    // After grouping the first near branch is the 0.62 km one.
    expect(grupos.cerca[0].distanciaNumero).toBeCloseTo(0.6246, 3)
    expect(grupos.cerca[0]).not.toBe(sucursales[0])
  })

  it('Coca Cola a 644 km: no hay ciudad que reclamar (no dice Rada Tilly)', () => {
    const sucursales = mapSucursales(fixture('lat-lng-lejos-644km.json'))
    expect(sucursales).toHaveLength(50)

    const grupos = agruparPorCercania(sucursales)

    expect(grupos.localidad).toBeNull()
    expect(grupos.cerca).toEqual([])
    expect(grupos.lejos).toHaveLength(50)
    expect(grupos.localidad).not.toBe('Rada Tilly')
    // The nearest branch really is Rada Tilly, 644 km away — the reason for null.
    expect(sucursales.some((s) => s.localidad === 'Rada Tilly')).toBe(true)
  })
})
