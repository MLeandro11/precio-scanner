#!/usr/bin/env node
/**
 * fetch-data.ts — brings the generated catalog from the `datos` branch into the
 * working tree, so a fresh clone, a local build and the deploy workflow all have
 * data.
 *
 * `public/data/*.json` is generated, not source: it lives only on the `datos`
 * branch, where the daily job appends a commit with exactly those three files
 * under `public/data/`. `scripts/acceptance.ts` and `scripts/tune-threshold.ts`
 * read the real catalog, so a developer needs a way to pull it down.
 *
 * Why git and not HTTP: `git fetch origin datos` reuses the remote and the
 * credentials the developer (or the CI runner) already has, has no rate limits
 * and no API surface to authenticate against, and behaves the same locally and
 * in CI. Pulling the same bytes over an HTTP URL would need a token, a
 * different code path per environment and a GitHub API call. So there is no new
 * dependency and no network request beyond git itself.
 *
 * The read is `git show <commit>:<path>` for each file out of the fetched
 * commit, so nothing is checked out and the working tree is never switched to
 * `datos`.
 *
 * `--check` is the build guard: a build with no catalog is a broken site, so it
 * verifies the files already on disk are valid and exits without touching
 * anything and without invoking git or the network. Every failure is loud.
 *
 * Validation (both modes): the three files must exist, be non-empty and parse as
 * JSON; `catalogo.json` must carry a non-empty `products` array and
 * `catalogo-facets.json` a `version` string. Nothing is written until everything
 * has been fetched and validated, so a bad fetch can never leave a half-written
 * catalog behind.
 *
 * Exit codes:
 *   0 — ok
 *   1 — usage/argument error
 *   2 — the data could not be fetched or validated (or the destination could
 *       not be written)
 *
 * Usage: node scripts/fetch-data.ts [--branch <name>] [--dest <dir>] [--check]
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BRANCH_DEFAULT = 'datos'
export const DEST_DEFAULT = 'public/data'

/** The fixed layout of the `datos` branch: local name + path inside the commit. */
export const ARCHIVOS = [
  { nombre: 'catalogo.json', ruta: 'public/data/catalogo.json' },
  { nombre: 'catalogo-index.json', ruta: 'public/data/catalogo-index.json' },
  { nombre: 'catalogo-facets.json', ruta: 'public/data/catalogo-facets.json' },
] as const

/** The two `version` fields must be a string; the catalogo's is not required. */
const ARCHIVO_FACETS = 'catalogo-facets.json'
const ARCHIVO_CATALOGO = 'catalogo.json'

/** Big enough for the real 3.4 MB catalogo and its 2.1 MB index, with room. */
const MAX_BUFFER = 256 * 1024 * 1024

/** A usage/argument mistake. Maps to exit 1. */
export class UsoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsoError'
  }
}

/** A fetch or validation failure. Maps to exit 2. */
export class FetchDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FetchDataError'
  }
}

export interface SalidaGit {
  code: number
  stdout: Buffer
  stderr: string
}

/** Runs a git command and returns its exit code and captured bytes. */
export type RunnerGit = (args: string[], cwd: string) => SalidaGit

export interface OpcionesCli {
  branch: string
  dest: string
  check: boolean
}

export interface ResumenDatos {
  /** `version` of the dataset, from `catalogo-facets.json`. */
  version: string
  /** Number of records in `catalogo.json`'s `products` array. */
  products: number
}

export interface ResultadoFetch extends ResumenDatos {
  branch: string
  commit: string
}

/**
 * The default runner: `git` in `cwd`, stdout captured as bytes (the files are
 * written byte for byte, so they must not round-trip through a string decode).
 */
export function gitReal(args: string[], cwd: string): SalidaGit {
  const r = spawnSync('git', args, { cwd, maxBuffer: MAX_BUFFER, encoding: 'buffer' })
  if (r.error) {
    return { code: -1, stdout: Buffer.alloc(0), stderr: r.error.message }
  }
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? Buffer.alloc(0),
    stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8'),
  }
}

/** The errno code (or class name) of an I/O error; never the raw message. */
function codigoDeError(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
  }
  return err instanceof Error && err.name ? err.name : 'error'
}

