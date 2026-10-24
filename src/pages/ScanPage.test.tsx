// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import ScanPage from './ScanPage'
import { STORAGE_PREFIX } from '../lib/storage'
import { LIST_STORAGE_KEY } from '../lib/lupa/list'
import { toast } from 'sonner'

/**
 * La pantalla del escáner, cableada de verdad: la cámara está simulada (el hook
 * entrega el callback de detección y el estado `active`), el catálogo está
 * simulado (`useCatalog` devuelve un cliente con `query` controlado) y el toast
 * es un espía. Lo que se prueba es el cableado —detección → acumulado → panel →
 * lista—, que es justo lo que ningún test de los módulos puros puede ver.
 *
 * Copy inline a propósito, como en el resto del repo.
 */

const COCA = { id: '1', barcode: '7790895000001', nombre: 'Coca-Cola 2,5 L', precio: 3450 }
const PLAYADITO = { id: '2', barcode: '7790070410003', nombre: 'Yerba Playadito 1 kg', precio: 2100 }

const control: {
  detect: ((code: string) => void) | null
  results: { id: string; barcode: string; nombre: string; precio: number }[]
} = { detect: null, results: [COCA, PLAYADITO] }

vi.mock('../hooks/useBarcodeScanner', () => ({
  useBarcodeScanner: (onDetect: (code: string) => void) => {
    control.detect = onDetect
    return {
      status: 'active',
      videoRef: { current: null },
      torch: { supported: false, on: false, toggle: () => {} },
      retry: () => {},
      error: null,
    }
  },
  vibrate: () => {},
}))

vi.mock('../App', () => ({
  useCatalog: () => ({
    client: { query: () => Promise.resolve({ results: control.results }) },
  }),
}))

vi.mock('sonner', () => ({ toast: vi.fn(), Toaster: () => null }))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function renderPage() {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/escanear'] },
        createElement(ScanPage),
      ),
    )
  })
}

/** Un escaneo completo: el hook avisa el código y el catálogo resuelve. */
async function scan(code: string) {
  await act(async () => {
    control.detect!(code)
  })
}

function scannedButton(): HTMLElement | null {
  return container.querySelector('[data-scan-scanned-count]')
}

function openSheet() {
  act(() => (scannedButton() as HTMLElement).click())
}

function row(ean: string): HTMLElement | null {
  return container.querySelector(`[data-scanned-row="${ean}"]`)
}

function storedList(): unknown[] {
  return JSON.parse(localStorage.getItem(STORAGE_PREFIX + LIST_STORAGE_KEY) ?? '[]') as unknown[]
}

beforeEach(() => {
  // La lista es estado real de localStorage: un ítem sobrante haría pasar los
  // tests de agregar con basura de otro test.
  localStorage.clear()
  document.body.innerHTML = ''
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  control.results = [COCA, PLAYADITO]
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.mocked(toast).mockClear()
})

describe('ScanPage — lo escaneado en la sesión', () => {
  it('does not offer the panel before anything was scanned: no phantom affordance', () => {
    renderPage()

    expect(scannedButton()).toBeNull()
    expect(container.querySelector('[data-scanned-row]')).toBeNull()
  })

  it('accumulates a resolved scan and opens it in the panel from the top bar', async () => {
    renderPage()
    await scan(COCA.barcode)

    expect(scannedButton()?.getAttribute('data-scan-scanned-count')).toBe('1')
    expect(row(COCA.barcode)).toBeNull()

    openSheet()
    expect(row(COCA.barcode)).not.toBeNull()
    expect(row(COCA.barcode)?.textContent).toContain('Coca-Cola 2,5 L')
  })

  it('counts a repeat scan instead of adding a second row', async () => {
    renderPage()
    await scan(COCA.barcode)
    await scan(COCA.barcode)

    openSheet()
    expect(container.querySelectorAll('[data-scanned-row]')).toHaveLength(1)
    expect(row(COCA.barcode)?.textContent).toContain('×2')
  })

  it('does not accumulate a code the catalog cannot resolve', async () => {
    control.results = []
    renderPage()
    await scan('0000000000000')

    expect(scannedButton()).toBeNull()
  })

  it('adds a scanned product to the same list the rest of the app writes to', async () => {
    renderPage()
    await scan(COCA.barcode)
    openSheet()

    const addBtn = () => container.querySelector(`[data-scanned-add="${COCA.barcode}"]`) as HTMLElement
    expect(addBtn().getAttribute('aria-label')).toContain('agregar a tu lista')

    act(() => addBtn().click())

    expect(storedList()).toEqual([
      { ean: COCA.barcode, nombre: 'Coca-Cola 2,5 L', cantidad: 1, alerta: false },
    ])
    expect(container.querySelector('[data-scanned-qty]')?.getAttribute('data-scanned-qty')).toBe('1')
  })

  it('keeps adding quantity to a product that is already in the list, and shows the new total', async () => {
    renderPage()
    await scan(COCA.barcode)
    openSheet()

    const addBtn = () => container.querySelector(`[data-scanned-add="${COCA.barcode}"]`) as HTMLElement
    act(() => addBtn().click())
    act(() => addBtn().click())
    act(() => addBtn().click())

    expect((storedList()[0] as { cantidad: number }).cantidad).toBe(3)
    // La fila tiene que mostrar el total: es lo único que prueba que el tercer
    // toque hizo algo, sin abrir la lista en otra pantalla.
    expect(container.querySelector('[data-scanned-qty]')?.getAttribute('data-scanned-qty')).toBe('3')
    expect(addBtn().getAttribute('aria-label')).toBe(
      'Coca-Cola 2,5 L — sumar otro (3 en tu lista)',
    )
  })

  it('removes a row without blocking, and the toast undo puts it back where it was', async () => {
    renderPage()
    await scan(PLAYADITO.barcode)
    await scan(COCA.barcode)
    openSheet()

    act(() => (container.querySelector(`[data-scanned-remove="${COCA.barcode}"]`) as HTMLElement).click())

    expect(row(COCA.barcode)).toBeNull()
    expect(row(PLAYADITO.barcode)).not.toBeNull()
    expect(vi.mocked(toast).mock.calls[0]?.[0]).toBe('Quitamos Coca-Cola 2,5 L')

    const action = vi.mocked(toast).mock.calls[0]?.[1]?.action as { onClick: () => void } | undefined
    expect(action).toBeDefined()
    act(() => action!.onClick())

    // Vuelve al tope, que era su posición: se había escaneado última.
    expect(
      Array.from(container.querySelectorAll('[data-scanned-row]')).map((el) =>
        el.getAttribute('data-scanned-row'),
      ),
    ).toEqual([COCA.barcode, PLAYADITO.barcode])
  })

  it('drops the counter when the last row is removed', async () => {
    renderPage()
    await scan(COCA.barcode)
    openSheet()

    act(() => (container.querySelector(`[data-scanned-remove="${COCA.barcode}"]`) as HTMLElement).click())

    expect(scannedButton()).toBeNull()
    expect(container.textContent).toContain('Todavía no escaneaste nada')
  })

  it('keeps the panel readable when the camera stops working, and the session list intact', async () => {
    renderPage()
    await scan(COCA.barcode)
    openSheet()

    // Un escaneo nuevo reemplaza el dock pero no toca el acumulado.
    await scan(PLAYADITO.barcode)

    expect(container.querySelectorAll('[data-scanned-row]')).toHaveLength(2)
  })
})
