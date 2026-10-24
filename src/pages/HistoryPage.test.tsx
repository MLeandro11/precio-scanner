// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { HistoryView } from './HistoryPage'
import type { HistorialEstado } from './HistoryPage'
import type { HistorialArtifact, HistorialDia } from '../lib/historial'
import { HISTORIAL_VERSION } from '../lib/historial'

/**
 * La pantalla se prueba por su DOM, con los desenlaces del loader inyectados: no se
 * toca red ni catálogo. Lo que importa es que cada estado diga la verdad —"todavía
 * no hay historial" no es "el historial está roto"— y que el gráfico nunca dibuje
 * continuidad sobre un hueco.
 */

const EAN = '7790895000001'

const dia = (fecha: string, precio: number): HistorialDia => ({
  fecha,
  cambios: [{ ean: EAN, precio }],
})

/** Un día en que la corrida pasó y este producto no cambió: bucket vacío. */
const sinCambio = (fecha: string): HistorialDia => ({ fecha, cambios: [] })

function artifact(dias: HistorialDia[]): HistorialArtifact {
  return { version: HISTORIAL_VERSION, generado: `${dias[dias.length - 1]?.fecha ?? '2026-10-20'}T12:00:00Z`, dias }
}

function ready(dias: HistorialDia[], source: 'network' | 'cache' = 'network'): HistorialEstado {
  return { status: 'ready', source, artifact: artifact(dias) }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render(estado: HistorialEstado, extra: { nombre?: string; onRetry?: () => void } = {}) {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(HistoryView, { ean: EAN, estado, ...extra }),
      ),
    )
  })
  return container
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.innerHTML = ''
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('HistoryView — estados', () => {
  it('draws the series and its movements when the log is fresh', () => {
    render(ready([dia('2026-10-15', 3500), dia('2026-10-18', 3600), dia('2026-10-20', 3450)]))

    expect(container.querySelector('[data-history-state]')?.getAttribute('data-history-state')).toBe('ready')
    expect(container.querySelector('[data-history-points]')?.getAttribute('data-history-points')).toBe('3')
    expect(container.querySelectorAll('[data-history-move]')).toHaveLength(2)
    expect(container.textContent).toContain('↓')
    expect(container.textContent).toContain('$ 3.450')
  })

  it('names the offline copy instead of passing it off as fresh data', () => {
    render(ready([dia('2026-10-15', 3500), dia('2026-10-20', 3450)], 'cache'))

    expect(container.querySelector('[data-history-state]')?.getAttribute('data-history-state')).toBe('cached')
    expect(container.querySelectorAll('[data-history-move]')).toHaveLength(1)
  })

  it('says the history is not published yet, without pretending it is broken', () => {
    render({ status: 'absent' })

    expect(container.querySelector('[data-history-state]')?.getAttribute('data-history-state')).toBe('absent')
    expect(container.textContent).toContain('Todavía no hay historial publicado')
    expect(container.querySelector('[data-history-points]')).toBeNull()
    expect(container.querySelectorAll('[data-history-move]')).toHaveLength(0)
  })

  it('distinguishes an unreadable artifact from a missing one, and does not offer a pointless retry', () => {
    const onRetry = vi.fn()
    render({ status: 'invalid' }, { onRetry })

    expect(container.querySelector('[data-history-state]')?.getAttribute('data-history-state')).toBe('invalid')
    expect(container.textContent).toContain('no se pudo leer')
    expect(container.textContent).not.toContain('Todavía no hay historial')
    expect(container.textContent).not.toContain('Reintentar')
  })

  it('offers a retry when the network or the server failed', () => {
    const onRetry = vi.fn()
    render({ status: 'offline' }, { onRetry })

    const boton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar'))
    expect(boton).toBeDefined()
    act(() => boton!.click())
    expect(onRetry).toHaveBeenCalled()
  })

  it('shows the product name when it could be resolved, and the generic title when not', () => {
    render(ready([dia('2026-10-15', 3500), dia('2026-10-20', 3450)]), { nombre: 'Coca-Cola 2,5 L' })
    expect(container.querySelector('h2')?.textContent).toBe('Coca-Cola 2,5 L')

    act(() => root.unmount())
    root = createRoot(container)
    render({ status: 'absent' })
    expect(container.querySelector('h2')?.textContent).toBe('Historial de precio')
    expect(container.textContent).toContain(EAN)
  })
})

describe('HistoryView — la dirección se dice una sola vez', () => {
  it('does not say "down" with a plus sign next to it', () => {
    // La flecha ya dice la dirección: `↓ +3,33 %` se contradice a sí mismo.
    render(ready([dia('2026-10-15', 1500), dia('2026-10-20', 1450)]))

    const texto = (container.textContent ?? '').replace(/\s+/g, ' ')
    expect(texto).toContain('↓ 3,33 %')
    expect(texto).not.toContain('↓ +')
    expect(texto).not.toContain('↑ -')
  })
})

describe('HistoryView — huecos y series cortas', () => {
  it('names the days the artifact has no data for, and does not draw across them', () => {
    // El artefacto tiene el 15 y el 20 pero ningún día en el medio: no hubo corrida.
    render(ready([dia('2026-10-15', 3500), dia('2026-10-20', 3450)]))

    const hueco = container.querySelector('[data-history-gap]')
    expect(hueco?.getAttribute('data-history-gap')).toBe('2026-10-16..2026-10-19')
    // Dos puntos sueltos: unirlos afirmaría una continuidad que el archivo no tiene.
    expect(container.querySelectorAll('[data-history-segment]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-history-point]')).toHaveLength(2)
  })

  it('connects the line across days that ran without a change for this product', () => {
    // Bucket vacío = "corrió y el precio se mantuvo". Eso NO es un hueco: es la
    // razón por la que el gráfico puede dibujar una línea entre dos cambios.
    render(
      ready([
        dia('2026-10-15', 3500),
        sinCambio('2026-10-16'),
        sinCambio('2026-10-17'),
        dia('2026-10-18', 3450),
      ]),
    )

    expect(container.querySelector('[data-history-gap]')).toBeNull()
    expect(container.querySelectorAll('[data-history-segment]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-history-point]')).toHaveLength(2)
  })

  it('says there is only one registered day instead of inventing a trend', () => {
    render(ready([dia('2026-10-20', 3450)]))

    expect(container.textContent).toContain('un solo día registrado')
    expect(container.querySelectorAll('[data-history-move]')).toHaveLength(0)
  })

  it('says the price did not change when the series is flat', () => {
    render(ready([dia('2026-10-15', 3450), dia('2026-10-20', 3450)]))

    expect(container.textContent).toContain('Sin cambios')
    expect(container.querySelectorAll('[data-history-move]')).toHaveLength(0)
  })
})
