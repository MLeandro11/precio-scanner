import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { deriveEstado } from './estado'
import type { ProductoResponse, SucursalDto } from './schema'

function fixture(name: string): ProductoResponse {
  const url = new URL(`./fixtures/${name}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as ProductoResponse
}

function sucursal(overrides: Partial<SucursalDto>): SucursalDto {
  return { id: '1', comercioId: 15, banderaId: 1, ...overrides }
}

describe('deriveEstado', () => {
  it('AC3: producto.msg "Producto inexistente." → sin-datos (not error, not $0)', () => {
    const response = fixture('ean-inexistente.json')
    expect(response.producto?.msg).toBe('Producto inexistente.')
    expect(deriveEstado(response)).toBe('sin-datos')
  })

  it('AC3: sin-datos wins over any stray branch content in the same body', () => {
    const response: ProductoResponse = {
      status: 200,
      total: 3,
      producto: { msg: 'Producto inexistente.' },
      sucursales: [sucursal({ preciosProducto: { precioLista: 4950 } })],
    }
    expect(deriveEstado(response)).toBe('sin-datos')
  })

  it('AC3/AC9: total === 0 → sin-datos', () => {
    expect(deriveEstado({ status: 200, total: 0, sucursales: [] })).toBe('sin-datos')
  })

  it('AC4: branches present but none with a numeric precioLista → sin-precio', () => {
    const response: ProductoResponse = {
      status: 200,
      total: 42,
      producto: { id: '7790895000430' },
      sucursales: [
        sucursal({
          id: '1075',
          comercioId: 11,
          banderaId: 2,
          message: 'La sucursal no contiene el producto.',
        }),
        sucursal({ id: '1076', preciosProducto: {} }),
      ],
    }
    expect(deriveEstado(response)).toBe('sin-precio')
  })

  it('AC5: a branch whose only price is "" is sin-precio, never con-precios/$0', () => {
    const response: ProductoResponse = {
      status: 200,
      total: 1,
      sucursales: [sucursal({ preciosProducto: { precioLista: '' } })],
    }
    expect(deriveEstado(response)).toBe('sin-precio')
  })

  it('con-precios when at least one branch carries a usable price (all three fixtures)', () => {
    expect(deriveEstado(fixture('lat-lng-rio-gallegos.json'))).toBe('con-precios')
    expect(deriveEstado(fixture('lat-lng-lejos-644km.json'))).toBe('con-precios')
    expect(deriveEstado(fixture('array-sucursales-mixto.json'))).toBe('con-precios')
  })

  it('lejos: el producto existe a nivel nacional pero la más cercana está a ~645 km → con-precios', () => {
    const response = fixture('lat-lng-lejos-644km.json')
    expect(response.total).toBe(1338)
    const distancias = (response.sucursales ?? []).map(
      (s) => s.distanciaNumero ?? Number.POSITIVE_INFINITY,
    )
    expect(Math.min(...distancias)).toBeCloseTo(644.8257, 3)
    // Far away is information, not a filter: the state is still con-precios.
    expect(deriveEstado(response)).toBe('con-precios')
  })

  it('sin-datos when there is no response at all', () => {
    expect(deriveEstado(null)).toBe('sin-datos')
    expect(deriveEstado(undefined)).toBe('sin-datos')
  })

  it('sin-datos when total > 0 but the page has no branch entries (paging edge)', () => {
    expect(deriveEstado({ status: 200, total: 10, sucursales: [] })).toBe('sin-datos')
  })
})
