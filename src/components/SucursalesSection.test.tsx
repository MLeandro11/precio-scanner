// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import SucursalesSection from './SucursalesSection'
import type { PreciosClarosClient, ProductoQuery } from '../lib/preciosClaros/client'
import type { ProductoResponse } from '../lib/preciosClaros/schema'

/**
 * SucursalesSection owns the two-step flow: the tap asks the browser for a
 * location, and only coordinates unlock the fetch. That property is invisible in
 * the rendered markup — an eager component would still show the same CTA first —
 * so the CTA test asserts the `getCurrentPosition` call spy, never only the text.
 *
 * There is no `@testing-library/react` in this repo (see `HighlightedName.test.tsx`
 * and the hooks' tests): the harness is `createRoot` + `act`, and every assertion
 * reads the real container's text/buttons after the act flush. Copy literals are
 * inlined on purpose — a test that re-reads the constant the component renders
 * proves nothing.
 *
 * The hooks are composed, not injected, so the states are reached through
 * `navigator.geolocation` (mocked exactly like `useUbicacion.test.ts`) plus an
 * injected Precios Claros client whose `fetchProducto` is fully controlled, so no
 * network is ever touched.
 */

type SuccessCallback = (position: GeolocationPosition) => void
type ErrorCallback = (error: GeolocationPositionError) => void

const EAN = '7790895000430'

interface BranchInput {
  id: string
  banderaDescripcion?: string
  sucursalNombre?: string
  direccion?: string
  localidad?: string
  provincia?: string
  distanciaNumero?: number
  distanciaDescripcion?: string
  precio: number | null
}

/** Builds a `/prod/producto` response with one entry per requested branch. */
function responseFrom(branches: BranchInput[]): ProductoResponse {
  return {
    status: 200,
    total: branches.length,
    producto: { id: EAN },
    sucursales: branches.map((b) => ({
      id: b.id,
      comercioId: 15,
      banderaId: 1,
      banderaDescripcion: b.banderaDescripcion,
      sucursalNombre: b.sucursalNombre,
      direccion: b.direccion,
      localidad: b.localidad,
      provincia: b.provincia,
      distanciaNumero: b.distanciaNumero,
      distanciaDescripcion: b.distanciaDescripcion,
      preciosProducto: b.precio === null ? {} : { precioLista: b.precio },
    })),
  }
}

/** Unknown EAN: `total: 0` + `producto.msg` is a normal state, not a failure. */
function sinDatosResponse(): ProductoResponse {
  return {
    status: 200,
    total: 0,
    producto: { msg: 'Producto inexistente.' },
    sucursales: [],
  }
}

function injectedClient(): {
  client: PreciosClarosClient
  fetchProducto: ReturnType<
    typeof vi.fn<(query: ProductoQuery) => Promise<ProductoResponse>>
  >
} {
  const fetchProducto = vi.fn<(query: ProductoQuery) => Promise<ProductoResponse>>()
  const client: PreciosClarosClient = { fetchProducto }
  return { client, fetchProducto }
}

let getCurrentPosition: ReturnType<typeof vi.fn>
let watchPosition: ReturnType<typeof vi.fn>

function installGeolocation(): void {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition, watchPosition },
  })
}

function removeGeolocation(): void {
  delete (navigator as { geolocation?: unknown }).geolocation
}

/** Answers the permission prompt immediately with real-looking coordinates. */
function succeed(lat = -51.6226, lng = -69.2181): void {
  getCurrentPosition.mockImplementation((success: SuccessCallback) => {
    success(fakePosition(lat, lng))
  })
}

/** A position shaped like the one the browser hands to the success callback. */
function fakePosition(lat = -51.6226, lng = -69.2181): GeolocationPosition {
  return {
    coords: { latitude: lat, longitude: lng },
  } as unknown as GeolocationPosition
}

/** Refuses with the browser's code 1 (denied). */
function deny(): void {
  getCurrentPosition.mockImplementation((_success: SuccessCallback, error: ErrorCallback) => {
    error({ code: 1 } as unknown as GeolocationPositionError)
  })
}

