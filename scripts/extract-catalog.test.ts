/**
 * extract-catalog.test.ts — end-to-end tests for the extraction CLI.
 *
 * No test touches the real network, the real credentials or the repository's
 * own `raw-catalog.json`: each one runs the real script as a subprocess against
 * a `node:http` fake bound to 127.0.0.1 on an ephemeral port, with a temp
 * directory as the working directory. `conServidor` closes the fake in a
 * `finally`, so a failing assertion never leaks a listening socket.
 *
 * The child is spawned with the ASYNC `spawn`, never `spawnSync`: the fake
 * server lives in this very process, so blocking the event loop here would
 * deadlock the child's request until its own abort timeout fired.
 *
 * The fake login body deliberately repeats the fake password: a passing run
 * must not contain it anywhere in stdout/stderr.
 *
 * `catalogos` lets one fake serve a different catalog per walk, which is how
 * the R8 retry (a completed-but-invalid walk) is exercised: the first walk can
 * come back duplicated or short and the second clean.
 */
import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(__dirname, 'extract-catalog.ts')
const EMAIL_FALSO = 'duenio@ejemplo.com'
const CLAVE_FALSA = 'clave-super-secreta-987'
const TOKEN_FALSO = 'token-secreto.abcdef012345'

interface Fake {
  cuantos: number
  catalogo: unknown[]
  /**
   * Successive walks: index 0 for the first, 1 for the retry. Falls back to
   * `catalogo` for every walk when omitted.
   */
  catalogos?: unknown[][]
  token?: string
  negocio?: unknown
  negocios?: unknown[]
  /** Any request whose pathname is exactly this gets HTTP 500. */
  falloEn?: string
  /** HTTP status for the login endpoint (default 200). */
  loginStatus?: number
}

interface EstadoServidor {
  /** Walks seen so far; a walk always opens with `desde=0`. */
  walk: number
}

function manejador(cfg: Fake, estado: EstadoServidor) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const responder = (status: number, cuerpo: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(cuerpo))
    }

    if (cfg.falloEn && url.pathname === cfg.falloEn) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('boom')
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/entrar') {
      req.resume()
      req.on('end', () => {
        const status = cfg.loginStatus ?? 200
        if (status >= 400) {
          // Repeats the credential on purpose: a leaky CLI would echo this.
          responder(status, { error: `clave incorrecta: ${CLAVE_FALSA}` })
          return
        }
        responder(200, {
          token: cfg.token ?? TOKEN_FALSO,
          negocio: cfg.negocio ?? { id: 'n-1', nombre: 'Kiosco Norte' },
          negocios: cfg.negocios ?? [{ id: 'n-1', nombre: 'Kiosco Norte' }],
        })
      })
      return
    }

    if (url.pathname === '/api/productos-cuantos') {
      responder(200, { cuantos: cfg.cuantos, conGondola: 0, conAlgo: 0 })
      return
    }

    if (url.pathname === '/api/productos') {
      const tope = Number(url.searchParams.get('tope'))
      const desde = Number(url.searchParams.get('desde'))
      // A walk always opens with desde=0, so this is a walk counter, not a
      // page counter: the retry's first page starts walk #2.
      if (desde === 0) estado.walk++
      const fuente = cfg.catalogos
        ? cfg.catalogos[Math.min(estado.walk - 1, cfg.catalogos.length - 1)]
        : cfg.catalogo
      responder(200, { productos: fuente.slice(desde, desde + tope) })
      return
    }

    responder(404, { error: 'no existe' })
  }
}

interface Peticion {
  method: string
  url: string
}

/** Starts the fake, runs `fn`, and always closes the server. */
async function conServidor<T>(
  cfg: Fake,
  fn: (baseUrl: string, peticiones: string[], detalladas: Peticion[]) => Promise<T>,
): Promise<T> {
  const peticiones: string[] = []
  const detalladas: Peticion[] = []
  const estado: EstadoServidor = { walk: 0 }
  const server: Server = createServer((req, res) => {
    peticiones.push(req.url ?? '')
    detalladas.push({ method: req.method ?? '', url: req.url ?? '' })
    manejador(cfg, estado)(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('el servidor falso no expuso un puerto')
  }

  try {
    return await fn(`http://127.0.0.1:${address.port}`, peticiones, detalladas)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  }
}

/** The ambient env minus the extraction variables, so no test can inherit one. */
function entornoLimpio(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.KIOSKOS_EMAIL
  delete env.KIOSKOS_CLAVE
  delete env.KIOSKOS_BASE_URL
  return env
}

/** Runs the real CLI and waits for it, without blocking this process's loop. */
function correrCli(
  cwd: string,
  env: Record<string, string | undefined>,
  args: string[] = [],
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...entornoLimpio(), ...env },
    })
    let out = ''
    let err = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => (out += d))
    child.stderr?.on('data', (d: string) => (err += d))
    child.on('error', (e) => (err += String(e)))
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }))
  })
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'extract-test-'))
}

