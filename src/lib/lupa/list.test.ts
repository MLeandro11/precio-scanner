import { describe, it, expect } from 'vitest'
import {
  addItem,
  setCantidad,
  removeItem,
  restoreItem,
  restoreList,
  toggleAlerta,
  isInList,
  clearList,
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

describe('restoreItem', () => {
  const removed: ListaItem = {
    ean: 'B2',
    cantidad: 3,
    alerta: true,
    nombre: 'Yerba Canarias 1kg',
    productoId: 'p-42',
  }

  it('reinserts every field verbatim (cantidad, alerta, nombre, productoId)', () => {
    const list: ListaItem[] = [{ ean: 'A1', cantidad: 1, alerta: false }]
    const next = restoreItem(list, removed, 1)
    expect(next[1]).toEqual(removed)
  })

  it('inserts at the original index so ordering is restored', () => {
    const list: ListaItem[] = [
      { ean: 'A1', cantidad: 1, alerta: false },
      { ean: 'C3', cantidad: 1, alerta: false },
    ]
    expect(restoreItem(list, removed, 1).map((i) => i.ean)).toEqual(['A1', 'B2', 'C3'])
  })

  it('clamps a negative index to the head', () => {
    const list: ListaItem[] = [{ ean: 'A1', cantidad: 1, alerta: false }]
    expect(restoreItem(list, removed, -5).map((i) => i.ean)).toEqual(['B2', 'A1'])
  })

  it('clamps an index past the end to append', () => {
    const list: ListaItem[] = [{ ean: 'A1', cantidad: 1, alerta: false }]
    expect(restoreItem(list, removed, 99).map((i) => i.ean)).toEqual(['A1', 'B2'])
  })

  it('restores into an empty list', () => {
    expect(restoreItem([], removed, 0)).toEqual([removed])
  })

  it('does not duplicate when the normalized ean is already present', () => {
    const list: ListaItem[] = [{ ean: 'B2', cantidad: 9, alerta: false }]
    const next = restoreItem(list, { ...removed, ean: 'b-2' }, 0)
    expect(next).toEqual(list)
    expect(next).not.toBe(list)
  })

  it('never mutates the input list', () => {
    const list: ListaItem[] = [{ ean: 'A1', cantidad: 1, alerta: false }]
    const snapshot = [...list]
    const next = restoreItem(list, removed, 0)
    expect(list).toEqual(snapshot)
    expect(next).not.toBe(list)
  })

  it('normalizes the ean of the restored item', () => {
    const next = restoreItem([], { ...removed, ean: 'b-2' }, 0)
    expect(next[0]!.ean).toBe('B2')
    expect(next[0]!.cantidad).toBe(3)
  })

  it('restores a minimal item without inventing optional fields', () => {
    const minimal: ListaItem = { ean: 'D4', cantidad: 2, alerta: false }
    expect(restoreItem([], minimal, 0)).toEqual([minimal])
  })

  it('appends when the index equals the current length', () => {
    const list: ListaItem[] = [
      { ean: 'A1', cantidad: 1, alerta: false },
      { ean: 'C3', cantidad: 1, alerta: false },
    ]
    expect(restoreItem(list, removed, 2).map((i) => i.ean)).toEqual(['A1', 'C3', 'B2'])
  })
})

describe('restoreList', () => {
  it('keeps a product added after the wipe by appending it to the snapshot', () => {
    // The D3 failure mode: undo of "Vaciar" silently destroyed anything added
    // while the toast was up.
    const snapshot: ListaItem[] = [{ ean: 'A1', cantidad: 2, alerta: true }]
    const current: ListaItem[] = [{ ean: 'B2', cantidad: 1, alerta: false }]
    expect(restoreList(snapshot, current).map((i) => i.ean)).toEqual(['A1', 'B2'])
  })

  it('appends in the current list order, after the whole snapshot', () => {
    const snapshot: ListaItem[] = [
      { ean: 'A1', cantidad: 1, alerta: false },
      { ean: 'C3', cantidad: 1, alerta: false },
    ]
    const current: ListaItem[] = [
      { ean: 'D4', cantidad: 1, alerta: false },
      { ean: 'B2', cantidad: 1, alerta: false },
    ]
    expect(restoreList(snapshot, current).map((i) => i.ean)).toEqual(['A1', 'C3', 'D4', 'B2'])
  })

  it('lets the snapshot win when both hold the same normalized ean', () => {
    const snapshot: ListaItem[] = [{ ean: 'A1', cantidad: 3, alerta: true }]
    const current: ListaItem[] = [{ ean: 'A1', cantidad: 1, alerta: false }]
    const next = restoreList(snapshot, current)
    expect(next).toHaveLength(1)
    expect(next[0]).toEqual(snapshot[0])
  })

  it('matches the duplicate guard on normalized ean (separator/case insensitive)', () => {
    const snapshot: ListaItem[] = [{ ean: 'A1', cantidad: 1, alerta: false }]
    const current: ListaItem[] = [{ ean: 'a-1', cantidad: 9, alerta: false }]
    expect(restoreList(snapshot, current)).toHaveLength(1)
  })

  it('copies every field of an appended item verbatim (no re-derived defaults)', () => {
    const current: ListaItem[] = [
      { ean: 'B2', cantidad: 7, alerta: true, nombre: 'Yerba Canarias 1kg', productoId: 'p-9' },
    ]
    expect(restoreList([], current)[0]).toEqual(current[0])
  })

  it('keeps every snapshot field verbatim', () => {
    const snapshot: ListaItem[] = [
      { ean: 'A1', cantidad: 4, alerta: true, nombre: 'Arroz', productoId: 'p-1' },
    ]
    expect(restoreList(snapshot, [])[0]).toEqual(snapshot[0])
  })

  it('returns the snapshot when the current list is already contained in it', () => {
    const snapshot: ListaItem[] = [
      { ean: 'A1', cantidad: 1, alerta: false },
      { ean: 'B2', cantidad: 1, alerta: false },
    ]
    expect(restoreList(snapshot, [snapshot[0]!])).toEqual(snapshot)
  })

  it('returns an empty list for two empty inputs', () => {
    expect(restoreList([], [])).toEqual([])
  })

  it('never mutates either input and returns a new array', () => {
    const snapshot: ListaItem[] = [{ ean: 'A1', cantidad: 1, alerta: false }]
    const current: ListaItem[] = [{ ean: 'B2', cantidad: 1, alerta: false }]
    const snapshotBefore = [...snapshot]
    const currentBefore = [...current]
    const next = restoreList(snapshot, current)
    expect(snapshot).toEqual(snapshotBefore)
    expect(current).toEqual(currentBefore)
    expect(next).not.toBe(snapshot)
    expect(next).not.toBe(current)
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

describe('clearList', () => {
  it('returns an empty list regardless of the input', () => {
    const base: ListaItem[] = [
      { ean: '7793940219009', cantidad: 2, alerta: false },
      { ean: '7790895007217', cantidad: 1, alerta: true },
    ]
    expect(clearList()).toEqual([])
    expect(clearList().length).toBe(0)
  })
})
