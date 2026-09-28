import { describe, expect, it } from 'vitest'
import {
  FIREBASE_NOT_CONFIGURED,
  defaultListName,
  describeFirestoreError,
  formatSavedDate,
  fromDocument,
  toDocument,
} from './firestoreLists'
import type { ListaItem } from './lupa/list'

/*
 * The mapper is the part of FR-12 that can be tested in plain Node: the Firestore
 * calls need a session and a network, the mapping does not. And the mapping is where
 * data actually gets lost — a dropped key or a dropped entry never shows up as an
 * error, it shows up as a saved list that is quietly missing something.
 */

const item: ListaItem = {
  ean: '7793940219009',
  cantidad: 2,
  alerta: true,
  nombre: 'Leche entera 1L',
  productoId: 'ffcf4bfd-e46c-4e07-8375-af92f452aeb2',
}

describe('toDocument', () => {
  it('carries the name and the items through unchanged', () => {
    const doc = toDocument('Compra del sábado', [item])
    expect(doc.nombre).toBe('Compra del sábado')
    expect(doc.items).toEqual([item])
  })

  /*
   * Firestore rejects `undefined` field values outright, and `nombre`/`productoId` are
   * optional on ListaItem — so an item copied straight from the working list would fail
   * the write. Asserted on the keys rather than with toEqual, because a key that is
   * present and undefined compares equal to one that is absent: deep equality would
   * pass while the write still failed.
   */
  it('omits optional keys that are undefined instead of writing undefined', () => {
    const bare: ListaItem = { ean: '7793940219009', cantidad: 1, alerta: false }
    const [written] = toDocument('Sin nombre', [bare]).items
    expect(Object.keys(written).sort()).toEqual(['alerta', 'cantidad', 'ean'])
    expect('nombre' in written).toBe(false)
    expect('productoId' in written).toBe(false)
  })

  it('keeps an optional key that does carry a value', () => {
    const [written] = toDocument('Con nombre', [item]).items
    expect(Object.keys(written).sort()).toEqual([
      'alerta',
      'cantidad',
      'ean',
      'nombre',
      'productoId',
    ])
  })

  it('does not mutate the list it was handed', () => {
    const original: ListaItem = { ean: '7793940219009', cantidad: 1, alerta: false }
    toDocument('x', [original])
    expect(Object.keys(original).sort()).toEqual(['alerta', 'cantidad', 'ean'])
  })
})

describe('fromDocument', () => {
  it('reads back every field, including the optional ones', () => {
    const doc = fromDocument('abc', {
      nombre: 'Compra del sábado',
      creada: { seconds: 1758500000, nanoseconds: 0 },
      items: [item],
    })
    expect(doc.id).toBe('abc')
    expect(doc.nombre).toBe('Compra del sábado')
    expect(doc.creada).toBe(new Date(1758500000 * 1000).toISOString())
    expect(doc.items).toEqual([item])
  })

  it('accepts the Timestamp instance shape, which exposes toDate()', () => {
    const date = new Date('2026-09-19T12:00:00.000Z')
    const doc = fromDocument('abc', { nombre: 'x', creada: { toDate: () => date }, items: [] })
    expect(doc.creada).toBe(date.toISOString())
  })

  /*
   * A saved list is a historical snapshot, so an EAN that no longer resolves in the
   * catalog is expected rather than exceptional (FR-12.6). Dropping it here is exactly
   * what would make a list look like it lost products.
   */
  it('keeps an entry whose EAN resolves in no catalog (FR-12.6)', () => {
    const ghost: ListaItem = { ean: '0000000000000', cantidad: 1, alerta: false }
    const doc = fromDocument('abc', { nombre: 'x', creada: null, items: [ghost] })
    expect(doc.items).toEqual([ghost])
  })

  /*
   * The wire is not trusted, for the same reason `useList` re-validates localStorage:
   * a malformed document must degrade, never throw the page away.
   */
  it('does not throw on a missing, malformed or non-array items field', () => {
    const cases: unknown[] = [
      undefined,
      null,
      {},
      { items: 'nope' },
      { items: 42 },
      { items: [null, 42, 'x', {}, { ean: 1 }, { ean: 'a' }, { ean: 'a', cantidad: '2' }] },
    ]
    for (const data of cases) {
      expect(() => fromDocument('a', data)).not.toThrow()
      expect(fromDocument('a', data).items).toEqual([])
    }
  })

  it('keeps the valid entries and drops only the malformed ones', () => {
    const doc = fromDocument('a', {
      items: [null, { ean: '7793940219009', cantidad: 2, alerta: true }, { ean: 'x' }],
    })
    expect(doc.items).toEqual([{ ean: '7793940219009', cantidad: 2, alerta: true }])
  })

  it('degrades a missing or unusable name and date instead of leaving them undefined', () => {
    const doc = fromDocument('abc', {})
    expect(doc).toEqual({ id: 'abc', nombre: '', creada: '', items: [] })
  })

  it('never returns an unparseable creada', () => {
    for (const creada of [null, 42, 'no soy una fecha', {}, { seconds: 'x' }, []]) {
      expect(fromDocument('a', { creada }).creada).toBe('')
    }
  })

  it('accepts an ISO string that is already in the boundary shape', () => {
    const iso = '2026-09-19T12:00:00.000Z'
    expect(fromDocument('a', { creada: iso }).creada).toBe(iso)
  })
})

/*
 * FR-12.9: an unreachable backend and an empty account are different facts, so the
 * message for a failure must be a real message and not a generic shrug.
 */
describe('describeFirestoreError', () => {
  it('names the missing-config case, which is the normal case in CI', () => {
    expect(describeFirestoreError(new Error(FIREBASE_NOT_CONFIGURED))).toBe(
      'Este build no tiene Firebase configurado.',
    )
  })

  it('distinguishes the SDK error codes a user can actually hit', () => {
    const denied = describeFirestoreError({ code: 'permission-denied' })
    const offline = describeFirestoreError({ code: 'unavailable' })
    expect(denied).not.toBe(offline)
    expect(denied).toMatch(/permiso/i)
    expect(offline).toMatch(/conexión/i)
  })

  /*
   * A project where Firestore was never provisioned answers NOT_FOUND for the database, and
   * the SDK's own console warning says so. Falling through to the generic message would send
   * the reader looking for an application bug that does not exist.
   */
  it('names the missing-database case as a provisioning step', () => {
    const missing = describeFirestoreError({ code: 'not-found' })
    expect(missing).toMatch(/base de datos/i)
    expect(missing).not.toBe('No se pudieron leer las listas guardadas.')
  })

  it('falls back to something honest for an unknown failure', () => {
    for (const err of [undefined, null, 'boom', {}, { code: 'weird/internal' }]) {
      expect(describeFirestoreError(err)).toBe('No se pudieron leer las listas guardadas.')
    }
  })
})

describe('defaultListName', () => {
  it('derives a readable name from the local date', () => {
    expect(defaultListName(new Date(2026, 8, 19))).toBe('Lista del 19/09/2026')
    expect(defaultListName(new Date(2026, 0, 5))).toBe('Lista del 05/01/2026')
  })
})

describe('formatSavedDate', () => {
  it('renders an ISO date the way the rest of the app renders dates', () => {
    expect(formatSavedDate('2026-09-19T12:00:00.000Z')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })

  it('returns nothing at all when the stored date is unusable', () => {
    for (const iso of ['', 'no soy una fecha']) {
      expect(formatSavedDate(iso)).toBe('')
    }
  })
})