/** First line of git's stderr, capped; useful without dumping the whole thing. */
function detalle(stderr: string): string {
  const linea = stderr.trim().split('\n')[0] ?? ''
  if (linea === '') return ''
  return ` (${linea.slice(0, 200)})`
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** How a validator reaches each of the three files: bytes, or `null` if absent. */
export type LectorArchivo = (nombre: string) => Buffer | null

/**
 * The single validation path, shared by the fetched bytes and the on-disk
 * `--check`. It names the offending file on every failure, and returns the two
 * numbers the summary prints.
 */
export function validarContenidos(leer: LectorArchivo): ResumenDatos {
  const jsons = new Map<string, unknown>()

  for (const archivo of ARCHIVOS) {
    const buf = leer(archivo.nombre)
    if (buf === null) throw new FetchDataError(`${archivo.nombre} no existe`)
    if (buf.length === 0) throw new FetchDataError(`${archivo.nombre} está vacío`)
    let json: unknown
    try {
      json = JSON.parse(buf.toString('utf8'))
    } catch {
      throw new FetchDataError(`${archivo.nombre} no es JSON válido`)
    }
    jsons.set(archivo.nombre, json)
  }

  const catalogo = jsons.get(ARCHIVO_CATALOGO)
  const products = esObjeto(catalogo) ? catalogo.products : undefined
  if (!Array.isArray(products) || products.length === 0) {
    throw new FetchDataError(
      `${ARCHIVO_CATALOGO} no trae un array "products" con al menos un producto`,
    )
  }

  const facets = jsons.get(ARCHIVO_FACETS)
  const version = esObjeto(facets) ? facets.version : undefined
  if (typeof version !== 'string' || version === '') {
    throw new FetchDataError(`${ARCHIVO_FACETS} no trae un "version" de texto`)
  }

  return { version, products: products.length }
}

/**
 * Fetch + validate + write. Never writes before all three files are in hand and
 * valid, so a failed fetch cannot leave a partial catalog behind.
 */
export function descargarDatos(
  run: RunnerGit,
  opts: { branch: string; dest: string; cwd?: string },
): ResultadoFetch {
  const cwd = opts.cwd ?? process.cwd()

  const fetched = run(['fetch', 'origin', opts.branch], cwd)
  if (fetched.code !== 0) {
    throw new FetchDataError(
      `no se pudo hacer git fetch origin ${opts.branch} (código ${fetched.code})${detalle(fetched.stderr)}`,
    )
  }

  const rev = run(['rev-parse', '--verify', 'FETCH_HEAD'], cwd)
  const commit = rev.code === 0 ? rev.stdout.toString('utf8').trim() : ''
  if (!/^[0-9a-f]{40,64}$/.test(commit)) {
    throw new FetchDataError(`no se pudo resolver el commit de FETCH_HEAD en el branch ${opts.branch}`)
  }

  const contenidos = new Map<string, Buffer>()
  for (const archivo of ARCHIVOS) {
    const r = run(['show', `${commit}:${archivo.ruta}`], cwd)
    if (r.code !== 0) {
      throw new FetchDataError(
        `el archivo ${archivo.ruta} no está en el branch ${opts.branch} (${commit.slice(0, 12)})${detalle(r.stderr)}`,
      )
    }
    contenidos.set(archivo.nombre, r.stdout)
  }

  const resumen = validarContenidos((nombre) => contenidos.get(nombre) ?? null)

  // Only now is anything written.
  try {
    mkdirSync(opts.dest, { recursive: true })
    for (const archivo of ARCHIVOS) {
      writeFileSync(join(opts.dest, archivo.nombre), contenidos.get(archivo.nombre)!)
    }
  } catch (err) {
    throw new FetchDataError(`no se pudo escribir en ${opts.dest}: ${codigoDeError(err)}`)
  }

  return { branch: opts.branch, commit, ...resumen }
}

/**
 * `--check`: validate the files already on disk. No runner, no network, no
 * writes — a missing file is an `ENOENT` turned into a named failure.
 */
export function verificarDatos(dest: string): ResumenDatos {
  return validarContenidos((nombre) => {
    try {
      return readFileSync(join(dest, nombre))
    } catch (err) {
      if (codigoDeError(err) === 'ENOENT') return null
      throw new FetchDataError(`no se pudo leer ${join(dest, nombre)}: ${codigoDeError(err)}`)
    }
  })
}

export function parseArgs(argv: string[]): OpcionesCli | { help: true } {
  const opts: OpcionesCli = { branch: BRANCH_DEFAULT, dest: DEST_DEFAULT, check: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--branch') {
      const value = argv[++i]
      if (!value || value.startsWith('-')) throw new UsoError('--branch necesita un nombre')
      opts.branch = value
    } else if (arg === '--dest') {
      const value = argv[++i]
      if (!value || value.startsWith('-')) throw new UsoError('--dest necesita un directorio')
      opts.dest = value
    } else if (arg === '--check') {
      opts.check = true
    } else {
      throw new UsoError(`opción desconocida: ${arg}`)
    }
  }

  return opts
}

