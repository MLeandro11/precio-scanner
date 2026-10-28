import { describe, expect, it } from 'vitest'
import {
  HISTORIAL_VERSION,
  loadHistorial,
  parseHistorialArtifact,
  precioDeHoy,
  serieDe,
  variacionDe,
} from './historial'
import type { HistorialArtifact, HistorialDia } from './historial'

/**
 * La serie y la carga del log. Un error acá no rompe la app: hace que la pantalla
 * **mienta** sobre la historia de un precio, que es peor.
 */

const EAN = '7790895000001'

const dia = (fecha: string, cambios: Array<[string, number]>): HistorialDia => ({
  fecha,
  cambios: cambios.map(([ean, precio]) => ({ ean, precio })),
})

const artifact = (dias: HistorialDia[]): HistorialArtifact => ({
  version: HISTORIAL_VERSION,
  generado: `${dias[0]?.fecha ?? '2026-10-20'}T12:00:00Z`,
  dias,
})

describe('serieDe', () => {
  it('turns every row for the EAN into a point, oldest first', () => {
    const serie = serieDe(
      EAN,
      [dia('2026-10-20', [[EAN, 3450]]), dia('2026-10-18', [[EAN, 3600]]), dia('2026-10-15', [[EAN, 3500]])],
      null,
      '2026-10-21',
    )

    expect(serie.puntos).toEqual([
      { fecha: '2026-10-15', precio: 3500 },
      { fecha: '2026-10-18', precio: 3600 },
      { fecha: '2026-10-20', precio: 3450 },
    ])
  })

  it('closes the series with today\'s price when the last row is older', () => {
    const serie = serieDe(EAN, [dia('2026-10-18', [[EAN, 3600]])], 3450, '2026-10-21')

    expect(serie.puntos).toEqual([
      { fecha: '2026-10-18', precio: 3600 },
      { fecha: '2026-10-21', precio: 3450 },
    ])
  })

  it('does not duplicate today when the log already carries today at the same price', () => {
    const serie = serieDe(EAN, [dia('2026-10-21', [[EAN, 3450]])], 3450, '2026-10-21')

    expect(serie.puntos).toEqual([{ fecha: '2026-10-21', precio: 3450 }])
  })

  it('replaces today\'s log price with the catalog when the same day disagrees, instead of drawing two points', () => {
    // Un catálogo cacheado viejo y un historial fresco pueden discrepar sobre HOY.
    // Dos puntos con la misma fecha rompen las claves del gráfico y de la lista, y
    // el catálogo es la lectura más nueva: gana el catálogo.
    const serie = serieDe(EAN, [dia('2026-10-21', [[EAN, 3450]])], 3500, '2026-10-21')

    expect(serie.puntos).toEqual([{ fecha: '2026-10-21', precio: 3500 }])
  })

  it('adds no point at all for a product the log never saw and with an unknown price', () => {
    const serie = serieDe(EAN, [dia('2026-10-20', [['0000000000000', 100]])], null, '2026-10-21')

    expect(serie.puntos).toEqual([])
    expect(serie.huecos).toEqual([])
  })

  it('gives a first-seen product a single point, and invents no history behind it', () => {
    const serie = serieDe(EAN, [], 1500, '2026-10-21')

    expect(serie.puntos).toEqual([{ fecha: '2026-10-21', precio: 1500 }])
  })

  it('names the days the artifact has no bucket for, which is when there is no data', () => {
    // 16, 17 y 18 no están en el artefacto: no hubo corrida (o el producto no existía).
    const serie = serieDe(
      EAN,
      [dia('2026-10-15', [[EAN, 100]]), dia('2026-10-19', [[EAN, 200]])],
      null,
      '2026-10-21',
    )

    expect(serie.huecos).toEqual([{ desde: '2026-10-16', hasta: '2026-10-18' }])
  })

  it('does not call a gap a day that ran with no change for this product', () => {
    // El log solo publica filas de lo que cambió: un día con bucket vacío es "corrió y
    // el precio se mantuvo". Si eso contara como hueco, la línea nunca se dibujaría.
    const serie = serieDe(
      EAN,
      [
        dia('2026-10-15', [[EAN, 100]]),
        dia('2026-10-16', []),
        dia('2026-10-17', []),
        dia('2026-10-18', [[EAN, 200]]),
      ],
      null,
      '2026-10-21',
    )

    expect(serie.huecos).toEqual([])
    expect(serie.puntos).toHaveLength(2)
  })

  it('reports no gap between consecutive days', () => {
    const serie = serieDe(
      EAN,
      [dia('2026-10-15', [[EAN, 100]]), dia('2026-10-16', [[EAN, 200]])],
      null,
      '2026-10-21',
    )

    expect(serie.huecos).toEqual([])
  })

  it('keeps the last row when the log repeats the same day for one EAN', () => {
    const serie = serieDe(
      EAN,
      [dia('2026-10-20', [[EAN, 100]]), dia('2026-10-20', [[EAN, 200]])],
      null,
      '2026-10-21',
    )

    expect(serie.puntos).toEqual([{ fecha: '2026-10-20', precio: 200 }])
  })

  it('never draws a point dated in the future', () => {
    const serie = serieDe(EAN, [dia('2026-10-25', [[EAN, 999]])], 3450, '2026-10-21')

    expect(serie.puntos).toEqual([{ fecha: '2026-10-25', precio: 999 }])
  })
})

