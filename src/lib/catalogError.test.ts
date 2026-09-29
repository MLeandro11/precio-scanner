import { describe, it, expect } from 'vitest'
import { describeCatalogError } from './catalogError'

/**
 * Errors shipped by catalogLoader (src/lib/catalogLoader.ts) and by the
 * worker client are the only real inputs; the tests pin the exact raw-text
 * signals the mapper keys on so copy drift in catalogLoader breaks these
 * tests loudly instead of silently renaming a branch.
 */
describe('describeCatalogError', () => {
  it('maps a failed catalog download to a connectivity cause', () => {
    const err = new Error('catalogLoader: failed to download catalogo.json (503)')
    expect(describeCatalogError(err)).toEqual({
      title: 'No se pudo descargar el catálogo.',
      hint: 'Revisá tu conexión a internet y probá de nuevo.',
    })
  })

  it('maps the offline-without-cache boot failure to the same connectivity cause', () => {
    const err = new Error(
      'catalogLoader: offline with no cached facets (/data/catalogo-facets.json)',
    )
    expect(describeCatalogError(err)).toEqual({
      title: 'No se pudo descargar el catálogo.',
      hint: 'Revisá tu conexión a internet y probá de nuevo.',
    })
  })

  it('maps invalid JSON to a malformed-catalog cause with a follow-up hint', () => {
    const err = new Error(
      'catalogLoader: invalid JSON for catalogo.json (/data/catalogo.json?v=abc): Unexpected token',
    )
    expect(describeCatalogError(err)).toEqual({
      title: 'El catálogo llegó dañado o incompleto.',
      hint: 'Probá de nuevo; si el error sigue, el archivo del servidor está dañado.',
    })
  })

  it('maps HTML-instead-of-JSON to a not-the-catalog server cause', () => {
    const err = new Error(
      'catalogLoader: received HTML instead of JSON for catalogo.json (/data/catalogo.json?v=abc)',
    )
    expect(describeCatalogError(err)).toEqual({
      title: 'El servidor respondió con una página, no con el catálogo.',
      hint: 'Probá de nuevo; si el error sigue, avisá al mantenedor.',
    })
  })

  it('falls back to an honest generic message for unrecognized errors', () => {
    expect(describeCatalogError(new Error('worker crashed: something else'))).toEqual({
      title: 'Ocurrió un error al buscar.',
      hint: 'Probá de nuevo; si el error sigue, avisá al mantenedor.',
    })
    expect(describeCatalogError(undefined)).toEqual(describeCatalogError(null))
  })

  it('never echoes raw technical details (URLs, statuses, English messages)', () => {
    const raw =
      'catalogLoader: failed to download catalogo.json (503) https://example.com/data/catalogo.json'
    const { title, hint } = describeCatalogError(new Error(raw))
    for (const text of [title, hint ?? '']) {
      expect(text).not.toMatch(/https?:\/\//)
      expect(text).not.toMatch(/catalogo\.json/)
      expect(text).not.toMatch(/catalogLoader|503/)
    }
  })
})
