import { describe, it, expect } from 'vitest'
import {
  esPrecioValido,
  precioListaNumerico,
  tieneMensajeDeProducto,
} from './schema'
import { readFileSync } from 'node:fs'
import type { ProductoResponse, SucursalDto } from './schema'

function fixture(name: string): ProductoResponse {
  const url = new URL(`./fixtures/${name}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as ProductoResponse
}

function sucursal(precioLista: unknown, preciosProducto = true): SucursalDto {
  return {
    id: '454',
    comercioId: 15,
    banderaId: 1,
    ...(preciosProducto ? { preciosProducto: { precioLista } } : {}),
  }
}

describe('esPrecioValido', () => {
  it('accepts only finite numbers', () => {
    expect(esPrecioValido(4950)).toBe(true)
    expect(esPrecioValido(0)).toBe(true)
    expect(esPrecioValido(-1.5)).toBe(true)
  })

  it('AC5: rejects NaN, Infinity, strings, null and undefined', () => {
    expect(esPrecioValido(Number.NaN)).toBe(false)
    expect(esPrecioValido(Number.POSITIVE_INFINITY)).toBe(false)
    expect(esPrecioValido(Number.NEGATIVE_INFINITY)).toBe(false)
    expect(esPrecioValido('4950')).toBe(false)
    expect(esPrecioValido('')).toBe(false)
    expect(esPrecioValido(null)).toBe(false)
    expect(esPrecioValido(undefined)).toBe(false)
  })
})

describe('precioListaNumerico', () => {
  it('reads preciosProducto.precioLista', () => {
    expect(precioListaNumerico(sucursal(3933))).toBe(3933)
  })

  it('AC5: "" / null / missing / NaN → null, never 0', () => {
    expect(precioListaNumerico(sucursal(''))).toBeNull()
    expect(precioListaNumerico(sucursal(null))).toBeNull()
    expect(precioListaNumerico(sucursal(Number.NaN))).toBeNull()
    expect(precioListaNumerico(sucursal(undefined, false))).toBeNull()
    expect(precioListaNumerico(undefined)).toBeNull()
  })

  it('a genuine 0 is a valid finite price, not a fabricated one', () => {
    expect(precioListaNumerico(sucursal(0))).toBe(0)
  })
})

describe('tieneMensajeDeProducto', () => {
  it('detects "Producto inexistente." in the unknown-EAN fixture', () => {
    expect(tieneMensajeDeProducto(fixture('ean-inexistente.json'))).toBe(true)
  })

  it('is false for a normal product response', () => {
    expect(tieneMensajeDeProducto(fixture('lat-lng-lejos-644km.json'))).toBe(false)
    expect(tieneMensajeDeProducto(null)).toBe(false)
    expect(tieneMensajeDeProducto({})).toBe(false)
  })
})