describe('variacionDe', () => {
  it('measures first against last, signed', () => {
    expect(
      variacionDe([
        { fecha: '2026-10-15', precio: 3500 },
        { fecha: '2026-10-20', precio: 3450 },
      ]),
    ).toEqual({ absoluta: -50, pct: (3450 - 3500) / 3500 * 100 })
  })

  it('has nothing to report with fewer than two points', () => {
    expect(variacionDe([{ fecha: '2026-10-15', precio: 3500 }])).toBeNull()
    expect(variacionDe([])).toBeNull()
  })

  it('refuses to divide by a zero base instead of printing infinity', () => {
    expect(
      variacionDe([
        { fecha: '2026-10-15', precio: 0 },
        { fecha: '2026-10-20', precio: 100 },
      ]),
    ).toEqual({ absoluta: 100, pct: null })
  })
})

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function memoryCaches(): { store: Map<string, string>; caches: { open(): Promise<unknown> } } {
  const store = new Map<string, string>()
  return {
    store,
    caches: {
      async open() {
        return {
          async match(key: string) {
            const text = store.get(key)
            return text === undefined ? undefined : new Response(text)
          },
          async put(key: string, response: Response) {
            store.set(key, await response.text())
          },
        }
      },
    },
  }
}

const baseUrl = 'https://example.test/precio-scanner/'
const okBody = JSON.stringify(artifact([dia('2026-10-20', [[EAN, 3450]])]))

describe('loadHistorial', () => {
  it('reads a fresh artifact from the network and stores the offline copy', async () => {
    const mem = memoryCaches()
    const result = await loadHistorial({
      baseUrl,
      caches: mem.caches as never,
      fetchFn: (async () => new Response(okBody, { status: 200 })) as unknown as typeof fetch,
    })

    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.source).toBe('network')
    expect(mem.store.get(`${baseUrl}data/historial.json`)).toBe(okBody)
  })

  it('asks for the unversioned key, never with ?v=', async () => {
    const urls: string[] = []
    await loadHistorial({
      baseUrl,
      caches: null,
      fetchFn: (async (input: string) => {
        urls.push(String(input))
        return new Response(okBody)
      }) as unknown as typeof fetch,
    })

    expect(urls).toEqual([`${baseUrl}data/historial.json`])
  })

  it('falls back to the stored copy when the network is gone', async () => {
    const mem = memoryCaches()
    mem.store.set(`${baseUrl}data/historial.json`, okBody)

    const result = await loadHistorial({
      baseUrl,
      caches: mem.caches as never,
      fetchFn: (async () => {
        throw new Error('sin red')
      }) as unknown as typeof fetch,
    })

    expect(result.status).toBe('ready')
    if (result.status === 'ready') expect(result.source).toBe('cache')
  })

  it('says offline when there is no network and nothing stored', async () => {
    const result = await loadHistorial({
      baseUrl,
      caches: memoryCaches().caches as never,
      fetchFn: (async () => {
        throw new Error('sin red')
      }) as unknown as typeof fetch,
    })

    expect(result.status).toBe('offline')
  })

  it('says absent on a 404 and also on the HTML fallback served with 200', async () => {
    const notFound = await loadHistorial({
      baseUrl,
      caches: null,
      fetchFn: (async () => new Response('no', { status: 404 })) as unknown as typeof fetch,
    })
    const htmlFallback = await loadHistorial({
      baseUrl,
      caches: null,
      fetchFn: (async () => new Response('<!doctype html><html></html>', { status: 200 })) as unknown as typeof fetch,
    })

    expect(notFound.status).toBe('absent')
    expect(htmlFallback.status).toBe('absent')
  })

  it('refuses an artifact it cannot trust: other version, bad JSON, bad shape', async () => {
    const cases = ['{"version":2,"generado":"2026-10-20","dias":[]}', 'no es json', '{"version":1}']
    for (const body of cases) {
      const result = await loadHistorial({
        baseUrl,
        caches: null,
        fetchFn: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
      })
      expect(result.status).toBe('invalid')
    }
  })

  it('says error when the server answers badly without being a 404', async () => {
    const result = await loadHistorial({
      baseUrl,
      caches: null,
      fetchFn: (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch,
    })

    expect(result.status).toBe('error')
  })
})

