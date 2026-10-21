// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement, Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import CambiosPage, { dayLabel } from './CambiosPage'
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

/**
 * A local-time instant, never a UTC string: "today" is what the reader's own calendar
 * says, so a local constructor keeps every label assertion true in any timezone.
 */
const CLOCK = () => new Date(2026, 9, 21, 12, 0, 0)

async function render(
  loader: () => Promise<ChangesLoadResult>,
  now: () => Date = CLOCK,
): Promise<void> {
  mounted = true
  await act(async () => {
    root.render(
      createElement(
        Fragment,
        null,
        createElement(
          MemoryRouter,
          null,
          createElement(CambiosPage, { loadFn: loader, now }),
        ),
        // The confirmation is a real toast with a real action, so the harness mounts the same
        // Toaster the app mounts: asserting a `toast()` call never happened would be a guess.
        createElement(Toaster),
      ),
    )
  })
  await flush()
}

async function click(el: HTMLButtonElement): Promise<void> {
  await act(async () => {
    el.click()
  })
  await flush()
}

/** Toasts live in a portal on `document.body` and mount on a timer, so they need a real settle. */
async function settle(ms = 10): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
  await flush()
}

async function waitForToastButton(label: string): Promise<HTMLButtonElement | null> {
  for (let i = 0; i < 40; i += 1) {
    const found = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label,
    )
    if (found) return found as HTMLButtonElement
    await settle()
  }
  return null
}

function nav(direction: 'prev' | 'next'): HTMLButtonElement {
  const el = container.querySelector(`[data-changes-nav="${direction}"]`)
  if (!(el instanceof HTMLButtonElement)) throw new Error(`no ${direction} button`)
  return el
}

