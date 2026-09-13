import { describe, it, expect } from 'vitest'
import { stableId } from '../src/lib/stableId.ts'

describe('stableId', () => {
  it('is deterministic for the same input', () => {
    expect(stableId('Coca-Cola 2.25 L', 'Coca-Cola')).toBe(
      stableId('Coca-Cola 2.25 L', 'Coca-Cola'),
    )
  })

  it('differs for different name or brand', () => {
    const a = stableId('Coca-Cola 2.25 L', 'Coca-Cola')
    const b = stableId('Coca-Cola 2.25 L', 'Pepsi')
    const c = stableId('Coca-Cola 500 ml', 'Coca-Cola')
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  it('is case-insensitive and whitespace-insensitive', () => {
    expect(stableId('coca cola  2.25 l', 'coca-cola')).toBe(
      stableId('Coca Cola 2.25 L', 'Coca-Cola'),
    )
  })

  it('is a reasonable-length hash string', () => {
    const id = stableId('Yerba Playadito 1kg', 'Playadito')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })
})
