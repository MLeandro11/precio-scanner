// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import CambiosPage from './CambiosPage'
import type {
  BoundedList,
  ChangeDay,
  ChangesArtifact,
  ChangesLoadResult,
  NewProduct,
  PriceMove,
} from '../lib/catalogChanges'

/**
 * The screen is tested through its public DOM, never its internals. There is no
 * `@testing-library/react` in this repo: the harness is `createRoot` + `act`,
 * exactly like `SucursalesSection.test.tsx`.
 *
 * The loader is injected (`loadFn`), so no network is ever touched and every one
 * of the honest states is reached deterministically. The stable `data-*` hooks
 * the acceptance harness will key on are asserted here, because the parent will
 * write contract-driven rows against them:
 *   - `data-changes-state` on the container: loading | ready | cached | absent |
 *     invalid | offline | error
 *   - `data-changes-day="YYYY-MM-DD"` per day
 *   - `data-changes-section="bajaron|subieron|nuevos"` (+ `data-changes-count`,
 *     `data-changes-truncated`)
 *   - `data-changes-row="bajaron|subieron|nuevos"` (+ `data-ean` when usable)
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function nuevos(items: NewProduct[]): BoundedList<NewProduct> {
  return { conteo: items.length, truncado: false, valores: items }
}

function moves(items: PriceMove[], overrides: Partial<BoundedList<PriceMove>> = {}): BoundedList<PriceMove> {
  return { conteo: items.length, truncado: false, valores: items, ...overrides }
}

function day(fecha: string, overrides: Partial<ChangeDay> = {}): ChangeDay {
  return {
    fecha,
    nuevos: nuevos([
      { ean: '7798479600021', nombre: 'ALFAJOR DAMAS GRATIS 80G', precio: 3450 },
    ]),
    bajaron: moves([
      { ean: '7790895000430', nombre: 'YERBA MATE', antes: 1290, ahora: 1150, pct: -10.85 },
    ]),
    subieron: moves([
      { ean: null, nombre: 'GASEOSA COLA', antes: 240, ahora: 2900, pct: 1108.33 },
    ]),
    ...overrides,
  }
}

function artifact(overrides: Partial<ChangesArtifact> = {}): ChangesArtifact {
  return {
    version: 1,
    ventanaDias: 7,
    generado: '2026-10-15T12:28:27Z',
    dias: [day('2026-10-15')],
    ...overrides,
  }
}

const READY: ChangesLoadResult = { status: 'ready', source: 'network', artifact: artifact() }

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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

async function render(loader: () => Promise<ChangesLoadResult>): Promise<void> {
  mounted = true
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(CambiosPage, { loadFn: loader }),
      ),
    )
  })
  await flush()
}

function text(): string {
  return container.textContent ?? ''
}

function state(): string {
  return container.querySelector('[data-changes-state]')?.getAttribute('data-changes-state') ?? ''
}

function days(): string[] {
  return Array.from(container.querySelectorAll('[data-changes-day]')).map(
    (el) => el.getAttribute('data-changes-day') ?? '',
  )
}

function dayEls(): Element[] {
  return Array.from(container.querySelectorAll('[data-changes-day]'))
}

function sections(scope: ParentNode = container): string[] {
  return Array.from(scope.querySelectorAll('[data-changes-section]')).map(
    (el) => el.getAttribute('data-changes-section') ?? '',
  )
}

function rows(scope: ParentNode = container): Element[] {
  return Array.from(scope.querySelectorAll('[data-changes-row]'))
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}

beforeEach(() => {
  mounted = false
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
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
  container.remove()
})

// ---------------------------------------------------------------------------
// States (S5)
// ---------------------------------------------------------------------------

describe('CambiosPage honest states', () => {
  it('loading: shows a status and the screen title, never a bare spinner as the end state', async () => {
    await render(() => new Promise<ChangesLoadResult>(() => {}))

    expect(state()).toBe('loading')
    expect(container.querySelector('h2')?.textContent).toContain('Qué cambió')
    expect(text()).toContain('Cargando cambios')
    expect(rows()).toHaveLength(0)
  })

  it('ready: renders the day feed from the artifact', async () => {
    await render(async () => READY)

    expect(state()).toBe('ready')
    expect(days()).toEqual(['2026-10-15'])
    expect(rows().length).toBeGreaterThan(0)
  })

  it('a real move too small to show at two decimals never reads as 0 %', async () => {
    // 2.123.750 -> 2.123.749 is -0,00005 %: a real move that rounds to zero at two decimals.
    // Printing "0 %" next to a down arrow would assert that nothing happened while showing that
    // it did — the failure the rest of the app avoids by never presenting absence as data.
    await render(async () => ({
      status: 'ready',
      source: 'network',
      artifact: artifact({
        dias: [
          day('2026-10-15', {
            bajaron: moves([
              { ean: '7790895000430', nombre: 'CARO', antes: 2_123_750, ahora: 2_123_749, pct: -0.00005 },
            ]),
          }),
        ],
      }),
    }))

    const row = rows().find((r) => (r.textContent ?? '').includes('CARO'))
    expect(row).toBeTruthy()
    expect(row?.textContent).toContain('<0,01 %')
    expect(row?.textContent).not.toContain('+0 %')
    expect(row?.textContent).not.toContain('-0 %')
  })

  it('absent: says the pipeline has not published it, and blames nobody', async () => {
    await render(async () => ({ status: 'absent' }))

    expect(state()).toBe('absent')
    expect(text()).toContain('Todavía no hay cambios publicados')
    expect(rows()).toHaveLength(0)
    // Nothing the user did or can retry: no action button, and no fake data.
    expect(buttons()).toHaveLength(0)
  })

  it('invalid: says the screen cannot read the artifact, and renders no rows', async () => {
    await render(async () => ({ status: 'invalid' }))

    expect(state()).toBe('invalid')
    expect(text()).toMatch(/no pudimos leer/i)
    expect(rows()).toHaveLength(0)
  })

  it('cached: shows the offline notice and still renders the last known copy', async () => {
    await render(async () => ({ status: 'ready', source: 'cache', artifact: artifact() }))

    expect(state()).toBe('cached')
    expect(text()).toMatch(/sin conexión/i)
    expect(days()).toEqual(['2026-10-15'])
    expect(rows().length).toBeGreaterThan(0)
  })

  it('offline: says there is no connection and no copy, with a retry', async () => {
    await render(async () => ({ status: 'offline' }))

    expect(state()).toBe('offline')
    expect(text()).toMatch(/sin conexión|no hay conexión/i)
    expect(rows()).toHaveLength(0)
    expect(buttons().length).toBeGreaterThan(0)
  })

  it('error: says the load failed and offers a retry', async () => {
    await render(async () => ({ status: 'error' }))

    expect(state()).toBe('error')
    expect(text()).toMatch(/no pudimos traer/i)
    expect(buttons().length).toBeGreaterThan(0)
  })

  it('retrying a failed load can reach the ready state', async () => {
    let attempt = 0
    const loader = async (): Promise<ChangesLoadResult> => {
      attempt += 1
      return attempt === 1 ? { status: 'error' } : READY
    }
    await render(loader)
    expect(state()).toBe('error')

    await act(async () => {
      buttons()[0].click()
    })
    await flush()

    expect(state()).toBe('ready')
    expect(days()).toEqual(['2026-10-15'])
  })
})

// ---------------------------------------------------------------------------
// Layout: day and section order (frozen contract)
// ---------------------------------------------------------------------------

describe('CambiosPage ordering', () => {
  it('orders days newest first even when the artifact does not', async () => {
    const older = day('2026-10-14', { bajaron: { conteo: 0, truncado: false, valores: [] } })
    const newer = day('2026-10-15')
    await render(async () => ({
      status: 'ready',
      source: 'network',
      artifact: artifact({ dias: [older, newer] }),
    }))

    expect(days()).toEqual(['2026-10-15', '2026-10-14'])
  })

  it('orders the sections inside a day bajaron -> subieron -> nuevos', async () => {
    await render(async () => READY)

    expect(sections(dayEls()[0])).toEqual(['bajaron', 'subieron', 'nuevos'])
  })

  it('keeps the artifact order inside each section (biggest move first)', async () => {
    const bajaron = moves([
      { ean: '111111', nombre: 'PRIMERO', antes: 100, ahora: 50, pct: -50 },
      { ean: '222222', nombre: 'SEGUNDO', antes: 100, ahora: 90, pct: -10 },
    ])
    await render(async () => ({
      status: 'ready',
      source: 'network',
      artifact: artifact({ dias: [day('2026-10-15', { bajaron })] }),
    }))

    const names = rows().map((li) => li.textContent ?? '')
    expect(names[0]).toContain('PRIMERO')
    expect(names[1]).toContain('SEGUNDO')
  })

  it('shows each day date when the window has more than one day', async () => {
    await render(async () => ({
      status: 'ready',
      source: 'network',
      artifact: artifact({
        ventanaDias: 7,
        dias: [day('2026-10-15'), day('2026-10-14')],
      }),
    }))

    expect(dayEls()[0].querySelector('h3')?.textContent).toContain('15 de octubre')
    expect(dayEls()[1].querySelector('h3')?.textContent).toContain('14 de octubre')
  })

  it('does not repeat the date on every day when the window is a single day', async () => {
    await render(async () => READY)

    expect(dayEls()).toHaveLength(1)
    expect(dayEls()[0].querySelector('h3')).toBeNull()
  })

  it('summarises the window from ventanaDias, never a hardcoded 7', async () => {
    await render(async () => ({
      status: 'ready',
      source: 'network',
      artifact: artifact({ ventanaDias: 3, dias: [day('2026-10-15')] }),
    }))

    expect(text()).toContain('últimos 3 días')
    expect(text()).not.toContain('últimos 7 días')
  })
})

// ---------------------------------------------------------------------------
// Sections: exact counts and the truncated message
// ---------------------------------------------------------------------------

describe('CambiosPage sections', () => {
  it('states the exact count and says out loud when a list is capped', async () => {
    const subieron = moves(
      [
        { ean: null, nombre: 'GASEOSA COLA', antes: 240, ahora: 2900, pct: 1108.33 },
        { ean: null, nombre: 'AGUA', antes: 100, ahora: 300, pct: 200 },
      ],
      { conteo: 121, truncado: true },
    )
    await render(async () => ({
      status: 'ready',
      source: 'network',
      artifact: artifact({ dias: [day('2026-10-15', { subieron })] }),
    }))

    const section = container.querySelector('[data-changes-section="subieron"]')
    expect(section?.getAttribute('data-changes-count')).toBe('121')
    expect(section?.getAttribute('data-changes-truncated')).toBe('true')
    expect(section?.textContent).toContain('121')
    expect(section?.textContent).toMatch(/se muestran/i)
    expect(section?.querySelectorAll('[data-changes-row]')).toHaveLength(2)
  })

  it('does not claim to be capped when the list is complete', async () => {
    await render(async () => READY)

    const section = container.querySelector('[data-changes-section="bajaron"]')
    expect(section?.getAttribute('data-changes-truncated')).toBe('false')
    expect(section?.textContent).not.toMatch(/se muestran/i)
  })

  it('renders a day with no changes honestly instead of an empty list', async () => {
    const empty = day('2026-10-15', {
      bajaron: { conteo: 0, truncado: false, valores: [] },
      subieron: moves([]),
      nuevos: nuevos([]),
    })
    await render(async () => ({
      status: 'ready',
      source: 'network',
      artifact: artifact({ dias: [empty] }),
    }))

    expect(rows()).toHaveLength(0)
    expect(text()).toMatch(/sin cambios/i)
  })
})

// ---------------------------------------------------------------------------
// Rows: links, prices, no invented identity (R5) and no warning (S7)
// ---------------------------------------------------------------------------

describe('CambiosPage rows', () => {
  it('links a row to /producto/<ean> only when the ean is not null', async () => {
    await render(async () => READY)

    const bajaron = container.querySelector('[data-changes-row="bajaron"]')
    const link = bajaron?.querySelector('a')
    expect(bajaron?.getAttribute('data-ean')).toBe('7790895000430')
    expect(link?.getAttribute('href')).toBe('/producto/7790895000430')

    const subieron = container.querySelector('[data-changes-row="subieron"]')
    expect(subieron?.getAttribute('data-ean')).toBeNull()
    expect(subieron?.querySelector('a')).toBeNull()
    // The name is still shown: identity is the EAN, the name is data (R5).
    expect(subieron?.textContent).toContain('GASEOSA COLA')
  })

  it('does not link a row whose ean is too short to be a real code (the >=6 cut)', async () => {
    const bajaron = moves([
      { ean: '12345', nombre: 'CODIGO CORTO', antes: 100, ahora: 90, pct: -10 },
    ])
    await render(async () => ({
      status: 'ready',
      source: 'network',
      artifact: artifact({ dias: [day('2026-10-15', { bajaron })] }),
    }))

    const row = container.querySelector('[data-changes-row="bajaron"]')
    expect(row?.textContent).toContain('CODIGO CORTO')
    expect(row?.querySelector('a')).toBeNull()
  })

  it('shows antes -> ahora and the signed pct', async () => {
    await render(async () => READY)

    const row = container.querySelector('[data-changes-row="bajaron"]')
    expect(row?.textContent).toContain('$ 1.290')
    expect(row?.textContent).toContain('$ 1.150')
    expect(row?.textContent).toContain('-10,85')
    expect(row?.textContent).toContain('%')
  })

  it('shows a new product price with no before value', async () => {
    await render(async () => READY)

    const row = container.querySelector('[data-changes-row="nuevos"]')
    expect(row?.textContent).toContain('$ 3.450')
    expect(row?.textContent).not.toContain('→')
  })

  it('renders a huge change with no mark, no filter and no warning (S7)', async () => {
    await render(async () => READY)

    // 1108.33% is in the fixture. The repo's own R7 investigation concluded these
    // are real POS corrections, so the UI must not editorialize about them.
    expect(text()).toContain('1108,33')
    expect(text()).not.toMatch(/sospech|revisar|verificar|posible error|raro/i)
    expect(container.querySelector('[data-changes-warning]')).toBeNull()
  })

  it('never groups or deduplicates by name (R5): two same-name rows both render', async () => {
    const bajaron = moves([
      { ean: '111111', nombre: 'MISMO NOMBRE', antes: 100, ahora: 90, pct: -10 },
      { ean: '222222', nombre: 'MISMO NOMBRE', antes: 200, ahora: 180, pct: -10 },
    ])
    await render(async () => ({
      status: 'ready',
      source: 'network',
      artifact: artifact({ dias: [day('2026-10-15', { bajaron })] }),
    }))

    const sameName = rows().filter((li) => (li.textContent ?? '').includes('MISMO NOMBRE'))
    expect(sameName).toHaveLength(2)
    expect(sameName[0].querySelector('a')?.getAttribute('href')).toBe('/producto/111111')
    expect(sameName[1].querySelector('a')?.getAttribute('href')).toBe('/producto/222222')
  })
})