function label(): string {
  return container.querySelector('[data-changes-label]')?.textContent ?? ''
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
  // The list is real localStorage state: a leftover item would make the add tests pass on
  // their own garbage, and `document.body` keeps the portal a previous test left behind.
  localStorage.clear()
  document.body.innerHTML = ''
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
  it('opens on the newest day even when the artifact does not order them', async () => {
    const older = day('2026-10-14', { bajaron: { conteo: 0, truncado: false, valores: [] } })
    const newer = day('2026-10-15')
    await render(async () => ({
      status: 'ready',
      source: 'network',
      artifact: artifact({ dias: [older, newer] }),
    }))

    expect(days()).toEqual(['2026-10-15'])
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

})

// ---------------------------------------------------------------------------
// Day selector: one day at a time, honest labels, honest gaps
// ---------------------------------------------------------------------------

describe('CambiosPage day selector', () => {
  /** A day whose only row names its own date, so a leak from another day is visible. */
  const conMarca = (fecha: string): ChangeDay =>
    day(fecha, {
      bajaron: moves([
        { ean: '111111', nombre: `BAJO ${fecha}`, antes: 100, ahora: 90, pct: -10 },
      ]),
      subieron: moves([]),
      nuevos: nuevos([]),
    })

  const tresDias = (): ChangesArtifact =>
    artifact({
      generado: '2026-10-21T12:30:00Z',
      dias: [conMarca('2026-10-21'), conMarca('2026-10-20'), conMarca('2026-10-19')],
    })

  const load = (a: ChangesArtifact) => async (): Promise<ChangesLoadResult> => ({
    status: 'ready',
    source: 'network',
    artifact: a,
  })

  it('opens on the newest day and renders no other day at all', async () => {
    await render(load(tresDias()))

    expect(days()).toEqual(['2026-10-21'])
    expect(text()).toContain('BAJO 2026-10-21')
    expect(text()).not.toContain('BAJO 2026-10-20')
    expect(text()).not.toContain('BAJO 2026-10-19')
  })

  it('says "hoy" only when the newest day is really today', async () => {
    await render(load(tresDias()))

    expect(label()).toBe('Hoy')
  })

  it('says "ayer" when the newest day really is yesterday, and names the date', async () => {
    // The pipeline runs a few hours late, so the newest day is often yesterday. Calling that
    // "hoy" would be the same defect the repo killed in the placeholder copy: a screen
    // asserting something the data does not support.
    await render(load(artifact({ dias: [conMarca('2026-10-20'), conMarca('2026-10-19')] })))

    expect(label()).toBe('Ayer, 20 de octubre')
  })

  it('never calls an older day "hoy" or "ayer"', async () => {
    await render(load(artifact({ dias: [conMarca('2026-10-18')] })))

    expect(label()).toContain('18 de octubre')
    expect(label()).not.toBe('Hoy')
    expect(label()).not.toMatch(/ayer/i)
  })

  it('steps exactly one calendar day per arrow, forward and back', async () => {
    await render(load(tresDias()))

    await click(nav('prev'))
    expect(days()).toEqual(['2026-10-20'])
    expect(label()).toBe('Ayer, 20 de octubre')

    await click(nav('prev'))
    expect(days()).toEqual(['2026-10-19'])
    expect(label()).toContain('19 de octubre')

    await click(nav('next'))
    expect(days()).toEqual(['2026-10-20'])
  })

  it('stops at both ends of the artifact instead of wrapping or inventing a day', async () => {
    await render(load(tresDias()))

    // The newest day is the end of the range: there is nothing newer to show.
    expect(nav('next').disabled).toBe(true)
    expect(nav('prev').disabled).toBe(false)

    await click(nav('prev'))
    await click(nav('prev'))
    expect(days()).toEqual(['2026-10-19'])

    // The oldest day the artifact carries is the other end: stepping past it would mean
    // claiming something about a day this build has no data for.
    expect(nav('prev').disabled).toBe(true)
    expect(nav('next').disabled).toBe(false)
  })

  it('says a gap day has no data instead of showing it as a day without changes', async () => {
    // 2026-10-16 is inside the range and missing from the artifact: a day the pipeline did
    // not publish. That is NOT the same truth as a published day with zero movements.
    await render(load(artifact({ dias: [conMarca('2026-10-17'), conMarca('2026-10-15')] })))

    await click(nav('prev'))
    expect(days()).toEqual(['2026-10-16'])
    expect(rows()).toHaveLength(0)
    expect(text()).toContain('No hay datos de este día')
    expect(text()).not.toContain('Sin cambios este día')

    // The range keeps going across the gap: the day before it still has data.
    await click(nav('prev'))
    expect(days()).toEqual(['2026-10-15'])
    expect(text()).toContain('BAJO 2026-10-15')
  })

  it('shows when the artifact was generated, in the reader’s own clock', async () => {
    const generado = '2026-10-20T12:32:55Z'
    // Built from the same instant, so the assertion holds in any timezone.
    const dia = new Date(generado).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'long',
    })
    await render(load(artifact({ generado, dias: [conMarca('2026-10-20')] })))

    expect(text()).toMatch(/última actualización/i)
    expect(text()).toContain(dia)
    expect(text()).toMatch(/\d{1,2}:\d{2}/)
  })

  it('names an unreadable update moment instead of printing it raw', async () => {
    await render(load(artifact({ generado: 'no-es-una-fecha' })))

    expect(state()).toBe('ready')
    // Silence would read as "there is no age to show"; the screen says the age is unreadable,
    // and never repeats the value it could not understand.
    expect(text()).toMatch(/última actualización/i)
    expect(text()).toContain('sin fecha legible')
    expect(text()).not.toContain('no-es-una-fecha')
  })
})

// ---------------------------------------------------------------------------
// The label is its own law: it is what keeps the screen from asserting a false date
// ---------------------------------------------------------------------------