describe('parseHistorialArtifact', () => {
  it('accepts what the pipeline writes', () => {
    expect(parseHistorialArtifact(artifact([dia('2026-10-20', [[EAN, 3450]])]))).not.toBeNull()
  })

  it('rejects a structurally broken artifact, day date included', () => {
    const generado = '2026-10-20T00:00:00Z'
    expect(parseHistorialArtifact({ version: 2, generado, dias: [] })).toBeNull()
    expect(parseHistorialArtifact({ version: 1, dias: [] })).toBeNull()
    expect(parseHistorialArtifact({ version: 1, generado: 'ayer', dias: [] })).toBeNull()
    expect(parseHistorialArtifact({ version: 1, generado, dias: {} })).toBeNull()
    expect(
      parseHistorialArtifact({ version: 1, generado, dias: [{ fecha: '2026-13-45', cambios: [] }] }),
    ).toBeNull()
    expect(parseHistorialArtifact(['no', 'es', 'un', 'artefacto'])).toBeNull()
  })

  it('drops a single malformed row instead of invalidating the whole artifact', async () => {
    // El archivo real lleva 7 filas con barcode que no es EAN (`HG`, `AM`, …) entre
    // 823. Rechazar el archivo por una fila dejaba la pantalla entera en `invalid`.
    const body = JSON.stringify({
      version: HISTORIAL_VERSION,
      generado: '2026-10-20T12:00:00Z',
      dias: [
        dia('2026-10-18', [[EAN, 3600]]),
        {
          fecha: '2026-10-20',
          cambios: [
            { ean: 'HG', precio: 10 },
            { ean: EAN, precio: 3450 },
            { ean: '0000000000000', precio: 'caro' },
          ],
        },
      ],
    })

    const result = await loadHistorial({
      baseUrl,
      caches: null,
      fetchFn: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
    })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    // La fila mala nunca llega a una serie, y las válidas siguen ahí.
    expect(serieDe('HG', result.artifact.dias, null, '2026-10-21').puntos).toEqual([])
    expect(serieDe(EAN, result.artifact.dias, null, '2026-10-21').puntos).toEqual([
      { fecha: '2026-10-18', precio: 3600 },
      { fecha: '2026-10-20', precio: 3450 },
    ])
    expect(result.artifact.dias.flatMap((d) => d.cambios).map((c) => c.ean)).toEqual([EAN, EAN])
  })

  it('drops a day whose cambios is not an array and keeps the other days', () => {
    const parsed = parseHistorialArtifact({
      version: 1,
      generado: '2026-10-20T12:00:00Z',
      dias: [
        dia('2026-10-18', [[EAN, 3600]]),
        { fecha: '2026-10-19', cambios: 'roto' },
        dia('2026-10-20', [[EAN, 3450]]),
      ],
    })

    expect(parsed?.dias.map((d) => d.fecha)).toEqual(['2026-10-18', '2026-10-20'])
    expect(serieDe(EAN, parsed!.dias, null, '2026-10-21').puntos).toHaveLength(2)
  })

  it('never accepts a non-finite price', () => {
    const parsed = parseHistorialArtifact({
      version: 1,
      generado: '2026-10-20T12:00:00Z',
      dias: [
        {
          fecha: '2026-10-20',
          cambios: [
            { ean: EAN, precio: null },
            { ean: EAN, precio: 3450 },
          ],
        },
      ],
    })

    expect(parsed?.dias[0]?.cambios).toEqual([{ ean: EAN, precio: 3450 }])
  })
})

describe('precioDeHoy', () => {
  const fila = (barcode: string, precio: number) => ({ barcode, precio })

  it('takes the last catalog row for the EAN, the same rule the log writes with', () => {
    // El catálogo repite EANs con precios distintos (88 casos en el archivo real):
    // gana la última lectura, igual que al escribir cada día del log.
    expect(
      precioDeHoy([fila(EAN, 19500), fila('0000000000000', 100), fila(EAN, 19496)], EAN),
    ).toBe(19496)
    expect(precioDeHoy([fila(` ${EAN} `, 19496)], EAN)).toBe(19496)
  })

  it('returns null when no row matches and when there is no catalog at all', () => {
    expect(precioDeHoy([fila('0000000000000', 100)], EAN)).toBeNull()
    expect(precioDeHoy([], EAN)).toBeNull()
  })
})
