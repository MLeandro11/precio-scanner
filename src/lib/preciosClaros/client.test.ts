import { describe, it, expect } from 'vitest'
import {
  PreciosClarosError,
  buildProductoUrl,
  createPreciosClarosClient,
  MAX_LIMIT_PERMITIDO,
} from './client'
import type { FetchLike, HttpResponseLike } from './client'
import { readFileSync } from 'node:fs'
import type { ProductoResponse } from './schema'

function fixture(name: string): ProductoResponse {
  const url = new URL(`./fixtures/${name}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as ProductoResponse
}

function jsonResponse(body: unknown, { ok = true, status = 200 } = {}): HttpResponseLike {
  return { ok, status, json: async () => body }
}

/** Captures the typed error a rejected call produces, failing on a resolve. */
async function captureError(promise: Promise<unknown>): Promise<PreciosClarosError> {
  try {
    await promise
  } catch (err) {
    if (err instanceof PreciosClarosError) return err
    throw err
  }
  throw new Error('expected the call to reject, but it resolved')
}

function params(url: string): URLSearchParams {
  return new URL(url).searchParams
}

describe('buildProductoUrl', () => {
  it('builds a lat/lng query with id_producto, limit and offset', () => {
    const url = buildProductoUrl({ idProducto: '7790895000430', selector: { lat: -51.62, lng: -69.24 } })
    const q = params(url)
    expect(q.get('id_producto')).toBe('7790895000430')
    expect(q.get('lat')).toBe('-51.62')
    expect(q.get('lng')).toBe('-69.24')
    expect(q.get('limit')).toBe(String(MAX_LIMIT_PERMITIDO))
    expect(q.get('offset')).toBe('0')
    expect(q.has('array_sucursales')).toBe(false)
    // Trap: `entorno` makes the API answer total: 0. It must never be sent.
    expect(q.has('entorno')).toBe(false)
  })

  it('builds an array_sucursales query joining the branch keys with a comma', () => {
    const url = buildProductoUrl({
      idProducto: '7790895000430',
      selector: { sucursales: ['15-1-454', '11-2-1075'] },
      limit: 10,
      offset: 20,
    })
    const q = params(url)
    expect(q.get('array_sucursales')).toBe('15-1-454,11-2-1075')
    expect(q.has('lat')).toBe(false)
    expect(q.has('lng')).toBe(false)
    expect(q.get('limit')).toBe('10')
    expect(q.get('offset')).toBe('20')
  })

  it('rejects a request without a selector before hitting the network', () => {
    expect(() =>
      buildProductoUrl({ idProducto: '1', selector: undefined as never }),
    ).toThrow(PreciosClarosError)
  })
})

describe('createPreciosClarosClient', () => {
  it('returns the parsed body when the status is 200', async () => {
    const response = fixture('lat-lng-lejos-644km.json')
    const client = createPreciosClarosClient({ fetchImpl: async () => jsonResponse(response) })
    const result = await client.fetchProducto({
      idProducto: '7790895000430',
      selector: { lat: -51.62, lng: -69.24 },
    })
    expect(result.status).toBe(200)
    expect(result.sucursales).toHaveLength(50)
  })

  it('AC6: body status 400 inside an HTTP 200 → typed error, caller gets no data', async () => {
    const client = createPreciosClarosClient({
      fetchImpl: async () => jsonResponse({ status: 400, error: 'bad request' }, { status: 200 }),
    })

    let received = false
    try {
      await client.fetchProducto({ idProducto: '1', selector: { lat: 0, lng: 0 } })
      received = true
    } catch {
      // expected
    }

    expect(received).toBe(false)
    const err = await captureError(
      client.fetchProducto({ idProducto: '1', selector: { lat: 0, lng: 0 } }),
    )
    expect(err).toBeInstanceOf(PreciosClarosError)
    expect(err.kind).toBe('body-status')
    expect(err.status).toBe(400)
  })

  it('AC7: a network failure maps to a typed network error', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError('Failed to fetch')
    }
    const client = createPreciosClarosClient({ fetchImpl })
    const err = await captureError(
      client.fetchProducto({ idProducto: '1', selector: { lat: 0, lng: 0 } }),
    )
    expect(err.kind).toBe('network')
  })

  it('AC7: a timeout maps to a typed timeout error (real AbortSignal)', async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(init.signal.reason ?? new Error('aborted')),
        )
      })
    const client = createPreciosClarosClient({ fetchImpl, timeoutMs: 5 })
    const err = await captureError(
      client.fetchProducto({ idProducto: '1', selector: { lat: 0, lng: 0 } }),
    )
    expect(err.kind).toBe('timeout')
  })

  it('maps a non-2xx HTTP status to a typed http error', async () => {
    const client = createPreciosClarosClient({
      fetchImpl: async () => jsonResponse({}, { ok: false, status: 503 }),
    })
    const err = await captureError(
      client.fetchProducto({ idProducto: '1', selector: { lat: 0, lng: 0 } }),
    )
    expect(err.kind).toBe('http')
    expect(err.status).toBe(503)
  })

  it('maps invalid JSON to a typed invalid-body error', async () => {
    const client = createPreciosClarosClient({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token')
        },
      }),
    })
    const err = await captureError(
      client.fetchProducto({ idProducto: '1', selector: { lat: 0, lng: 0 } }),
    )
    expect(err.kind).toBe('invalid-body')
  })
})
