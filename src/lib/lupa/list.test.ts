import { describe, it, expect } from 'vitest'
import {
  addItem,
  setCantidad,
  removeItem,
  toggleAlerta,
  isInList,
  normalizeEan,
} from './list'
import type { ListaItem } from './list'

describe('normalizeEan', () => {
  it('strips spaces, dashes, dots and underscores; uppercases', () => {
    expect(normalizeEan('779 3940 219009')).toBe('7793940219009')
    expect(normalizeEan('779-3940-219009')).toBe('7793940219009')
    expect(normalizeEan('779.3940.219009')).toBe('7793940219009')
    expect(normalizeEan('  ean-123  ')).toBe('EAN123')
  })

  it('returns empty for falsy input', () => {
    expect(normalizeEan('')).toBe('')
    expect(normalizeEan(undefined as unknown as string)).toBe('')
  })
})

describe('addItem', () => {
  it('adds a new product keyed by its normalized EAN', () => {
    const list = addItem([], '779 3940 219009', 'Yerba Canarias 1kg')
    expect(list).toEqual([
      { ean: '7793940219009', cantidad: 1, alerta: false, nombre: 'Yerba Canarias 1kg' },
    ])
  })

  it('increments cantidad when the same EAN is added again (any separator style)', () => {
    const once = addItem([], '7793940219009')
    const twice = addItem(once, '779-3940-219009')
    expect(twice).toHaveLength(1)
    expect(twice[0]!.cantidad).toBe(2)
  })

  it('ignores an empty EAN and never mutates the input', () => {
    const list: ListaItem[] = [{ ean: '1', cantidad: 1, alerta: false }]
    expect(addItem(list, '  ')).toEqual(list)
    expect(list).toHaveLength(1)
  })
})

describe('setCantidad / removeItem', () => {
  const base: ListaItem[] = [
    { ean: 'A1', cantidad: 2, alerta: false },
    { ean: 'B2', cantidad: 1, alerta: true },
  ]

  it('sets a quantity', () => {
    expect(setCantidad(base, 'A1', 5)).toEqual([
      { ean: 'A1', cantidad: 5, alerta: false },
      base[1],
    ])
  })

  it('removes the item when cantidad hits zero', () => {
    expect(setCantidad(base, 'A1', 0)).toEqual([base[1]])
  })

  it('ignores negative quantities', () => {
    expect(setCantidad(base, 'A1', -3)).toEqual(base)
  })

  it('removes by normalized ean', () => {
    expect(removeItem(base, 'a-1')).toEqual([base[1]])
  })
})

describe('toggleAlerta / isInList', () => {
  const base: ListaItem[] = [{ ean: '7793940219009', cantidad: 1, alerta: false }]

  it('toggles the alert flag', () => {
    expect(toggleAlerta(base, '7793940219009')[0]!.alerta).toBe(true)
    expect(toggleAlerta(toggleAlerta(base, '7793940219009'), '7793940219009')[0]!.alerta).toBe(
      false,
    )
  })

  it('reports membership case/separator-insensitively', () => {
    expect(isInList(base, '779 3940 219009')).toBe(true)
    expect(isInList(base, '000')).toBe(false)
  })
})