const USAGE = `Uso: node scripts/fetch-data.ts [--branch <nombre>] [--dest <dir>] [--check]

Baja public/data/{catalogo,catalogo-index,catalogo-facets}.json desde un branch
de datos (default "${BRANCH_DEFAULT}") usando git: hace \`git fetch origin <branch>\` y lee
cada archivo del commit bajado, sin hacer checkout. Reutiliza el remoto y las
credenciales que ya tenés, sin límites de tasa y sin llamar a ninguna API.

Valida los tres archivos (existen, no están vacíos, son JSON; catalogo.json trae
"products" no vacío; catalogo-facets.json trae "version") y recién entonces
escribe. Si algo falta o no parsea, no escribe nada y sale con 2.

Opciones:
  --branch <nombre>    branch del que bajar los datos (default: ${BRANCH_DEFAULT})
  --dest <dir>         destino local (default: ${DEST_DEFAULT}); se crea si no existe
  --check              valida los archivos ya presentes y sale; no toca nada y
                       no usa la red ni git. Pensado como guarda previa al build.
  --help, -h           muestra esta ayuda y no ejecuta nada

Códigos de salida:
  0  ok
  1  error de uso o de argumentos
  2  no se pudieron bajar o validar los datos (o no se pudo escribir el destino)

La salida lleva solo el branch, el commit, la cantidad de productos y la versión
del dataset. Nunca imprime el contenido de un registro.`

function fail(code: number, msg: string): never {
  console.error(`fetch-data: ${msg}`)
  process.exit(code)
}

/** Safe rendering of a failure: only errors we raised are echoed verbatim. */
function mensajeDe(err: unknown): string {
  if (err instanceof FetchDataError) return err.message
  if (err instanceof UsoError) return err.message
  return err instanceof Error ? `fallo inesperado (${err.name})` : 'fallo inesperado'
}

async function main(): Promise<void> {
  let parsed: OpcionesCli | { help: true }
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (err) {
    fail(1, mensajeDe(err))
  }

  if ('help' in parsed) {
    console.log(USAGE)
    return
  }

  const dest = resolve(parsed.dest)

  if (parsed.check) {
    let resumen: ResumenDatos
    try {
      resumen = verificarDatos(dest)
    } catch (err) {
      fail(2, mensajeDe(err))
    }
    console.log(
      `fetch-data: datos locales OK en ${parsed.dest} · productos: ${resumen.products} · version: ${resumen.version}`,
    )
    return
  }

  let resultado: ResultadoFetch
  try {
    resultado = descargarDatos(gitReal, { branch: parsed.branch, dest, cwd: process.cwd() })
  } catch (err) {
    fail(2, mensajeDe(err))
  }

  console.log(`fetch-data: branch ${resultado.branch} · commit ${resultado.commit}`)
  console.log(
    `fetch-data: 3 archivos en ${parsed.dest} · productos: ${resultado.products} · version: ${resultado.version}`,
  )
}

/** Only run the CLI when this file is the entry point (tests import the core). */
function esEntrada(): boolean {
  const argv1 = process.argv[1]
  return argv1 !== undefined && import.meta.url === pathToFileURL(argv1).href
}

if (esEntrada()) {
  await main()
}
