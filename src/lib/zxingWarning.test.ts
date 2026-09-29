import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotFoundException, FormatException, ChecksumException } from '@zxing/library'
import { isExpectedZxingMiss, suppressExpectedZxingMisses } from './zxingWarning'

/**
 * The filter exists for exactly one upstream line from @zxing/library 0.23.0:
 * MultiFormatReader.decodeInternal logs an ordinary decode miss as if it were an
 * unexpected exception. These tests pin the exact shape of that one message so
 * widening the filter (and hiding a real defect) breaks them loudly.
 *
 * The three reader outcomes are siblings of ReaderException in the JS port,
 * which is why the upstream `instanceof ReaderException` guard lets them
 * through. They are used as the REAL library classes (they carry the stable
 * `static kind` / `getKind()` that survives minification), and a hostile-but-
 * conforming name (e.g. `NotNotFoundException`) is asserted to stay VISIBLE —
 * the match is exact equality, not substring.
 */
const PREFIX = 'MultiFormatReader: non-ReaderException from reader:'

class SomeOtherException extends Error {}

/** Restores whatever a test installed, even if the test asserted before restoring. */
let pendingRestore: (() => void) | null = null

afterEach(() => {
  pendingRestore?.()
  pendingRestore = null
  vi.restoreAllMocks()
})

describe('isExpectedZxingMiss', () => {
  it('accepts the exact MultiFormatReader miss for every expected reader outcome (real library classes)', () => {
    expect(isExpectedZxingMiss([PREFIX, new NotFoundException()])).toBe(true)
    expect(isExpectedZxingMiss([PREFIX, new FormatException()])).toBe(true)
    expect(isExpectedZxingMiss([PREFIX, new ChecksumException()])).toBe(true)
  })

  it('matches the library stable kind that survives production minification', () => {
    // The production bundle mangles the class name (NotFoundException -> `e`).
    // ZXing's exceptions keep a stable `kind`/`getKind()` that does not.
    class MinifiedErr extends Error {
      static kind = 'NotFoundException'
    }
    class KindMethodErr extends Error {
      getKind() {
        return 'FormatException'
      }
    }
    expect(isExpectedZxingMiss([PREFIX, new MinifiedErr()])).toBe(true)
    expect(isExpectedZxingMiss([PREFIX, new KindMethodErr()])).toBe(true)
  })

  it('rejects a different message', () => {
    expect(isExpectedZxingMiss(['some other warning', new NotFoundException()])).toBe(false)
    expect(isExpectedZxingMiss([`x ${PREFIX}`, new NotFoundException()])).toBe(false)
  })

  it('rejects a non-Error second operand', () => {
    expect(isExpectedZxingMiss([PREFIX, 'NotFoundException'])).toBe(false)
    expect(isExpectedZxingMiss([PREFIX, { name: 'NotFoundException' }])).toBe(false)
  })

  it('rejects a missing operand and empty args', () => {
    expect(isExpectedZxingMiss([PREFIX])).toBe(false)
    expect(isExpectedZxingMiss([])).toBe(false)
  })

  it('rejects an unrelated exception class so genuinely unexpected errors stay visible', () => {
    expect(isExpectedZxingMiss([PREFIX, new TypeError('boom')])).toBe(false)
    expect(isExpectedZxingMiss([PREFIX, new SomeOtherException('boom')])).toBe(false)
  })

  it('rejects names that merely CONTAIN an outcome: the match is exact equality', () => {
    class NotNotFoundException extends Error {}
    class SpecialFormatException extends Error {}
    expect(isExpectedZxingMiss([PREFIX, new NotNotFoundException('gotcha')])).toBe(false)
    expect(isExpectedZxingMiss([PREFIX, new SpecialFormatException('gotcha')])).toBe(false)
  })

  it('is the one honest widening: an unrelated Error carrying the precise outcome name IS suppressed', () => {
    const fake = new SomeOtherException('real crash')
    // The `name` fallback is a documented widening, not a claim of perfect precision.
    fake.name = 'NotFoundException'
    expect(isExpectedZxingMiss([PREFIX, fake])).toBe(true)
  })
})

describe('isExpectedZxingMiss is total (never throws, never suprses a live operand)', () => {
  const nameThrow = new SomeOtherException('?')
  Object.defineProperty(nameThrow, 'name', {
    get() {
      throw new Error('getter blew up')
    },
  })

  const constructorThrow = new SomeOtherException('?')
  Object.defineProperty(constructorThrow, 'constructor', {
    get() {
      throw new Error('constructor getter blew up')
    },
  })

  const getKindThrow = new SomeOtherException('?')
  Object.defineProperty(getKindThrow, 'getKind', {
    get() {
      throw new Error('getKind read blew up')
    },
  })

  const staticKindThrow = new SomeOtherException('?')
  {
    class C extends Error {}
    Object.defineProperty(C, 'kind', {
      get() {
        throw new Error('static kind getter blew up')
      },
    })
    ;(staticKindThrow as unknown as { constructor: unknown }).constructor = C
  }

  const hostile = [nameThrow, constructorThrow, getKindThrow, staticKindThrow]

  it.each(hostile.map((err) => () => err))('returns boolean and does not throw for a broken operand %#', (err) => {
    expect(() => isExpectedZxingMiss([PREFIX, err])).not.toThrow()
    expect(isExpectedZxingMiss([PREFIX, err])).toBe(false) // unreadable = stays visible
  })

  it('console.warn with a broken operand is forwarded, never swallowed nor made to throw', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const restore = suppressExpectedZxingMisses()

    expect(() => console.warn(PREFIX, nameThrow)).not.toThrow()
    expect(spy).toHaveBeenCalledTimes(1)

    expect(() => console.warn(PREFIX, constructorThrow)).not.toThrow()
    expect(() => console.warn(PREFIX, getKindThrow)).not.toThrow()
    expect(() => console.warn(PREFIX, staticKindThrow)).not.toThrow()
    expect(spy).toHaveBeenCalledTimes(4)

    restore()
  })
})

describe('suppressExpectedZxingMisses', () => {
  it('suppresses the expected miss and forwards everything else unchanged', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pendingRestore = suppressExpectedZxingMisses()

    console.warn(PREFIX, new NotFoundException())
    expect(spy).not.toHaveBeenCalled()

    const other = new Error('boom')
    console.warn('another warning', other)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('another warning', other)
  })

  it('restores the original console.warn, and its restore is idempotent', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const restore = suppressExpectedZxingMisses()
    pendingRestore = restore

    const miss = new NotFoundException()
    console.warn(PREFIX, miss)
    expect(spy).not.toHaveBeenCalled()

    restore()
    console.warn(PREFIX, miss)
    expect(spy).toHaveBeenCalledWith(PREFIX, miss)

    expect(() => restore()).not.toThrow()
    console.warn(PREFIX, miss)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('does not stack a second wrapper when called while already installed', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = suppressExpectedZxingMisses()
    pendingRestore = first
    const second = suppressExpectedZxingMisses()

    const miss = new NotFoundException()
    console.warn(PREFIX, miss)
    expect(spy).not.toHaveBeenCalled()

    // Restoring either handle removes the single wrapper: no leftover layer.
    second()
    console.warn(PREFIX, miss)
    expect(spy).toHaveBeenCalledWith(PREFIX, miss)
  })
})
