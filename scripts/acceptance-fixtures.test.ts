import { describe, it, expect } from 'vitest'
import { elegirProductoDePrueba, separarEan, type Requisitos } from './acceptance-fixtures.ts'
import type { Producto } from '../src/lib/types.ts'

/** The requirement set the harness's code rows actually impose. */
const REQ: Requisitos = { digitosDeBarcode: 13 }

/** Minimal product builder; `id` is the only required override. */
function prod(over: Partial<Producto> & { id: string }): Producto {
  return {
    id: over.id,
    nombre: over.nombre ?? `Producto ${over.id}`,
    marca: over.marca ?? '',
    categoria: over.categoria ?? 'Almacén',
    barcode: over.barcode ?? '',
    precio: over.precio ?? 100,
  }
}

function ok(r: ReturnType<typeof elegirProductoDePrueba>): Producto {
  if ('error' in r) throw new Error(`expected a product, got error: ${r.error}`)
  return r.producto
}

function err(r: ReturnType<typeof elegirProductoDePrueba>): string {
  if (!('error' in r)) throw new Error(`expected an error, got product ${r.producto.id}`)
  return r.error
}

describe('elegirProductoDePrueba', () => {
  it('el catálogo que cumple todo -> elige un producto de 13 dígitos', () => {
    const r = elegirProductoDePrueba(
      [
        prod({ id: '1', barcode: '123456789012' }), // 12 dígitos: no sirve
        prod({ id: '2', barcode: '7793940219009' }),
        prod({ id: '3', barcode: '9999999999999' }),
      ],
      REQ,
    )
    expect(ok(r).id).toBe('2')
  })

  it('ignora códigos que no tienen exactamente 13 dígitos', () => {
    const r = elegirProductoDePrueba(
      [
        prod({ id: 'corto', barcode: '12345' }),
        prod({ id: 'largo', barcode: '12345678901234' }),
        prod({ id: 'letras', barcode: 'ABC4567890123' }),
        prod({ id: 'vacio', barcode: '' }),
        prod({ id: 'bueno', barcode: '7790895000016' }),
      ],
      REQ,
    )
    expect(ok(r).id).toBe('bueno')
  })

  it('saltea un código repetido y elige otro único', () => {
    // "first 13-digit barcode" would return 'a'; the rows need a *unique* one.
    const r = elegirProductoDePrueba(
      [
        prod({ id: 'a', barcode: '1111111111111' }),
        prod({ id: 'b', barcode: '1111111111111' }),
        prod({ id: 'c', barcode: '2222222222222' }),
      ],
      REQ,
    )
    expect(ok(r).id).toBe('c')
  })

  it('conserva el orden del catálogo entre dos candidatos válidos', () => {
    const r = elegirProductoDePrueba(
      [
        prod({ id: 'primero', barcode: '1111111111111' }),
        prod({ id: 'segundo', barcode: '2222222222222' }),
      ],
      REQ,
    )
    expect(ok(r).id).toBe('primero')
  })

  it('catálogo sin ningún código de 13 dígitos -> el error nombra los 13 dígitos', () => {
    const r = elegirProductoDePrueba(
      [
        prod({ id: '1', barcode: '123456789012' }),
        prod({ id: '2', barcode: '123456' }),
        prod({ id: '3', barcode: 'abc' }),
        prod({ id: '4', barcode: '' }),
      ],
      REQ,
    )
    expect(err(r)).toMatch(/13 dígitos/)
  })

  it('catálogo vacío -> el error nombra los 13 dígitos', () => {
    expect(err(elegirProductoDePrueba([], REQ))).toMatch(/13 dígitos/)
  })

  it('todos los códigos de 13 dígitos repetidos -> el error nombra la unicidad', () => {
    const r = elegirProductoDePrueba(
      [
        prod({ id: 'a', barcode: '1111111111111' }),
        prod({ id: 'b', barcode: '1111111111111' }),
        prod({ id: 'c', barcode: '2222222222222' }),
        prod({ id: 'd', barcode: '2222222222222' }),
      ],
      REQ,
    )
    // The row's real criterion is "exactly 1 result", so the error must say so.
    expect(err(r)).toMatch(/único|1 resultado/)
  })

  it('un barcode con separadores no cuenta como 13 dígitos', () => {
    // The engine keys its barcode map by the stored string and strips the query,
    // so `779-3940-219009` is not something a code row can resolve. Storing it is
    // a shape failure, not a valid fixture.
    const r = elegirProductoDePrueba([prod({ id: '1', barcode: '779-3940-219009' })], REQ)
    expect(err(r)).toMatch(/13 dígitos/)
  })

  it('respeta el largo pedido en Requisitos (no está fijo en 13)', () => {
    const r = elegirProductoDePrueba(
      [
        prod({ id: '13', barcode: '7793940219009' }),
        prod({ id: '12', barcode: '779394021900' }),
      ],
      { digitosDeBarcode: 12 },
    )
    expect(ok(r).id).toBe('12')
  })
})

describe('separarEan', () => {
  it('reproduce el literal histórico 3-4-6', () => {
    expect(separarEan('7793940219009')).toBe('779 3940 219009')
  })

  it('no pierde dígitos: quitar los separadores devuelve el EAN', () => {
    const ean = '7793940219009'
    expect(separarEan(ean).replace(/\D/g, '')).toBe(ean)
  })

  it('agrupa solo los dígitos que hay', () => {
    expect(separarEan('123')).toBe('123')
    expect(separarEan('123456')).toBe('123 456')
    expect(separarEan('12345678901')).toBe('123 4567 8901')
  })

  it('un resto más largo que el grupo final queda como último bloque', () => {
    expect(separarEan('1234567890123456')).toBe('123 4567 890123 456')
  })
})
