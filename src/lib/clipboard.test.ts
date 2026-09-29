import { describe, it, expect, afterEach, vi } from 'vitest'
import { copyText, formatEanLines } from './clipboard'

/**
 * This runner is Node, with no jsdom/happy-dom: every global the helpers touch
 * (`navigator`, `document`) is stubbed explicitly with `vi.stubGlobal`, the same
 * way `storage.test.ts` stubs `localStorage`.
 */

/**
 * Minimal document stand-in. It exposes only what the textarea fallback needs,
 * so the tests also pin that the fallback does not depend on the full DOM: no
 * `style`, no layout, no `Range`.
 */
function stubDocument({ execCommandResult = true, appendThrows = false } = {}) {
  const children: unknown[] = []
  const textareas: Array<{ value: string; setAttribute: () => void; focus: () => void; select: () => void }> = []
  const doc = {
    createElement: () => {
      const el = {
        value: '',
        setAttribute: () => undefined,
        focus: () => undefined,
        select: () => undefined,
      }
      textareas.push(el)
      return el
    },
    body: {
      appendChild: (el: unknown) => {
        if (appendThrows) throw new Error('append boom')
        children.push(el)
        return el
      },
      removeChild: (el: unknown) => {
        const i = children.indexOf(el)
        if (i >= 0) children.splice(i, 1)
        return el
      },
    },
    execCommand: () => execCommandResult,
  }
  vi.stubGlobal('document', doc)
  return { children, textareas }
}

describe('formatEanLines', () => {
  it('returns an empty string for an empty list', () => {
    expect(formatEanLines([])).toBe('')
  })

  it('trims entries, drops blanks, and keeps order and duplicates', () => {
    expect(formatEanLines([' 7793940219009 ', '', '   ', '7790895000016', '7793940219009'])).toBe(
      '7793940219009\n7790895000016\n7793940219009',
    )
  })

  it('never throws on null or undefined entries', () => {
    const withHoles = [null, undefined, '7793940219009'] as unknown as string[]
    expect(() => formatEanLines(withHoles)).not.toThrow()
    expect(formatEanLines(withHoles)).toBe('7793940219009')
  })
})

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses navigator.clipboard.writeText when available', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyText('7793940219009')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('7793940219009')
  })

  it('falls back to a hidden textarea when navigator.clipboard is absent', async () => {
    vi.stubGlobal('navigator', {})
    const { children, textareas } = stubDocument()

    await expect(copyText('7793940219009')).resolves.toBe(true)
    expect(textareas).toHaveLength(1)
    expect(textareas[0].value).toBe('7793940219009')
    // The node is always removed, so a copy never leaks a stray textarea.
    expect(children).toHaveLength(0)
  })

  it('returns false when the clipboard rejects and no DOM fallback exists', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied')
        }),
      },
    })

    await expect(copyText('7793940219009')).resolves.toBe(false)
  })

  it('returns false when execCommand reports failure, and still removes the textarea', async () => {
    vi.stubGlobal('navigator', {})
    const { children } = stubDocument({ execCommandResult: false })

    await expect(copyText('7793940219009')).resolves.toBe(false)
    expect(children).toHaveLength(0)
  })

  it('returns false instead of throwing when the DOM fallback blows up', async () => {
    vi.stubGlobal('navigator', {})
    stubDocument({ appendThrows: true })

    await expect(copyText('7793940219009')).resolves.toBe(false)
  })

  it('returns false when there is no document at all', async () => {
    vi.stubGlobal('navigator', {})

    await expect(copyText('7793940219009')).resolves.toBe(false)
  })
})
