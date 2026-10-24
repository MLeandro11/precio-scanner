import { describe, expect, it } from 'vitest'
import { addScanned, removeScanned, restoreScanned } from './scanned'
import type { ScannedItem } from './scanned'

/**
 * The scanner's session accumulator, as a pure module. The screen only wires it;
 * every rule that can be wrong about "what did I scan" is pinned here.
 */

const coca = { ean: '7790895000001', nombre: 'Coca-Cola 2,5 L', precio: 3450 }
const playadito = { ean: '7790070410003', nombre: 'Yerba Playadito 1 kg', precio: 2100 }

describe('addScanned', () => {
  it('puts the newest scan on top', () => {
    const afterCoca = addScanned([], coca)
    const afterBoth = addScanned(afterCoca, playadito)

    expect(afterBoth.map((i) => i.ean)).toEqual([playadito.ean, coca.ean])
    expect(afterBoth.map((i) => i.veces)).toEqual([1, 1])
  })

  it('counts a repeat scan instead of adding a second row, and keeps its place', () => {
    const both = addScanned(addScanned([], coca), playadito)
    const again = addScanned(both, coca)

    expect(again.map((i) => i.ean)).toEqual([playadito.ean, coca.ean])
    expect(again.find((i) => i.ean === coca.ean)?.veces).toBe(2)
    expect(again.find((i) => i.ean === playadito.ean)?.veces).toBe(1)
  })

  it('refreshes the last read of name and price on a repeat scan', () => {
    const first = addScanned([], coca)
    const repriced = addScanned(first, { ...coca, precio: 3999, nombre: 'Coca-Cola 2,5 L retornable' })

    expect(repriced).toHaveLength(1)
    expect(repriced[0]).toMatchObject({ precio: 3999, nombre: 'Coca-Cola 2,5 L retornable', veces: 2 })
  })

  it('keys on the normalized EAN, so separators and lower case are the same product', () => {
    const withSeparators = addScanned([], { ...coca, ean: '779-0895 000001' })
    const plain = addScanned(withSeparators, coca)

    expect(plain).toHaveLength(1)
    expect(plain[0]).toMatchObject({ ean: coca.ean, veces: 2 })
  })

  it('ignores an empty code without touching the stored rows', () => {
    const before: ScannedItem[] = addScanned([], coca)
    const after = addScanned(before, { ean: '  ', nombre: 'fantasma', precio: 1 })

    expect(after).toEqual(before)
    expect(before).toHaveLength(1)
  })
})

describe('removeScanned', () => {
  it('removes the row and reports where it was, so undo can put it back there', () => {
    const bottom = addScanned([], coca)
    const both = addScanned(bottom, playadito)
    const { items, removed } = removeScanned(both, coca.ean)

    expect(items.map((i) => i.ean)).toEqual([playadito.ean])
    expect(removed).toMatchObject({ index: 1, item: { ean: coca.ean, veces: 1 } })
  })

  it('leaves the rows untouched when the EAN is not there', () => {
    const both = addScanned(addScanned([], coca), playadito)
    const { items, removed } = removeScanned(both, '0000000000000')

    expect(items).toEqual(both)
    expect(removed).toBeNull()
  })

  it('removes by normalized EAN, not by the raw digits of the scan', () => {
    const both = addScanned(addScanned([], coca), playadito)
    const { items } = removeScanned(both, '779-0895 000001')

    expect(items.map((i) => i.ean)).toEqual([playadito.ean])
  })
})

describe('restoreScanned', () => {
  it('undoes a removal exactly: same row, same position, same repeat count', () => {
    const ambos = addScanned(addScanned([], coca), playadito)
    const conRepeticion = addScanned(ambos, coca)
    const { items, removed } = removeScanned(conRepeticion, coca.ean)

    expect(removed).not.toBeNull()
    const restored = restoreScanned(items, removed!.item, removed!.index)

    expect(restored).toEqual(conRepeticion)
  })

  it('restores at the recorded position even when new rows arrived above it', () => {
    const ambos = addScanned(addScanned([], coca), playadito)
    const { items, removed } = removeScanned(ambos, coca.ean)
    const conNuevo = addScanned(items, { ean: '7791234567890', nombre: 'Nuevo', precio: 100 })

    const restored = restoreScanned(conNuevo, removed!.item, removed!.index)

    expect(restored.map((i) => i.ean)).toEqual(['7791234567890', coca.ean, playadito.ean])
  })

  it('does not duplicate a row that was scanned again between the removal and the undo', () => {
    const ambos = addScanned(addScanned([], coca), playadito)
    const { items, removed } = removeScanned(ambos, coca.ean)
    const rescanneado = addScanned(items, coca)

    const restored = restoreScanned(rescanneado, removed!.item, removed!.index)

    expect(restored).toEqual(rescanneado)
    expect(restored.filter((i) => i.ean === coca.ean)).toHaveLength(1)
  })
})
