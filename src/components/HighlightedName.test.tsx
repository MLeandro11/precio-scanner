// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import HighlightedName from './HighlightedName'
import type { HighlightRange } from './HighlightedName'

/**
 * Fuse's match ranges are INCLUSIVE `[start, end]` — the character at `end` is part of the
 * match. `HighlightedName` used to slice `nombre.slice(start, end)`, so the last character of
 * every highlighted run stayed unmarked. The text stayed readable because the cursor then
 * re-emitted that character inside the following plain span, which is exactly why the bug
 * survived: it is purely visual and invisible to any test that only compares `textContent`.
 *
 * So the two halves of the fix are pinned separately:
 *  - the marked text must be the inclusive slice (the "off-by-one" assertions below);
 *  - the renderer must stay lossless and duplicate-free, i.e. the concatenation of every
 *    rendered span/mark equals the original `nombre` exactly. That property is what fails if
 *    only the slice is fixed and `cursor` keeps advancing to the exclusive `end`: two adjacent
 *    ranges would then re-emit the character at `end`.
 *
 * Both real-catalog examples below (`PLAYADITO`, `SERENISIMA`) are the ranges Fuse actually
 * emits for those queries against `public/data/catalogo.json`.
 *
 * This is the project's second DOM test; `// @vitest-environment jsdom` above is what keeps the
 * remaining Node-environment files untouched.
 */
let container: HTMLElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function render(nombre: string, ranges?: HighlightRange[]): HTMLElement {
  act(() => {
    root.render(createElement(HighlightedName, { nombre, ranges }))
  })
  return container
}

/** Every `<mark>`'s text, in document order. */
function markTexts(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('mark')).map((mark) => mark.textContent ?? '')
}

/** All rendered text — marks and plain spans — concatenated in document order. */
function renderedText(el: HTMLElement): string {
  return el.textContent ?? ''
}

/** The inclusive marks the given ranges must produce, built independently of the component. */
function expectedMarks(nombre: string, ranges: HighlightRange[]): string[] {
  return [...ranges]
    .sort((a, b) => a[0] - b[0])
    .map(([start, end]) => nombre.slice(start, end + 1))
}

describe('HighlightedName', () => {
  it('marks the inclusive run, not one character less', () => {
    const el = render('COCA COLA 1.75', [[0, 3]])

    expect(markTexts(el)).toEqual(['COCA'])
  })

  it('marks the real PLAYADITO match through its last character', () => {
    const el = render('YERBA PLAYADITO X 1KG', [[6, 14]])

    expect(markTexts(el)).toEqual(['PLAYADITO'])
    expect(renderedText(el)).toBe('YERBA PLAYADITO X 1KG')
  })

  it('marks a range that ends on the last character of the name', () => {
    const nombre = 'BEBIDA LACTEA FRUTILLA SERENISIMA'
    expect(nombre).toHaveLength(33)

    const el = render(nombre, [[23, 32]])

    expect(markTexts(el)).toEqual(['SERENISIMA'])
    expect(markTexts(el)[0].endsWith('A')).toBe(true)
  })

  it('marks a range that ends at the last index of a 21-character name', () => {
    const nombre = 'PAN LACTAL BIMBO 500G'
    expect(nombre).toHaveLength(21)

    const el = render(nombre, [[17, 20]])

    expect(markTexts(el)).toEqual(['500G'])
    expect(renderedText(el)).toBe(nombre)
  })

  describe('rendering is lossless for every range shape', () => {
    const cases: Array<{ label: string; nombre: string; ranges: HighlightRange[] }> = [
      { label: 'single range', nombre: 'COCA COLA 1.75', ranges: [[0, 3]] },
      { label: 'single range in the middle', nombre: 'YERBA PLAYADITO X 1KG', ranges: [[6, 14]] },
      {
        label: 'two disjoint ranges',
        nombre: 'COCA COLA 1.75',
        ranges: [
          [0, 3],
          [5, 8],
        ],
      },
      // Adjacent, not touching from `mergeRanges`' point of view only if they skip a character;
      // here they are consecutive indices, which is the shape that breaks an inclusive slice
      // paired with an exclusive cursor advance.
      { label: 'two adjacent ranges', nombre: 'COCA COLA 1.75', ranges: [[0, 3], [4, 7]] },
      { label: 'range ending on the last index', nombre: 'COCA COLA 1.75', ranges: [[10, 13]] },
      {
        label: 'range covering the whole name',
        nombre: 'COCA COLA 1.75',
        ranges: [[0, 13]],
      },
    ]

    for (const { label, nombre, ranges } of cases) {
      it(`${label}: text is neither lost nor duplicated, marks are inclusive`, () => {
        const el = render(nombre, ranges)

        // nothing lost, nothing duplicated
        expect(renderedText(el)).toBe(nombre)
        // and the marks themselves cover the inclusive ranges
        expect(markTexts(el)).toEqual(expectedMarks(nombre, ranges))
      })
    }
  })

  it('renders plain text with no mark when there are no ranges', () => {
    expect(markTexts(render('COCA COLA 1.75'))).toEqual([])
    expect(render('COCA COLA 1.75').querySelectorAll('mark')).toHaveLength(0)
    expect(renderedText(container)).toBe('COCA COLA 1.75')
  })

  it('renders plain text with no mark for an empty range array', () => {
    const el = render('COCA COLA 1.75', [])

    expect(el.querySelectorAll('mark')).toHaveLength(0)
    expect(renderedText(el)).toBe('COCA COLA 1.75')
  })
})