describe('dayLabel', () => {
  const ahora = new Date(2026, 9, 21, 12, 0, 0)

  it('calls the reader\'s own calendar day "hoy"', () => {
    expect(dayLabel('2026-10-21', ahora)).toBe('Hoy')
  })

  it('calls the day before it "ayer" and still names the date', () => {
    expect(dayLabel('2026-10-20', ahora)).toBe('Ayer, 20 de octubre')
  })

  it('names any older day by its own date', () => {
    expect(dayLabel('2026-10-18', ahora)).toContain('18 de octubre')
  })

  it('never calls a future day "hoy", even one day ahead', () => {
    const etiqueta = dayLabel('2026-10-22', ahora)
    expect(etiqueta).not.toBe('Hoy')
    expect(etiqueta).toContain('22 de octubre')
  })

  it('survives a month boundary: the 1st of a month has a "yesterday" in the previous one', () => {
    expect(dayLabel('2026-09-30', new Date(2026, 9, 1, 0, 30, 0))).toBe('Ayer, 30 de septiembre')
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

// ---------------------------------------------------------------------------
// Add to list: the same shopping list the detail screen writes to
// ---------------------------------------------------------------------------

/**
 * The list is the app's own (localStorage under `precio-scanner:lupa:lista`), so these tests read
 * the exact bytes the rest of the app reads, not a stub: adding from the feed and adding from the
 * product detail have to be the same operation or the two screens disagree about the same list.
 */
function storedList(): Array<{ ean: string; cantidad: number; nombre?: string }> {
  const raw = localStorage.getItem('precio-scanner:lupa:lista')
  return raw === null ? [] : (JSON.parse(raw) as Array<{ ean: string; cantidad: number; nombre?: string }>)
}

function addButtonFor(nombre: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll('button'))
  return (
    (buttons.find((b) => (b.getAttribute('aria-label') ?? '').includes(nombre)) as
      | HTMLButtonElement
      | undefined) ?? null
  )
}

describe('CambiosPage add to list', () => {
  it('offers a 44px add button on a row whose EAN is usable, and none on a row without one', async () => {
    // READY carries one `bajaron` with an EAN and one `subieron` with `ean: null`.
    await render(async () => READY)

    const conEan = container.querySelector('[data-changes-row="bajaron"]')
    const sinEan = container.querySelector('[data-changes-row="subieron"]')
    const boton = conEan?.querySelector('button')

    expect(boton).toBeTruthy()
    expect(boton?.getAttribute('aria-label')).toMatch(/agregar.+a (mi|tu) lista/i)
    expect(boton?.className).toContain('h-11')
    // No identity, no action: the row still shows what it knows, and nothing pretends otherwise.
    expect(sinEan?.querySelector('button')).toBeNull()
  })

  it('keeps the product link usable: the add button lives outside the anchor, never inside it', async () => {
    await render(async () => READY)

    const row = container.querySelector('[data-changes-row="bajaron"]')
    const link = row?.querySelector('a')
    const boton = row?.querySelector('button')

    expect(link?.getAttribute('href')).toBe('/producto/7790895000430')
    // A button inside an anchor is invalid HTML and a tap target nobody can predict.
    expect(link?.querySelector('button')).toBeNull()
    expect(boton?.contains(link ?? null)).toBe(false)
  })

  it('pressing it saves the product in the shopping list, with its name and quantity 1', async () => {
    await render(async () => READY)

    await click(addButtonFor('YERBA MATE') as HTMLButtonElement)

    expect(storedList()).toEqual([
      { ean: '7790895000430', cantidad: 1, alerta: false, nombre: 'YERBA MATE' },
    ])
  })

  it('pressing it again increments the quantity instead of duplicating the row', async () => {
    await render(async () => READY)

    await click(addButtonFor('YERBA MATE') as HTMLButtonElement)
    await click(addButtonFor('YERBA MATE') as HTMLButtonElement)

    expect(storedList()).toHaveLength(1)
    expect(storedList()[0].cantidad).toBe(2)
  })

  it('a newly added item can be undone from the confirmation', async () => {
    await render(async () => READY)

    await click(addButtonFor('YERBA MATE') as HTMLButtonElement)
    const deshacer = await waitForToastButton('Deshacer')
    expect(deshacer).toBeTruthy()
    await click(deshacer as HTMLButtonElement)

    expect(storedList()).toEqual([])
  })

  it('undoing an increment puts the previous quantity back instead of dropping the item', async () => {
    await render(async () => READY)

    await click(addButtonFor('YERBA MATE') as HTMLButtonElement)
    await click(addButtonFor('YERBA MATE') as HTMLButtonElement)
    const deshacer = await waitForToastButton('Deshacer')
    await click(deshacer as HTMLButtonElement)

    expect(storedList()).toHaveLength(1)
    expect(storedList()[0].cantidad).toBe(1)
  })
})
