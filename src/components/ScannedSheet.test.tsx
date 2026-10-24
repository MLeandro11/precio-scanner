// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import ScannedSheet from './ScannedSheet'
import type { ScannedItem } from '../lib/lupa/scanned'

/**
 * El panel se prueba por su DOM público, con el mismo arnés que el resto del repo
 * (`createRoot` + `act`, sin `@testing-library/react`). No tiene estado propio:
 * recibe las filas y devuelve intenciones, así que cada regla que puede estar mal
 * se alcanza sin cámara y sin catálogo.
 *
 * Los literales de copy quedan inline a propósito: un test que vuelve a leer la
 * constante que el componente usa no prueba nada.
 */

const coca: ScannedItem = { ean: '7790895000001', nombre: 'Coca-Cola 2,5 L', precio: 3450, veces: 2 }
const playadito: ScannedItem = { ean: '7790070410003', nombre: 'Yerba Playadito 1 kg', precio: 2100, veces: 1 }

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render(props: Partial<Parameters<typeof ScannedSheet>[0]> = {}) {
  act(() => {
    root.render(
      createElement(ScannedSheet, {
        open: true,
        items: [playadito, coca],
        onClose: () => {},
        onAdd: () => {},
        onRemove: () => {},
        onOpenProduct: () => {},
        cantidadEnLista: () => 0,
        ...props,
      }),
    )
  })
  return container
}

function row(ean: string): HTMLElement | null {
  return container.querySelector(`[data-scanned-row="${ean}"]`)
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ScannedSheet', () => {
  it('is a real dialog titled Escaneados, with a close control that names itself honestly', () => {
    render()
    const dialog = container.querySelector('[role="dialog"]')

    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(container.querySelector('h2')?.textContent).toBe('Escaneados')
    expect(container.querySelector('[aria-label="Cerrar escaneados"]')).not.toBeNull()
  })

  it('renders the rows in the order it was given', () => {
    render()
    const eans = Array.from(container.querySelectorAll('[data-scanned-row]')).map((el) =>
      el.getAttribute('data-scanned-row'),
    )

    expect(eans).toEqual([playadito.ean, coca.ean])
    expect(container.querySelector('[data-scanned-count]')?.getAttribute('data-scanned-count')).toBe('2')
  })

  it('shows how many times an EAN was scanned, and only when it is more than once', () => {
    render()

    expect(row(coca.ean)?.textContent).toContain('×2')
    expect(row(playadito.ean)?.textContent).not.toContain('×')
  })

  it('says the accumulated list is session-scoped instead of promising memory', () => {
    render()

    expect(container.textContent).toContain('2 productos en esta sesión')
    expect(container.textContent).toContain('se vacía cuando recargás la pantalla')
  })

  it('shows how many units are already in the list, and says the tap keeps adding', () => {
    const onAdd = vi.fn()
    render({ onAdd, cantidadEnLista: (ean) => (ean === coca.ean ? 3 : 0) })
    const addCoca = container.querySelector(`[data-scanned-add="${coca.ean}"]`) as HTMLElement
    const addPlayadito = container.querySelector(`[data-scanned-add="${playadito.ean}"]`) as HTMLElement

    // La cantidad es la prueba visible de que el toque hizo algo: sin número, un
    // tilde fijo se lee como "ya está, no se puede sumar más".
    expect(row(coca.ean)?.querySelector('[data-scanned-qty]')?.getAttribute('data-scanned-qty')).toBe('3')
    expect(addCoca.getAttribute('aria-label')).toContain('sumar otro')
    expect(addCoca.getAttribute('aria-label')).toContain('3 en tu lista')
    expect(row(playadito.ean)?.querySelector('[data-scanned-qty]')).toBeNull()
    expect(addPlayadito.getAttribute('aria-label')).toContain('agregar a tu lista')

    act(() => addCoca.click())
    expect(onAdd).toHaveBeenCalledWith(coca)
  })

  it('never blocks the add control once the product is in the list', () => {
    const onAdd = vi.fn()
    render({ onAdd, cantidadEnLista: (ean) => (ean === coca.ean ? 2 : 0) })
    const addCoca = container.querySelector(`[data-scanned-add="${coca.ean}"]`) as HTMLElement

    expect(addCoca.hasAttribute('disabled')).toBe(false)
    act(() => addCoca.click())
    expect(onAdd).toHaveBeenCalledWith(coca)
  })

  it('announces the new quantity to a screen reader without a toast', () => {
    render({ cantidadEnLista: (ean) => (ean === coca.ean ? 4 : 0) })
    const live = container.querySelector(`[data-scanned-add="${coca.ean}"]`)?.getAttribute('aria-label')

    expect(live).toBe('Coca-Cola 2,5 L — sumar otro (4 en tu lista)')
  })

  it('reports the row to remove, so the screen can offer the undo', () => {
    const onRemove = vi.fn()
    render({ onRemove })

    act(() => (container.querySelector(`[data-scanned-remove="${coca.ean}"]`) as HTMLElement).click())
    expect(onRemove).toHaveBeenCalledWith(coca)
  })

  it('opens the product detail from the row name', () => {
    const onOpenProduct = vi.fn()
    render({ onOpenProduct })

    act(() => (container.querySelector(`[data-scanned-open="${playadito.ean}"]`) as HTMLElement).click())
    expect(onOpenProduct).toHaveBeenCalledWith(playadito.ean)
  })

  it('has an honest empty state: nothing scanned yet, not an empty list of zeros', () => {
    render({ items: [] })

    expect(container.textContent).toContain('Todavía no escaneaste nada')
    expect(container.querySelector('[data-scanned-count]')?.getAttribute('data-scanned-count')).toBe('0')
    expect(container.querySelector('[data-scanned-row]')).toBeNull()
  })

  it('renders nothing while it is closed', () => {
    render({ open: false })

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('closes on Escape through the sheet dialog', () => {
    const onClose = vi.fn()
    render({ onClose })

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(onClose).toHaveBeenCalled()
  })
})