let root: ReturnType<typeof createRoot>
let container: HTMLElement
let mounted = false

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function renderSection(client: PreciosClarosClient): Promise<void> {
  mounted = true
  await act(async () => {
    root.render(createElement(SucursalesSection, { ean: EAN, client }))
  })
  await flush()
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

function text(): string {
  return container.textContent ?? ''
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}

function button(label: string): HTMLButtonElement {
  const found = buttons().find((b) => (b.textContent ?? '').includes(label))
  if (!found) throw new Error(`no button labelled "${label}"`)
  return found
}

/** The text of every rendered branch row, in document order. */
function rows(): string[] {
  return Array.from(container.querySelectorAll('li')).map((li) => li.textContent ?? '')
}

/** Every live region currently mounted — must always be exactly one. */
function liveRegions(): Element[] {
  return Array.from(container.querySelectorAll('[aria-live="polite"]'))
}

/**
 * The single live region's text. Throws when it is missing or duplicated, so a
 * test can never pass by silently reading nothing.
 */
function liveText(): string {
  const regions = liveRegions()
  if (regions.length !== 1) {
    throw new Error(`expected exactly one live region, found ${regions.length}`)
  }
  return regions[0].textContent ?? ''
}

beforeEach(() => {
  mounted = false
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  getCurrentPosition = vi.fn()
  watchPosition = vi.fn()
  installGeolocation()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  if (mounted) {
    await act(async () => {
      root.unmount()
    })
  }
  removeGeolocation()
  vi.restoreAllMocks()
  container.remove()
})

describe('SucursalesSection location flow', () => {
  it('shows the explanation and asks for the location only after the tap', async () => {
    const { client, fetchProducto } = injectedClient()

    await renderSection(client)

    expect(text()).toContain('Precios en sucursales cercanas')
    expect(text()).toContain(
      'Usamos tu ubicación para buscar sucursales cerca tuyo. No la guardamos.',
    )
    expect(text()).toContain('Ver precios cerca mío')
    // Mounting reaches for nothing: neither the browser nor the API.
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(fetchProducto).not.toHaveBeenCalled()

    getCurrentPosition.mockImplementation(() => {
      /* stays pending: the test only asserts the trigger */
    })
    await click(button('Ver precios cerca mío'))

    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(text()).toContain('Pidiendo tu ubicación…')
  })

  it('unsupported: renders its own line and no button at all', async () => {
    removeGeolocation()
    const { client, fetchProducto } = injectedClient()
    await renderSection(client)

    await click(button('Ver precios cerca mío'))

    expect(text()).toContain('Tu navegador no puede darnos la ubicación.')
    expect(text()).not.toContain('No la guardamos.')
    expect(buttons()).toHaveLength(0)
    expect(fetchProducto).not.toHaveBeenCalled()
  })

  it('requesting: announces the in-flight status line', async () => {
    getCurrentPosition.mockImplementation(() => {
      /* pending */
    })
    const { client } = injectedClient()
    await renderSection(client)

    await click(button('Ver precios cerca mío'))

    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toContain('Pidiendo tu ubicación…')
  })

  it('denied: renders exactly the honest line and no retry button', async () => {
    deny()
    const { client, fetchProducto } = injectedClient()
    await renderSection(client)

    await click(button('Ver precios cerca mío'))

    expect(text()).toContain('Activá la ubicación para ver precios por sucursal.')
    expect(text()).not.toContain('No la guardamos.')
    expect(buttons()).toHaveLength(0)
    expect(fetchProducto).not.toHaveBeenCalled()
  })

  it('ubicación error: offers a Reintentar that asks again', async () => {
    getCurrentPosition.mockImplementation((_success: SuccessCallback, error: ErrorCallback) => {
      error({ code: 2 } as unknown as GeolocationPositionError)
    })
    const { client } = injectedClient()
    await renderSection(client)

    await click(button('Ver precios cerca mío'))
    expect(text()).toContain('No pudimos obtener tu ubicación.')

    await click(button('Reintentar'))
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
  })
})

describe('SucursalesSection ready states', () => {
  it('con-precios: renders rows in price order (never distance) and caps at 8', async () => {
    // Price ascending is 1..10 while distance ascending is 10..1, so a re-sort
    // by distance (or any re-sort) flips the rendered order.
    const branches: BranchInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i + 1),
      banderaDescripcion: `Banner ${i + 1}`,
      sucursalNombre: `Sucursal ${i + 1}`,
      direccion: `Calle ${i + 1}`,
      distanciaNumero: (10 - i) * 1.5,
      distanciaDescripcion: `distancia ${10 - i}`,
      precio: (i + 1) * 100,
    }))
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(responseFrom(branches))

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    const rendered = rows()
    expect(rendered).toHaveLength(8)
    expect(rendered[0]).toContain('Banner 1')
    expect(rendered[0]).toContain('$ 100')
    expect(rendered[0]).toContain('distancia 10')
    expect(rendered[7]).toContain('Banner 8')
    expect(text()).not.toContain('Banner 9')
    expect(text()).toContain('Mostrando las 8 más baratas de 10.')
  })

  it('con-precios: does not render a delta, a badge or any saving figure', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(
      responseFrom([
        { id: '1', banderaDescripcion: 'Coto', sucursalNombre: 'Centro', precio: 4900 },
        { id: '2', banderaDescripcion: 'Dia', sucursalNombre: 'Norte', precio: 5200 },
      ]),
    )

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(text()).toContain('$ 4.900')
    expect(text()).toContain('$ 5.200')
    expect(text()).not.toMatch(/más barato/i)
    expect(text()).not.toMatch(/ahorr/i)
    expect(text()).not.toMatch(/%/)
    expect(text()).not.toContain('delta')
  })

  it('announces the fetch-in-flight status line while prices load', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockReturnValue(new Promise<ProductoResponse>(() => {}))

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toContain('Buscando precios…')
  })

  it('falls back to branch name, locality and numeric distance when fields are missing', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(
      responseFrom([
        {
          id: '9',
          sucursalNombre: 'Sucursal Sur',
          localidad: 'Río Gallegos',
          distanciaNumero: 2.5,
          precio: 1234,
        },
      ]),
    )

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toContain('Sucursal Sur')
    expect(rows()[0]).toContain('Río Gallegos')
    expect(rows()[0]).toContain('2,5 km')
    expect(rows()[0]).toContain('$ 1.234')
    // A product carried by exactly one branch in the city: the announcement must
    // agree in number instead of saying "1 sucursales".
    expect(liveText()).toBe('Encontramos 1 sucursal en Río Gallegos.')
    // The distance is spec-important content, so it rides on `text-secondary`;
    // the address stays a hint on `text-muted`. Scope to the row: the live
    // region also carries the locality now, so an unscoped `p` lookup would
    // match the announcement instead of the row.
    const distancia = Array.from(container.querySelectorAll('li p')).find((p) =>
      (p.textContent ?? '').includes('2,5 km'),
    )
    expect(distancia?.className).toContain('text-text-secondary')
    const direccion = Array.from(container.querySelectorAll('li p')).find((p) =>
      (p.textContent ?? '').includes('Río Gallegos'),
    )
    expect(direccion?.className).toContain('text-text-muted')
  })

  it('does not add the summary line when there are exactly 8 rows', async () => {
    const branches: BranchInput[] = Array.from({ length: 8 }, (_, i) => ({
      id: String(i + 1),
      banderaDescripcion: `Banner ${i + 1}`,
      precio: (i + 1) * 100,
    }))
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(responseFrom(branches))

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(rows()).toHaveLength(8)
    expect(text()).not.toContain('Mostrando las')
  })

  it('sin-precio: renders the exact copy and nothing else', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(
      responseFrom([{ id: '1', sucursalNombre: 'Una sucursal', precio: null }]),
    )

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(text()).toContain('No hay precio informado para este producto.')
    expect(buttons()).toHaveLength(0)
  })

  it('sin-datos: renders the exact calm copy with no error styling or retry', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(sinDatosResponse())

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(text()).toContain('Nadie informa este código.')
    expect(buttons()).toHaveLength(0)
    expect(container.innerHTML).not.toContain('danger')
  })

  it('data error: renders its line plus a working Reintentar', async () => {
    // The browser answers asynchronously, so the coords really clear between
    // attempts; that gap is what re-arms the gated fetch on a retry.
    let pending: SuccessCallback | null = null
    getCurrentPosition.mockImplementation((success: SuccessCallback) => {
      pending = success
    })
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockRejectedValue(new Error('boom'))

    await renderSection(client)
    await click(button('Ver precios cerca mío'))
    await act(async () => {
      pending?.(fakePosition())
    })
    await flush()

    expect(text()).toContain('No pudimos traer los precios ahora.')
    expect(fetchProducto).toHaveBeenCalledTimes(1)

    // Retry re-runs the gated fetch by asking for the location again.
    await click(button('Reintentar'))
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
    await act(async () => {
      pending?.(fakePosition())
    })
    await flush()
    expect(fetchProducto).toHaveBeenCalledTimes(2)
  })
})