/**
 * A destination the CLI must NOT touch. Seeding it makes "wrote nothing" a
 * positive observation (its exact bytes survive) instead of the mere absence
 * of a file, which a write-then-remove bug would also satisfy.
 */
const CENTINELA = '{"centinela":"no tocar"}\n'

function sembrarCentinela(dir: string, nombre = 'raw-catalog.json'): string {
  const p = join(dir, nombre)
  writeFileSync(p, CENTINELA)
  return p
}

function esperarIntacto(p: string): void {
  expect(existsSync(p)).toBe(true)
  expect(readFileSync(p, 'utf8')).toBe(CENTINELA)
}

function productos(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(5, '0')}`,
    nombre: `Producto ${i}`,
    categoria: 'Cat',
    barcode: i % 2 === 1 ? `779${String(i).padStart(6, '0')}` : '',
    precio: 100 + (i % 50),
  }))
}

const CREDENCIALES = { KIOSKOS_EMAIL: EMAIL_FALSO, KIOSKOS_CLAVE: CLAVE_FALSA }

describe('scripts/extract-catalog.ts', () => {
  it(
    'logs in, extracts every page, writes {generada, products} and exits 0 with a summary',
    async () => {
      const dir = tmp()
      const catalogo = productos(1200)

      await conServidor({ cuantos: 1200, catalogo }, async (baseUrl, peticiones) => {
        const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

        expect(r.code).toBe(0)
        const escrito = JSON.parse(readFileSync(join(dir, 'raw-catalog.json'), 'utf8')) as {
          generada: unknown
          products: unknown[]
        }
        // shape normalize-catalog already accepts, plus the extraction date the
        // About/Settings screen reads (T10): the date lives in the raw/facets,
        // never in catalogo.json (that would re-key the client cache).
        expect(Object.keys(escrito)).toEqual(['generada', 'products'])
        expect(typeof escrito.generada).toBe('string')
        expect(Number.isNaN(Date.parse(escrito.generada as string))).toBe(false)
        // ISO 8601 UTC, written at the moment of the successful walk
        expect(escrito.generada).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        expect(escrito.products).toHaveLength(1200)
        expect(escrito.products[0]).toEqual(catalogo[0])
        expect(escrito.products[1199]).toEqual(catalogo[1199])

        // summary: pages, records, oracle and the store the token is bound to
        expect(r.out).toContain('páginas: 3')
        expect(r.out).toContain('registros: 1200')
        expect(r.out).toContain('oráculo: 1200')
        expect(r.out).toContain('Kiosco Norte')

        // sequential walk from desde=0 by tope
        const paginas = peticiones.filter((p) => p.startsWith('/api/productos?'))
        expect(paginas).toEqual([
          '/api/productos?tope=500&desde=0',
          '/api/productos?tope=500&desde=500',
          '/api/productos?tope=500&desde=1000',
        ])
      })
    },
    30_000,
  )

  it('never prints the password or the token on a successful run', async () => {
    const dir = tmp()
    await conServidor({ cuantos: 600, catalogo: productos(600) }, async (baseUrl) => {
      const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

      expect(r.code).toBe(0)
      const todo = r.out + r.err
      expect(todo).not.toContain(CLAVE_FALSA)
      expect(todo).not.toContain(TOKEN_FALSO)
      expect(todo).not.toContain(EMAIL_FALSO)
    })
  })

  it('never prints the password or a rejected login body', async () => {
    const dir = tmp()
    const destino = sembrarCentinela(dir)
    await conServidor(
      { cuantos: 600, catalogo: productos(600), loginStatus: 401 },
      async (baseUrl, peticiones, detalladas) => {
        const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

        expect(r.code).toBe(1)
        const todo = r.out + r.err
        expect(todo).not.toContain(CLAVE_FALSA)
        expect(todo).not.toContain(TOKEN_FALSO)
        esperarIntacto(destino)
        // It really reached the login endpoint, and only once: without this a
        // dead base URL (connection refused) would pass for the same reason.
        expect(detalladas).toEqual([{ method: 'POST', url: '/api/entrar' }])
        expect(peticiones).toHaveLength(1)
      },
    )
  })

  it('exits 1 naming the missing variable and writes nothing when credentials are absent', async () => {
    const dir = tmp()
    const destino = sembrarCentinela(dir)
    // Unroutable port on purpose: the run must fail on the credential, not on
    // the network, which proves it never even opened a connection.
    const r = await correrCli(dir, { KIOSKOS_BASE_URL: 'http://127.0.0.1:1' })

    expect(r.code).toBe(1)
    expect(r.err).toContain('KIOSKOS_EMAIL')
    esperarIntacto(destino)
  })

  it('exits 1 naming KIOSKOS_CLAVE when only the password is missing', async () => {
    const dir = tmp()
    const destino = sembrarCentinela(dir)
    const r = await correrCli(dir, {
      KIOSKOS_BASE_URL: 'http://127.0.0.1:1',
      KIOSKOS_EMAIL: EMAIL_FALSO,
      KIOSKOS_CLAVE: '',
    })

    expect(r.code).toBe(1)
    expect(r.err).toContain('KIOSKOS_CLAVE')
    expect(r.err).not.toContain(EMAIL_FALSO)
    esperarIntacto(destino)
  })

  it(
    'exits 3 printing both counts and writes NOTHING when the extraction misses the oracle',
    async () => {
      const dir = tmp()
      const porDefecto = sembrarCentinela(dir)
      const explicito = sembrarCentinela(dir, 'custom.json')
      await conServidor({ cuantos: 1300, catalogo: productos(1200) }, async (baseUrl) => {
        const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

        expect(r.code).toBe(3)
        expect(r.out + r.err).toContain('1200')
        expect(r.out + r.err).toContain('1300')
        esperarIntacto(porDefecto)

        // Same guarantee when the destination is named explicitly.
        const rExplicito = await correrCli(
          dir,
          { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl },
          ['--out', 'custom.json'],
        )
        expect(rExplicito.code).toBe(3)
        esperarIntacto(explicito)
      })
    },
    30_000,
  )

  it('exits 2 when the oracle count endpoint fails, writing nothing', async () => {
    const dir = tmp()
    const destino = sembrarCentinela(dir)
    await conServidor(
      { cuantos: 600, catalogo: productos(600), falloEn: '/api/productos-cuantos' },
      async (baseUrl) => {
        const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

        expect(r.code).toBe(2)
        esperarIntacto(destino)
      },
    )
  })

  it('exits 2 when a catalog page fails and never retries the page', async () => {
    const dir = tmp()
    const destino = sembrarCentinela(dir)
    await conServidor(
      { cuantos: 600, catalogo: productos(600), falloEn: '/api/productos' },
      async (baseUrl, peticiones) => {
        const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

        expect(r.code).toBe(2)
        esperarIntacto(destino)
        // Exactly one page request: a retry loop must break this test.
        const paginas = peticiones.filter((p) => p.startsWith('/api/productos?'))
        expect(paginas).toHaveLength(1)
      },
    )
  })

  it('exits 2 with one clean typed line when the destination cannot be written', async () => {
    const dir = tmp()
    await conServidor({ cuantos: 600, catalogo: productos(600) }, async (baseUrl) => {
      // `--out <dir>` is an EISDIR: the API work succeeds, the write does not.
      const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl }, ['--out', dir])

      expect(r.code).toBe(2)
      const lineas = r.err.trimEnd().split('\n')
      const ultima = lineas[lineas.length - 1]
      expect(ultima).toMatch(/^extract-catalog: no se pudo escribir /)
      expect(ultima).toContain('EISDIR')
      // a raw Node stack would have frame lines and the fs symbol
      expect(lineas.some((l) => /^\s+at\s/.test(l))).toBe(false)
      expect(r.err).not.toContain('writeFileSync')
    })
  })

  it('warns when the account has more than one local, naming the one the token uses', async () => {
    const dir = tmp()
    await conServidor(
      {
        cuantos: 600,
        catalogo: productos(600),
        negocio: { id: 'n-1', nombre: 'Kiosco Norte' },
        negocios: [
          { id: 'n-1', nombre: 'Kiosco Norte' },
          { id: 'n-2', nombre: 'Kiosco Sur' },
        ],
      },
      async (baseUrl) => {
        const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

        expect(r.code).toBe(0)
        expect(r.err).toMatch(/ADVERTENCIA/i)
        expect(r.err).toContain('2 locales')
        expect(r.err).toContain('Kiosco Norte')
        expect(r.out).toContain('Kiosco Norte')
      },
    )
  })

  it('honors --out and --tope', async () => {
    const dir = tmp()
    await conServidor({ cuantos: 700, catalogo: productos(700) }, async (baseUrl, peticiones) => {
      const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl }, [
        '--out',
        'custom.json',
        '--tope',
        '300',
      ])

      expect(r.code).toBe(0)
      expect(existsSync(join(dir, 'raw-catalog.json'))).toBe(false)
      const escrito = JSON.parse(readFileSync(join(dir, 'custom.json'), 'utf8')) as {
        products: unknown[]
      }
      expect(escrito.products).toHaveLength(700)
      const paginas = peticiones.filter((p) => p.startsWith('/api/productos?'))
      expect(paginas).toEqual([
        '/api/productos?tope=300&desde=0',
        '/api/productos?tope=300&desde=300',
        '/api/productos?tope=300&desde=600',
      ])
    })
  })

  it('accepts the destination as a positional argument', async () => {
    const dir = tmp()
    await conServidor({ cuantos: 600, catalogo: productos(600) }, async (baseUrl) => {
      const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl }, ['otro.json'])

      expect(r.code).toBe(0)
      expect(existsSync(join(dir, 'otro.json'))).toBe(true)
      expect(existsSync(join(dir, 'raw-catalog.json'))).toBe(false)
    })
  })

  it('--help documents the environment, the options and the exit codes, and runs nothing', async () => {
    const dir = tmp()
    const r = await correrCli(dir, { KIOSKOS_BASE_URL: 'http://127.0.0.1:1' }, ['--help'])

    expect(r.code).toBe(0)
    expect(r.out).toContain('KIOSKOS_EMAIL')
    expect(r.out).toContain('KIOSKOS_CLAVE')
    expect(r.out).toContain('--env-file')
    expect(r.out).toContain('--tope')
    expect(r.out).toContain('--out')
    expect(r.out).toContain('0  ok')
    expect(r.out).toContain('1  login falló')
    expect(r.out).toContain('2  fallo de la API, de la paginación o al escribir el destino')
    expect(r.out).toContain('3  el catálogo extraído falló la validación después del reintento')
    expect(existsSync(join(dir, 'raw-catalog.json'))).toBe(false)
  })

  it(
    'retries the walk once when the first extraction has a duplicated id, then succeeds',
    async () => {
      const dir = tmp()
      const limpio = productos(600)
      // The R8 signature: one row repeated, at a page boundary, with the total
      // count still equal to the oracle. Ids stay unique in the second walk.
      const duplicado = [...limpio]
      duplicado[300] = { ...duplicado[299] }

      await conServidor(
        { cuantos: 600, catalogo: limpio, catalogos: [duplicado, limpio] },
        async (baseUrl, peticiones) => {
          const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

          expect(r.code).toBe(0)
          const escrito = JSON.parse(readFileSync(join(dir, 'raw-catalog.json'), 'utf8')) as {
            products: unknown[]
          }
          expect(escrito.products).toHaveLength(600)
          expect(escrito.products).toEqual(limpio)

          // Exactly TWO full walks: each is two pages (500 + 100). A retry loop
          // or a missing retry both break this exact list.
          const paginas = peticiones.filter((p) => p.startsWith('/api/productos?'))
          expect(paginas).toEqual([
            '/api/productos?tope=500&desde=0',
            '/api/productos?tope=500&desde=500',
            '/api/productos?tope=500&desde=0',
            '/api/productos?tope=500&desde=500',
          ])
          // The retry re-walks the catalog without authenticating again.
          expect(peticiones.filter((p) => p === '/api/entrar')).toHaveLength(1)
          // The retry is announced, and the first-walk reason is named.
          expect(r.err).toMatch(/reintent/i)
          expect(r.err).toContain('id-duplicado')
        },
      )
    },
    30_000,
  )

  it(
    'retries once when the first walk over-counts by one row without a skip, then succeeds',
    async () => {
      const dir = tmp()
      const limpio = productos(600)
      // The verifier's reproduction: a product is added mid-walk, the offsets
      // shift, and the row at the page boundary is fetched twice with no
      // compensating skip, so the walk ends at oracle + 1. The retry is clean.
      const sobreconteo = [...limpio]
      sobreconteo.splice(500, 0, { ...limpio[499] })

      await conServidor(
        { cuantos: 600, catalogo: limpio, catalogos: [sobreconteo, limpio] },
        async (baseUrl, peticiones) => {
          const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

          expect(r.code).toBe(0)
          const escrito = JSON.parse(readFileSync(join(dir, 'raw-catalog.json'), 'utf8')) as {
            products: unknown[]
          }
          expect(escrito.products).toEqual(limpio)

          // Exactly TWO walks (four pages): a single walk exits 2 on the old
          // threshold, and a missing retry exits 3. Both break this list.
          const paginas = peticiones.filter((p) => p.startsWith('/api/productos?'))
          expect(paginas).toEqual([
            '/api/productos?tope=500&desde=0',
            '/api/productos?tope=500&desde=500',
            '/api/productos?tope=500&desde=0',
            '/api/productos?tope=500&desde=500',
          ])
          // The retry re-walks the catalog without authenticating again.
          expect(peticiones.filter((p) => p === '/api/entrar')).toHaveLength(1)
          // The over-count reached validation, which named the count reason.
          expect(r.err).toContain('conteo-esperado')
        },
      )
    },
    30_000,
  )

  it(
    'retries once when the first walk comes up short of the oracle, then succeeds',
    async () => {
      const dir = tmp()
      const corto = productos(599)
      const completo = productos(600)

      await conServidor(
        { cuantos: 600, catalogo: completo, catalogos: [corto, completo] },
        async (baseUrl, peticiones) => {
          const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

          expect(r.code).toBe(0)
          const escrito = JSON.parse(readFileSync(join(dir, 'raw-catalog.json'), 'utf8')) as {
            products: unknown[]
          }
          expect(escrito.products).toHaveLength(600)

          // The short walk is the silent direction of R8: the count misses the
          // oracle. It must be retried, and only a completed walk is retried.
          const paginas = peticiones.filter((p) => p.startsWith('/api/productos?'))
          expect(paginas).toEqual([
            '/api/productos?tope=500&desde=0',
            '/api/productos?tope=500&desde=500',
            '/api/productos?tope=500&desde=0',
            '/api/productos?tope=500&desde=500',
          ])
          expect(r.err).toContain('conteo-esperado')
        },
      )
    },
    30_000,
  )

  it(
    'exits 3 with the validator reasons and writes NOTHING when both walks are invalid',
    async () => {
      const dir = tmp()
      const destino = sembrarCentinela(dir)
      const limpio = productos(600)
      const duplicado = [...limpio]
      duplicado[300] = { ...duplicado[299] }

      await conServidor(
        { cuantos: 600, catalogo: limpio, catalogos: [duplicado, duplicado] },
        async (baseUrl, peticiones) => {
          const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

          expect(r.code).toBe(3)
          // The printed errors name the motivo, not just the count.
          expect(r.err).toContain('id-duplicado')
          expect(r.err).toContain('p00299')
          esperarIntacto(destino)

          // Two walks attempted (four pages), never a third.
          const paginas = peticiones.filter((p) => p.startsWith('/api/productos?'))
          expect(paginas).toHaveLength(4)
        },
      )
    },
    30_000,
  )

  it('never retries a rejected login: exactly one POST /api/entrar and no walk', async () => {
    const dir = tmp()
    const destino = sembrarCentinela(dir)
    await conServidor(
      { cuantos: 600, catalogo: productos(600), loginStatus: 401 },
      async (baseUrl, peticiones, detalladas) => {
        const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

        expect(r.code).toBe(1)
        expect(
          detalladas.filter((p) => p.method === 'POST' && p.url === '/api/entrar'),
        ).toHaveLength(1)
        expect(peticiones.filter((p) => p.startsWith('/api/productos'))).toHaveLength(0)
        esperarIntacto(destino)
      },
    )
  })

  it('never retries an API failure on a page: exit 2 with a single walk', async () => {
    const dir = tmp()
    const destino = sembrarCentinela(dir)
    await conServidor(
      { cuantos: 600, catalogo: productos(600), falloEn: '/api/productos' },
      async (baseUrl, peticiones) => {
        const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

        expect(r.code).toBe(2)
        expect(peticiones.filter((p) => p.startsWith('/api/productos?'))).toHaveLength(1)
        esperarIntacto(destino)
      },
    )
  })

  it('never prints the password or the token on the retry-and-fail path', async () => {
    const dir = tmp()
    const limpio = productos(600)
    const duplicado = [...limpio]
    duplicado[300] = { ...duplicado[299] }

    await conServidor(
      { cuantos: 600, catalogo: limpio, catalogos: [duplicado, duplicado] },
      async (baseUrl) => {
        const r = await correrCli(dir, { ...CREDENCIALES, KIOSKOS_BASE_URL: baseUrl })

        expect(r.code).toBe(3)
        const todo = r.out + r.err
        expect(todo).not.toContain(CLAVE_FALSA)
        expect(todo).not.toContain(TOKEN_FALSO)
        expect(todo).not.toContain(EMAIL_FALSO)
      },
    )
  })
})
