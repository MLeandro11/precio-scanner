import { describe, it, expect } from 'vitest'
import { createScanGate, toLookupDigits } from './scan'

describe('createScanGate', () => {
  it('emits the first code', () => {
    const gate = createScanGate()
    expect(gate.shouldEmit('7793940219009', 0)).toBe(true)
  })

  it('dedupes the same code within the window (firehose → one signal)', () => {
    const gate = createScanGate({ windowMs: 1000 })
    expect(gate.shouldEmit('7793940219009', 0)).toBe(true)
    expect(gate.shouldEmit('7793940219009', 10)).toBe(false)
    expect(gate.shouldEmit('7793940219009', 999)).toBe(false)
  })

  it('re-emits after the window passes', () => {
    const gate = createScanGate({ windowMs: 1000 })
    gate.shouldEmit('7793940219009', 0)
    expect(gate.shouldEmit('7793940219009', 1001)).toBe(true)
  })

  it('treats separator variations of the same code as equal', () => {
    const gate = createScanGate()
    expect(gate.shouldEmit('779 3940 219009', 0)).toBe(true)
    expect(gate.shouldEmit('7793940219009', 5)).toBe(false)
  })

  it('emits a different code immediately', () => {
    const gate = createScanGate({ windowMs: 1000 })
    gate.shouldEmit('7793940219009', 0)
    expect(gate.shouldEmit('7790000000000', 1)).toBe(true)
  })

  it('ignores empty codes', () => {
    const gate = createScanGate()
    expect(gate.shouldEmit('', 0)).toBe(false)
    expect(gate.shouldEmit('   ', 1)).toBe(false)
  })

  it('reset allows the same code again immediately', () => {
    const gate = createScanGate()
    gate.shouldEmit('7793940219009', 0)
    gate.reset()
    expect(gate.shouldEmit('7793940219009', 1)).toBe(true)
  })
})

describe('toLookupDigits', () => {
  it('strips separators and letters', () => {
    expect(toLookupDigits('EAN 779-3940 219.009')).toBe('7793940219009')
    expect(toLookupDigits('')).toBe('')
  })
})