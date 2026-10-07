#!/usr/bin/env node
/**
 * extract-catalog.ts — kioskos.app → raw-catalog.json, the extraction step.
 *
 * This is the only script that talks to the real site. It logs in with the
 * account credentials, asks the oracle how many products the catalog has,
 * walks every page sequentially, and writes the result in the shape
 * `scripts/normalize-catalog.ts` already accepts: `{"products": [...]}`.
 *
 * The credential never has to touch a command line, and should not:
 *
 *     node --env-file=.env.local scripts/extract-catalog.ts
 *
 * A credential passed as an argument lands in the shell history and in `ps`.
 *
 * One login attempt per run. The token lives 12 hours and there is no refresh;
 * retrying a rejected credential is the fast path to an account lockout, so
 * there are no retries here or in the client.
 *
 * Log hygiene (the repo is public and `raw-catalog.json` carries the user's
 * cost and margin): this script never prints the password, the token, the
 * login body or a product record. Every line is a count, a page number, the
 * destination path, or the name/id of the `negocio` the token is bound to.
 *
 * Exit codes (distinct so CI can branch):
 *   0 — ok
 *   1 — login failed (credentials missing or rejected, invalid arguments)
 *   2 — API, pagination or destination write failure
 *   3 — the extracted count differs from the oracle
 *
 * Usage: node --env-file=<f> scripts/extract-catalog.ts [out.json]
 *             [--out <path>] [--tope <n>] [--help]
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contar, entrar, extraerTodo, KioskosError, TOPE_DEFAULT } from './kioskos-client.ts'
import type { Extraccion, KioskosDeps, Sesion } from './kioskos-client.ts'

const BASE_URL_DEFAULT = 'https://kioskos.app'
const OUT_DEFAULT = 'raw-catalog.json'

interface Opciones {
  out: string
  tope: number
}

const USAGE = `Uso: node --env-file=<archivo> scripts/extract-catalog.ts [out.json] [opciones]

Inicia sesión en kioskos.app con KIOSKOS_EMAIL / KIOSKOS_CLAVE, cuenta el
catálogo con su oráculo, lo pagina entero y escribe {"products": [...]} en
raw-catalog.json: el formato que ya acepta scripts/normalize-catalog.ts.

La forma recomendada de pasar la credencial es --env-file, no la línea de
comandos: un argumento queda en el historial del shell y en \`ps\`.

Variables de entorno:
  KIOSKOS_EMAIL        email de la cuenta (obligatoria)
  KIOSKOS_CLAVE        clave de la cuenta (obligatoria; nunca se imprime)
  KIOSKOS_BASE_URL     base de la API (default: ${BASE_URL_DEFAULT})

Opciones:
  --out <path>         destino (default: ${OUT_DEFAULT}); también se acepta como primer argumento posicional
  --tope <n>           registros por página (default: ${TOPE_DEFAULT})
  --help               muestra esta ayuda y no ejecuta nada

Códigos de salida:
  0  ok
  1  login falló (credenciales ausentes o rechazadas, argumentos inválidos)
  2  fallo de la API, de la paginación o al escribir el destino
  3  el conteo extraído difiere del oráculo

La salida lleva solo conteos, la cantidad de páginas y el nombre del local.
Nunca imprime la clave, el token, el cuerpo del login ni un registro.`

function fail(code: number, msg: string): never {
  console.error(`extract-catalog: ${msg}`)
  process.exit(code)
}

/** Safe rendering of a failure. A message that is not ours is not echoed. */
function mensajeDe(err: unknown): string {
  if (err instanceof KioskosError) return err.message
  return err instanceof Error ? `fallo inesperado (${err.name})` : 'fallo inesperado'
}

/**
 * The errno code of an I/O failure (or its class name). Only the code, never
 * the raw message: the Node message quotes the syscall and the full path.
 */
function codigoDeError(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
  }
  return err instanceof Error && err.name ? err.name : 'error'
}

/** Runs `fn`, mapping a typed failure to `code` with its (already safe) message. */
async function conExit<T>(code: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    fail(code, mensajeDe(err))
  }
}

