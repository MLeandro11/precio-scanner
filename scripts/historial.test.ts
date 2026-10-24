import { describe, expect, it } from 'vitest'
import { buildHistorialArtifact, parseHistorialArtifact } from './historial'
import type { HistorialArtifact } from './historial'

/**
 * El log acumulativo: es lo único que hace posible el historial sin publicar los
 * snapshots. Cada regla de acá, si se rompe, produce un historial que miente
 * (puntos inventados) o que pierde días para siempre.
 */

const prod = (ean: string, precio: number) => ({
  id: ean,
  barcode: ean,
  nombre: `P ${ean}`,
  marca: '',
  categoria: 'Bebidas',
  precio,
})

const vacio = { ok: false as const, reason: 'missing' }

function previo(artifact: HistorialArtifact) {
  return { ok: true as const, artifact }
}

describe('buildHistorialArtifact', () => {
  it('records one point per EAN whose price changed, and nothing for the ones that did not', () => {
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: [prod('111', 100), prod('222', 200)],
      current: [prod('111', 120), prod('222', 200)],
      previousArtifact: vacio,
    })

    expect(r.artifact.dias[0]).toEqual({ fecha: '2026-10-24', cambios: [{ ean: '111', precio: 120 }] })
  })

  it('keeps one row per EAN when the catalog carries the same code twice', () => {
    // El catálogo real trae EANs repetidos (el mismo código en dos registros con
    // distinto id). Sin dedupe, la serie tendría puntos repetidos y el archivo
    // crecería con basura: pasó en la corrida end-to-end, no en un fixture.
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: [],
      current: [
        { ...prod('111', 100), id: 'a' },
        { ...prod('111', 100), id: 'b' },
        { ...prod('111', 100), id: 'c' },
      ],
      previousArtifact: vacio,
    })

    expect(r.artifact.dias[0]?.cambios).toEqual([{ ean: '111', precio: 100 }])
  })

  it('names the absent previous log as absent, not as a malformed one', () => {
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: [prod('111', 100)],
      current: [prod('111', 120)],
      previousArtifact: { ok: false, reason: 'absent' },
    })

    expect(r.degraded).toBe('absent')
  })

  it('records the first appearance of an EAN, which is its first point', () => {
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: [prod('111', 100)],
      current: [prod('111', 100), prod('999', 55)],
      previousArtifact: vacio,
    })

    expect(r.artifact.dias[0]?.cambios).toEqual([{ ean: '999', precio: 55 }])
  })

  it('keeps the previous days and never trims them (the log is cumulative)', () => {
    const viejo: HistorialArtifact = {
      version: 1,
      generado: '2026-10-23T14:00:00Z',
      dias: [{ fecha: '2026-10-23', cambios: [{ ean: '111', precio: 100 }] }],
    }
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: [prod('111', 100)],
      current: [prod('111', 120)],
      previousArtifact: previo(viejo),
    })

    expect(r.artifact.dias.map((d) => d.fecha)).toEqual(['2026-10-24', '2026-10-23'])
    expect(r.degraded).toBeNull()
  })

  it('rebuilds today instead of duplicating it when the same day runs twice', () => {
    const mismoDia: HistorialArtifact = {
      version: 1,
      generado: '2026-10-24T02:00:00Z',
      dias: [{ fecha: '2026-10-24', cambios: [{ ean: '111', precio: 999 }] }],
    }
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: [prod('111', 100)],
      current: [prod('111', 120)],
      previousArtifact: previo(mismoDia),
    })

    expect(r.artifact.dias).toEqual([{ fecha: '2026-10-24', cambios: [{ ean: '111', precio: 120 }] }])
  })

  it('drops a day dated in the future instead of carrying an impossible point', () => {
    const futuro: HistorialArtifact = {
      version: 1,
      generado: '2026-10-26T02:00:00Z',
      dias: [
        { fecha: '2026-10-26', cambios: [{ ean: '111', precio: 999 }] },
        { fecha: '2026-10-23', cambios: [{ ean: '111', precio: 100 }] },
      ],
    }
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: [prod('111', 100)],
      current: [prod('111', 120)],
      previousArtifact: previo(futuro),
    })

    expect(r.artifact.dias.map((d) => d.fecha)).toEqual(['2026-10-24', '2026-10-23'])
  })

  it('restarts the log and says why when the previous artifact is unusable', () => {
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: [prod('111', 100)],
      current: [prod('111', 120)],
      previousArtifact: { ok: false, reason: 'invalid-shape' },
    })

    expect(r.degraded).toBe('invalid-shape')
    expect(r.artifact.dias).toHaveLength(1)
  })

  it('invents no point for a day it did not see (first load)', () => {
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: null,
      current: [prod('111', 120)],
      previousArtifact: vacio,
    })

    expect(r.degraded).toBe('first-load')
    expect(r.artifact.dias).toEqual([{ fecha: '2026-10-24', cambios: [{ ean: '111', precio: 120 }] }])
  })

  it('skips a product with no barcode: a series needs an EAN to hang from', () => {
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: [],
      current: [prod('', 10), prod('111', 20)],
      previousArtifact: vacio,
    })

    expect(r.artifact.dias[0]?.cambios).toEqual([{ ean: '111', precio: 20 }])
  })

  it('rejects a date it cannot bucket', () => {
    expect(() =>
      buildHistorialArtifact({
        generatedAt: 'ayer',
        previous: [],
        current: [],
        previousArtifact: vacio,
      }),
    ).toThrow(TypeError)
  })
})

describe('parseHistorialArtifact', () => {
  it('accepts the shape it writes', () => {
    const r = buildHistorialArtifact({
      generatedAt: '2026-10-24T14:05:00Z',
      previous: [prod('111', 100)],
      current: [prod('111', 120)],
      previousArtifact: vacio,
    })

    expect(parseHistorialArtifact(JSON.parse(JSON.stringify(r.artifact))).ok).toBe(true)
  })

  it('refuses an artifact it cannot trust, field by field', () => {
    expect(parseHistorialArtifact(null)).toEqual({ ok: false, reason: 'absent' })
    expect(parseHistorialArtifact({ version: 2, generado: 'x', dias: [] }).ok).toBe(false)
    expect(parseHistorialArtifact({ version: 1, dias: [] }).ok).toBe(false)
    expect(parseHistorialArtifact({ version: 1, generado: 'x', dias: {} }).ok).toBe(false)
    expect(parseHistorialArtifact({ version: 1, generado: 'x', dias: [{ fecha: 'hoy', cambios: [] }] }).ok).toBe(
      false,
    )
    expect(
      parseHistorialArtifact({ version: 1, generado: 'x', dias: [{ fecha: '2026-10-24', cambios: [{}] }] }).ok,
    ).toBe(false)
    expect(
      parseHistorialArtifact({
        version: 1,
        generado: 'x',
        dias: [{ fecha: '2026-10-24', cambios: [{ ean: '111', precio: 'caro' }] }],
      }).ok,
    ).toBe(false)
  })
})
