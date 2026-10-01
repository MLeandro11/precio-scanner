import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { composeClave, mapSucursales } from './map'
import type { ProductoResponse, SucursalDto } from './schema'

/**
 * Real recorded responses, loaded from disk. Plain Node (vitest default env):
 * the fixtures are read-only inputs, never regenerated, and these tests never
 * touch the network.
 */
function fixture(name: string): ProductoResponse {
  const url = new URL(`./fixtures/${name}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as ProductoResponse
}

function sucursal(overrides: Partial<SucursalDto>): SucursalDto {
  return {
    id: '1',
    comercioId: 15,
    banderaId: 1,
    ...overrides,
  }
}

function distanciaDe(s: { distanciaNumero: number | null }): number {
  return s.distanciaNumero ?? Number.POSITIVE_INFINITY
}

describe('composeClave', () => {
  it('AC8: composes comercioId-banderaId-id', () => {
    expect(composeClave({ comercioId: 15, banderaId: 1, id: '454' })).toBe('15-1-454')
  })

  it('AC8: keeps the composed key on a mapped branch (mixed fixture, id 454)', () => {
    const mapped = mapSucursales(fixture('array-sucursales-mixto.json'))
    expect(mapped.map((s) => s.clave)).toEqual(['15-1-454', '15-1-261'])
  })
})

describe('mapSucursales — ordering by price, not distance', () => {
  it('AC1: la más barata va primera (Río Gallegos, 50 sucursales)', () => {
    const response = fixture('lat-lng-rio-gallegos.json')
    const mapped = mapSucursales(response)

    expect(response.sucursales).toHaveLength(50)
    expect(mapped).toHaveLength(50)

    const precios = mapped.map((s) => s.precio)
    expect(precios).toEqual([...precios].sort((a, b) => a - b))
    expect(mapped[0].precio).toBe(Math.min(...precios))
  })

  it('AC2: ordena por precio y NO por distancia (lejos, 50 sucursales)', () => {
    const mapped = mapSucursales(fixture('lat-lng-lejos-644km.json'))
    expect(mapped).toHaveLength(50)

    // Six distinct prices, ascending, explicitly asserted.
    expect([...new Set(mapped.map((s) => s.precio))]).toEqual([
      3950, 4190, 4390, 4560, 4590, 4600,
    ])
    const precios = mapped.map((s) => s.precio)
    expect(precios).toEqual([...precios].sort((a, b) => a - b))

    // The cheapest is the FAR branch at 1.293 km, not the nearest one.
    expect(mapped[0].precio).toBe(3950)
    expect(mapped[0].sucursalNombre).toBe('Viedma')
    expect(mapped[0].distanciaNumero).toBeCloseTo(1293.4934, 3)

    // The nearest branch (644.83 km, Rada Tilly, $4.390) is NOT first.
    const nearest = mapped.reduce((a, b) => (distanciaDe(a) <= distanciaDe(b) ? a : b))
    expect(nearest.sucursalNombre).toBe('Rada Tilly')
    expect(nearest.distanciaNumero).toBeCloseTo(644.8257, 3)
    expect(nearest.precio).toBe(4390)

    expect(mapped[0].clave).not.toBe(nearest.clave)
    expect(distanciaDe(mapped[0])).toBeGreaterThan(distanciaDe(nearest))
  })

  it('lejos: la más cercana está a ~645 km pero no se descarta ninguna sucursal (la cercanía no es filtro)', () => {
    const response = fixture('lat-lng-lejos-644km.json')
    const mapped = mapSucursales(response)

    expect(response.total).toBe(1338)
    expect(mapped).toHaveLength(50)
    // Everything returned is shown, even though the nearest is >600 km away.
    expect(Math.min(...mapped.map(distanciaDe))).toBeCloseTo(644.8257, 3)
    expect(mapped[0].distanciaNumero).toBeGreaterThan(1200)
  })

  it('empates: mismo precio ordena por distancia; empate completo conserva el orden de origen (decisión 8)', () => {
    const base: SucursalDto = {
      comercioId: 2,
      banderaId: 1,
      preciosProducto: { precioLista: 4950 },
    }
    const response: ProductoResponse = {
      status: 200,
      total: 4,
      sucursales: [
        sucursal({ ...base, id: 'lejos', distanciaNumero: 9 }),
        sucursal({ ...base, id: 'cerca', distanciaNumero: 1 }),
        sucursal({ ...base, id: 'empate-b', distanciaNumero: 5 }),
        sucursal({ ...base, id: 'empate-a', distanciaNumero: 5 }),
      ],
    }

    expect(mapSucursales(response).map((s) => s.clave)).toEqual([
      '2-1-cerca',
      '2-1-empate-b',
      '2-1-empate-a',
      '2-1-lejos',
    ])
  })
})

describe('mapSucursales — precios y orden (sin delta)', () => {
  it('AC10: las 10 de Río Gallegos tienen el mismo precio y se ordenan por distancia', () => {
    const response = fixture('lat-lng-rio-gallegos.json')
    const enLaCiudad = (response.sucursales ?? []).filter((s) =>
      /rio gallegos/i.test(s.localidad ?? ''),
    )
    expect(enLaCiudad).toHaveLength(10)

    const soloLaCiudad: ProductoResponse = { ...response, sucursales: enLaCiudad }
    const mapped = mapSucursales(soloLaCiudad)

    expect(mapped).toHaveLength(10)
    expect(mapped.every((s) => s.precio === 4950)).toBe(true)
    expect(mapped.every((s) => s.banderaDescripcion === 'La Anonima')).toBe(true)
    // No delta field exists to invent a saving: same price everywhere (decision
    // 2026-10-01). The table stays useful through distance ordering.
    expect(Object.keys(mapped[0])).not.toContain('deltaVsMasBarato')

    // With no price difference the table is still useful by distance:
    // ordered nearest → farthest.
    expect(mapped.map((s) => s.distanciaNumero)).toEqual([
      0.6246, 0.6542, 0.8964, 1.1479, 1.5824, 2.8411, 2.9572, 2.9583, 3.2987, 5.3489,
    ])
  })

  it('AC10 (alcance): en la fixture completa el más barato está a 260 km, no en la ciudad', () => {
    const mapped = mapSucursales(fixture('lat-lng-rio-gallegos.json'))

    // Why the core computes no delta: the page's cheapest is $4.700 in Río
    // Grande (260.82 km), so a delta against the global minimum would present
    // the 10 in-city $4.950 branches as "+$250 vs a branch 260 km away".
    expect(mapped[0].precio).toBe(4700)
    expect(mapped[0].localidad).toBe('Rio Grande')
    expect(mapped[0].distanciaNumero).toBeGreaterThan(260)

    const locales = mapped.filter((s) => /rio gallegos/i.test(s.localidad ?? ''))
    expect(locales).toHaveLength(10)
    expect(locales.every((s) => s.precio === 4950)).toBe(true)
  })

  it('ordena el fixture "lejos" por precio y no por distancia', () => {
    const mapped = mapSucursales(fixture('lat-lng-lejos-644km.json'))

    expect(mapped[0].precio).toBe(3950)
    expect(mapped[mapped.length - 1].precio).toBe(4600)

    const nearest = mapped.reduce((a, b) => (distanciaDe(a) <= distanciaDe(b) ? a : b))
    expect(nearest.precio).toBe(4390)
    expect(nearest).not.toBe(mapped[0])
  })
})

describe('mapSucursales — branches without a usable price', () => {
  it('AC5: precioLista "", null, undefined y NaN nunca se muestran como 0', () => {
    const response: ProductoResponse = {
      status: 200,
      total: 5,
      sucursales: [
        sucursal({ id: 'ok', preciosProducto: { precioLista: 3933 } }),
        sucursal({ id: 'vacio', preciosProducto: { precioLista: '' } }),
        sucursal({ id: 'null', preciosProducto: { precioLista: null } }),
        sucursal({ id: 'sin-campo', preciosProducto: {} }),
        sucursal({ id: 'nan', preciosProducto: { precioLista: Number.NaN } }),
      ],
    }
    const mapped = mapSucursales(response)
    expect(mapped).toHaveLength(1)
    expect(mapped[0].precio).toBe(3933)
    expect(mapped.some((s) => s.precio === 0)).toBe(false)
  })

  it('keeps the branches with a price and drops the ones with a message (mixed fixture)', () => {
    const response = fixture('array-sucursales-mixto.json')
    expect(response.sucursales).toHaveLength(3)
    const mapped = mapSucursales(response)
    expect(mapped).toHaveLength(2)
    expect(mapped.map((s) => s.precio)).toEqual([3933, 3933])
    expect(mapped.map((s) => s.clave)).toEqual(['15-1-454', '15-1-261'])
  })

  it('drops a branch whose only price is unusable, even if it also has a message', () => {
    const response: ProductoResponse = {
      status: 200,
      total: 1,
      sucursales: [
        sucursal({
          id: '1075',
          comercioId: 11,
          banderaId: 2,
          message: 'La sucursal no contiene el producto.',
        }),
      ],
    }
    expect(mapSucursales(response)).toEqual([])
  })
})

describe('mapSucursales — total is the national count', () => {
  it('AC9: total no es la cantidad de sucursales mostradas', () => {
    const lejos = fixture('lat-lng-lejos-644km.json')
    expect(lejos.total).toBe(1338)
    expect(mapSucursales(lejos)).toHaveLength(50)
    expect(mapSucursales(lejos).length).not.toBe(lejos.total)

    const rioGallegos = fixture('lat-lng-rio-gallegos.json')
    expect(rioGallegos.total).toBe(596)
    expect(mapSucursales(rioGallegos)).toHaveLength(50)
    expect(mapSucursales(rioGallegos).length).not.toBe(rioGallegos.total)
  })

  it('returns [] for an unknown EAN and for a missing response', () => {
    expect(mapSucursales(fixture('ean-inexistente.json'))).toEqual([])
    expect(mapSucursales(null)).toEqual([])
    expect(mapSucursales(undefined)).toEqual([])
  })
})