describe('SucursalesSection — agrupación por cercanía', () => {
  /** Two near (Río Gallegos) and two far branches, cheapest-first overall. */
  function nearAndFar(): BranchInput[] {
    return [
      { id: 'f1', banderaDescripcion: 'Lejos A', localidad: 'Rio Grande', distanciaNumero: 300, precio: 100 },
      { id: 'f2', banderaDescripcion: 'Lejos B', localidad: 'Rada Tilly', distanciaNumero: 700, precio: 200 },
      { id: 'c1', banderaDescripcion: 'Cerca A', localidad: 'Rio Gallegos', distanciaNumero: 1, precio: 500 },
      { id: 'c2', banderaDescripcion: 'Cerca B', localidad: 'Rio Gallegos', distanciaNumero: 2, precio: 600 },
    ]
  }

  it('con grupo cercano: muestra los dos subtítulos, el cercano primero, en orden de DOM', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(responseFrom(nearAndFar()))

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent)
    expect(headings).toEqual(['En Rio Gallegos', 'Más baratas en otras ciudades'])

    // The far rows are cheaper, but the near group is rendered first: the section
    // is about closeness, and a price-first DOM order was the measured defect.
    const rendered = rows()
    expect(rendered).toHaveLength(4)
    expect(rendered[0]).toContain('Cerca A')
    expect(rendered[1]).toContain('Cerca B')
    expect(rendered[2]).toContain('Lejos A')
    expect(rendered[3]).toContain('Lejos B')

    // The sub-headings read on `text-secondary`, never the faint `text-muted`,
    // and the section heading stays the only h2.
    for (const heading of Array.from(container.querySelectorAll('h3'))) {
      expect(heading.className).toContain('text-text-secondary')
      expect(heading.className).not.toContain('text-text-muted')
    }
    expect(container.querySelectorAll('h2')).toHaveLength(1)
  })

  it('sin grupo cercano: línea honesta y una sola lista, sin reclamar ciudad', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(
      responseFrom([
        { id: 'f1', banderaDescripcion: 'Lejos A', localidad: 'Rio Grande', distanciaNumero: 300, precio: 100 },
        { id: 'f2', banderaDescripcion: 'Lejos B', localidad: 'Rada Tilly', distanciaNumero: 700, precio: 200 },
      ]),
    )

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(text()).toContain('No hay sucursales cerca tuyo.')
    expect(text()).toContain('Las más baratas')
    expect(text()).not.toContain('En Rio Grande')
    expect(container.querySelectorAll('ul')).toHaveLength(1)
    expect(container.querySelectorAll('h3')).toHaveLength(1)
    expect(rows()).toHaveLength(2)
  })

  it('el tope de 8 aplica por grupo: el cercano se corta con su resumen, el lejano no', async () => {
    const cerca: BranchInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i + 1}`,
      banderaDescripcion: `Cerca ${i + 1}`,
      localidad: 'Rio Gallegos',
      distanciaNumero: i + 1,
      precio: 500 + i,
    }))
    const lejos: BranchInput[] = [
      { id: 'f1', banderaDescripcion: 'Lejos 1', localidad: 'Rio Grande', distanciaNumero: 300, precio: 100 },
      { id: 'f2', banderaDescripcion: 'Lejos 2', localidad: 'Rada Tilly', distanciaNumero: 700, precio: 200 },
      { id: 'f3', banderaDescripcion: 'Lejos 3', localidad: 'Ushuaia', distanciaNumero: 900, precio: 300 },
    ]
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(responseFrom([...cerca, ...lejos]))

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    // 8 near (capped) + 3 far (uncapped, so no second summary).
    expect(rows()).toHaveLength(11)
    expect(text()).toContain('Mostrando las 8 más baratas de 10.')
    expect(text().match(/Mostrando las/g)).toHaveLength(1)
    expect(text()).toContain('Cerca 8')
    expect(text()).not.toContain('Cerca 9')
    expect(text()).toContain('Lejos 3')
  })

  it('el tope de 8 también resume un grupo lejano grande, de forma independiente', async () => {
    const cerca: BranchInput[] = [
      { id: 'c1', banderaDescripcion: 'Cerca 1', localidad: 'Rio Gallegos', distanciaNumero: 1, precio: 900 },
      { id: 'c2', banderaDescripcion: 'Cerca 2', localidad: 'Rio Gallegos', distanciaNumero: 2, precio: 901 },
    ]
    const lejos: BranchInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: `f${i + 1}`,
      banderaDescripcion: `Lejos ${i + 1}`,
      localidad: 'Rio Grande',
      distanciaNumero: 300 + i,
      precio: 100 + i,
    }))
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(responseFrom([...cerca, ...lejos]))

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    // Both groups show their own cap independently: 2 near rows (no summary) +
    // 8 far rows (with summary), never a single shared budget.
    expect(rows()).toHaveLength(10)
    expect(text().match(/Mostrando las/g)).toHaveLength(1)
    expect(text()).toContain('Mostrando las 8 más baratas de 10.')
    expect(text()).toContain('Cerca 2')
    expect(text()).toContain('Lejos 8')
    expect(text()).not.toContain('Lejos 9')
  })

  it('anuncio: nombra los dos grupos cuando hay grupo cercano', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(responseFrom(nearAndFar()))

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).toBe(
      'Encontramos 2 sucursales en Rio Gallegos y 2 más baratas en otras ciudades.',
    )
  })

  it('anuncio: omite la cláusula lejana cuando no hay otras ciudades', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(
      responseFrom([
        { id: 'c1', banderaDescripcion: 'Cerca A', localidad: 'Rio Gallegos', distanciaNumero: 1, precio: 500 },
        { id: 'c2', banderaDescripcion: 'Cerca B', localidad: 'Rio Gallegos', distanciaNumero: 2, precio: 600 },
      ]),
    )

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(liveText()).toBe('Encontramos 2 sucursales en Rio Gallegos.')
  })

  it('anuncio: sin grupo cercano cuenta cuántas quedan lejos', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(
      responseFrom([
        { id: 'f1', banderaDescripcion: 'Lejos A', localidad: 'Rio Grande', distanciaNumero: 300, precio: 100 },
        { id: 'f2', banderaDescripcion: 'Lejos B', localidad: 'Rada Tilly', distanciaNumero: 700, precio: 200 },
      ]),
    )

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).toBe('No hay sucursales cerca tuyo. Las 2 más baratas están lejos.')
  })

  it('anuncio: una sola sucursal lejana concuerda en singular', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(
      responseFrom([
        { id: 'f1', banderaDescripcion: 'Lejos A', localidad: 'Rio Grande', distanciaNumero: 300, precio: 100 },
      ]),
    )

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(rows()).toHaveLength(1)
    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).toContain('1 más barata')
    expect(liveText()).not.toContain('1 más baratas')
  })

  it('anuncio: un grupo cortado reporta el total y cuántas se muestran', async () => {
    // 10 far branches with real distances: the farness claim is valid, the group
    // is capped at 8, and the announcement must carry BOTH numbers.
    const branches: BranchInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i + 1),
      banderaDescripcion: `Lejos ${i + 1}`,
      localidad: 'Rio Grande',
      distanciaNumero: 300 + i,
      precio: (i + 1) * 100,
    }))
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(responseFrom(branches))

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(rows()).toHaveLength(8)
    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).toBe(
      'No hay sucursales cerca tuyo. Las 10 más baratas están lejos. Se muestran 8.',
    )
  })

  it('anuncio: no menciona tope cuando ningún grupo está cortado', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(responseFrom(nearAndFar()))

    await renderSection(client)
    await click(button('Ver precios cerca mío'))

    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).not.toContain('Se muestran')
    expect(liveText()).not.toContain('Mostrando')
  })
})

/**
 * The result must be announced, not just the in-flight step. The loading line
 * lives outside these states, so a live region that only wraps it would either
 * disappear or keep announcing stale text once the answer lands.
 */
describe('SucursalesSection live announcements', () => {
  it('idle: keeps one live region mounted with nothing to announce', async () => {
    const { client } = injectedClient()

    await renderSection(client)

    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).toBe('')
  })

  it('requesting: one live region announcing the in-flight location request', async () => {
    getCurrentPosition.mockImplementation(() => {
      /* pending */
    })
    const { client } = injectedClient()
    await renderSection(client)

    await click(button('Ver precios cerca mío'))

    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).toBe('Pidiendo tu ubicación…')
  })

  it('loading: one live region announcing the in-flight price fetch', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockReturnValue(new Promise<ProductoResponse>(() => {}))
    await renderSection(client)

    await click(button('Ver precios cerca mío'))

    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).toBe('Buscando precios…')
  })

  it('con-precios: sin datos de distancia no afirma lejanía y reporta total y visibles', async () => {
    // 10 branches, all with no locality and no distance: there is no near group
    // AND no distance at all, so the announcement reports the total (10) and the
    // capped count (8) but must never claim the branches are far.
    const branches: BranchInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i + 1),
      banderaDescripcion: `Banner ${i + 1}`,
      precio: (i + 1) * 100,
    }))
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(responseFrom(branches))
    await renderSection(client)

    await click(button('Ver precios cerca mío'))

    expect(rows()).toHaveLength(8)
    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).not.toContain('lejos')
    expect(liveText()).toContain('10')
    expect(liveText()).toContain('8')
    expect(liveText()).not.toContain('Buscando precios…')
  })

  it('sin-precio: announces the empty-price result, not the loading text', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(
      responseFrom([{ id: '1', sucursalNombre: 'Una sucursal', precio: null }]),
    )
    await renderSection(client)

    await click(button('Ver precios cerca mío'))

    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).toBe('No hay precio informado para este producto.')
    expect(liveText()).not.toContain('Buscando precios…')
  })

  it('sin-datos: announces the unknown-code result, not the loading text', async () => {
    succeed()
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockResolvedValue(sinDatosResponse())
    await renderSection(client)

    await click(button('Ver precios cerca mío'))

    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).toBe('Nadie informa este código.')
    expect(liveText()).not.toContain('Buscando precios…')
  })

  it('data error: announces the failure line, not the loading text', async () => {
    let pending: SuccessCallback | null = null
    getCurrentPosition.mockImplementation((success: SuccessCallback) => {
      pending = success
    })
    const { client, fetchProducto } = injectedClient()
    fetchProducto.mockRejectedValue(new Error('boom'))
    await renderSection(client)

    await click(button('Ver precios cerca mío'))
    await act(async () => {
      pending?.(fakePosition())
    })
    await flush()

    expect(liveRegions()).toHaveLength(1)
    expect(liveText()).toBe('No pudimos traer los precios ahora.')
    expect(liveText()).not.toContain('Buscando precios…')
  })
})