function parseArgs(argv: string[]): Opciones | { help: true } {
  const opts: Opciones = { out: OUT_DEFAULT, tope: TOPE_DEFAULT }
  let outFromFlag = false
  let outFromPositional = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--out') {
      const value = argv[++i]
      if (!value) fail(1, '--out necesita un path')
      opts.out = value
      outFromFlag = true
    } else if (arg === '--tope') {
      const value = argv[++i]
      const n = Number(value)
      if (!value || !Number.isInteger(n) || n <= 0) {
        fail(1, `--tope necesita un entero > 0 (recibí "${value ?? ''}")`)
      }
      opts.tope = n
    } else if (arg.startsWith('--')) {
      fail(1, `opción desconocida: ${arg}`)
    } else if (outFromPositional) {
      fail(1, `argumento de más: ${arg}`)
    } else {
      opts.out = arg
      outFromPositional = true
    }
  }

  if (outFromFlag && outFromPositional) {
    fail(1, 'el destino se pasó dos veces (posicional y --out)')
  }
  return opts
}

/** Reads a credential by NAME; a missing or blank value is named, never shown. */
function leerCredencial(nombre: 'KIOSKOS_EMAIL' | 'KIOSKOS_CLAVE'): string {
  const valor = process.env[nombre]
  if (valor === undefined || valor.trim() === '') {
    fail(1, `falta la variable de entorno ${nombre}`)
  }
  return valor
}

/**
 * The `negocio` the token is bound to, as a label. This is how the project
 * makes open risk R4 visible: a token is tied to one local, so a future second
 * local would otherwise show up as a catalog that suddenly collapsed.
 */
function describirNegocio(negocio: unknown): string {
  if (typeof negocio !== 'object' || negocio === null) return 'desconocido'
  const n = negocio as Record<string, unknown>
  const nombre = typeof n.nombre === 'string' && n.nombre.trim() !== '' ? n.nombre.trim() : null
  const id = typeof n.id === 'string' || typeof n.id === 'number' ? String(n.id) : null
  if (nombre && id) return `${nombre} (id ${id})`
  if (nombre) return nombre
  if (id) return `id ${id}`
  return 'desconocido'
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if ('help' in parsed) {
    console.log(USAGE)
    return
  }
  const opts = parsed
  const outPath = resolve(opts.out)

  // Credentials first: an absent variable must fail before any request.
  const email = leerCredencial('KIOSKOS_EMAIL')
  const clave = leerCredencial('KIOSKOS_CLAVE')

  const deps: KioskosDeps = {
    fetch: globalThis.fetch,
    baseUrl: process.env.KIOSKOS_BASE_URL?.trim() || BASE_URL_DEFAULT,
  }

  const sesion: Sesion = await conExit(1, () => entrar(deps, { email, clave }))
  console.error('extract-catalog: login ok')

  const cuantos: number = await conExit(2, () => contar(deps, sesion.token))

  const extraccion: Extraccion = await conExit(2, () =>
    extraerTodo(deps, sesion.token, {
      tope: opts.tope,
      cuantos,
      alAvanzar: (n) => console.error(`extract-catalog: ${n} registros leídos`),
    }),
  )

  const local = describirNegocio(sesion.negocio)

  // R4, loud on purpose: if the account ever has more than one local, the
  // token is bound to exactly one of them and that has to be visible in CI.
  if (sesion.negocios.length > 1) {
    console.error(
      `extract-catalog: ADVERTENCIA — la cuenta tiene ${sesion.negocios.length} locales; ` +
        `el token quedó atado a uno solo: ${local}. ` +
        'El catálogo extraído es SOLO de ese local.',
    )
  }

  // Count assertion BEFORE the write: a mismatch must not touch the file.
  if (extraccion.productos.length !== cuantos) {
    console.error(
      `extract-catalog: el conteo extraído (${extraccion.productos.length}) difiere del oráculo ` +
        `(${cuantos}); no se escribió nada`,
    )
    process.exit(3)
  }

  // The API work already succeeded, so a write failure is exit 2 too — and it
  // goes through the same one-line path as every other failure, never a raw
  // Node stack. `outPath` is the resolved path; the message shows the user's
  // own argument.
  try {
    writeFileSync(outPath, `${JSON.stringify({ products: extraccion.productos })}\n`)
  } catch (err) {
    fail(2, `no se pudo escribir ${opts.out}: ${codigoDeError(err)}`)
  }

  console.log(
    `extract-catalog: listo — páginas: ${extraccion.paginas} · ` +
      `registros: ${extraccion.productos.length} · oráculo: ${cuantos} · tope: ${extraccion.tope}`,
  )
  console.log(`extract-catalog: local del token: ${local}`)
  console.log(`extract-catalog: escrito ${opts.out}`)
}

await main()
