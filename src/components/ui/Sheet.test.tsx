// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import Sheet from './Sheet'

/**
 * `Sheet` es compartido: lo usan los filtros de búsqueda y el panel de escaneados.
 * Cuando se le agregó `closeLabel`, el contrato que ya consumía `/buscar` tenía
 * que quedar intacto — un panel que no es el de filtros no puede cerrarse con un
 * botón que diga "Cerrar filtros", pero el de filtros tiene que seguir diciéndolo.
 */

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render(props: { closeLabel?: string; onClose?: () => void } = {}) {
  act(() => {
    root.render(
      createElement(Sheet, {
        open: true,
        title: 'Filtros',
        ...props,
        children: createElement('p', null, 'contenido'),
      }),
    )
  })
  return container
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Sheet', () => {
  it('keeps the label its original caller relies on when no closeLabel is given', () => {
    render()

    expect(container.querySelector('[aria-label="Cerrar filtros"]')).not.toBeNull()
  })

  it('names itself honestly when the panel is not the filter surface', () => {
    const onClose = vi.fn()
    render({ closeLabel: 'Cerrar escaneados', onClose })

    const close = container.querySelector('[aria-label="Cerrar escaneados"]') as HTMLElement
    expect(close).not.toBeNull()
    act(() => close.click())
    expect(onClose).toHaveBeenCalled()
  })
})
