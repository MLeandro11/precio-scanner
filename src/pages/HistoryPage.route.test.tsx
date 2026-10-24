// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import HistoryPage from './HistoryPage'

/**
 * La ruta, no la vista.
 *
 * El defecto que el usuario vio en consola: pasarle al hook de resolución un array
 * literal (`[codigo]`) le da una identidad NUEVA en cada render. El hook memoiza por
 * esa identidad y reinicia su efecto, que hace `setResolved({})`, que re-renderiza…
 * un loop infinito que además consulta al worker una vez por vuelta.
 *
 * Correr ese loop de verdad mata el proceso de test (SIGABRT, minutos de espera), así
 * que acá se pinea **la causa concreta**: la identidad del array tiene que ser la
 * misma en todos los renders. El hook se reemplaza por un espía que no actualiza
 * estado, así el test falla limpio en vez de colgarse.
 */

const capturas = vi.hoisted(() => [] as unknown[][])

vi.mock('../App', () => ({ useCatalog: () => ({ client: { resolveMany: async () => ({}) } }) }))

vi.mock('../hooks/useResolveEans', () => ({
  useResolveEans: (_client: unknown, eans: string[]) => {
    capturas.push(eans)
    return []
  },
}))

vi.mock('../lib/historial', async () => {
  const actual = await vi.importActual<typeof import('../lib/historial')>('../lib/historial')
  return { ...actual, loadHistorial: async () => ({ status: 'absent' as const }) }
})

const EAN = '7790895000001'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  capturas.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('HistoryPage — la ruta no puede entrar en loop', () => {
  it('hands the resolver the same array identity on every render', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [`/historial/${EAN}`] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/historial/:ean', element: createElement(HistoryPage) }),
          ),
        ),
      )
    })

    // El loader resolvió a `absent`, así que hubo al menos un segundo render.
    expect(capturas.length).toBeGreaterThan(1)
    // Y todas las veces fue el MISMO array: una identidad nueva por render es el loop.
    expect(new Set(capturas).size).toBe(1)
    expect(capturas[0]).toEqual([EAN])
    expect(container.querySelector('[data-history-state]')?.getAttribute('data-history-state')).toBe(
      'absent',
    )
  })
})
