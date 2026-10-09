#!/usr/bin/env node
/**
 * refresh-catalog.ts — validate a raw extraction, then refresh `public/data`.
 *
 * Order is contractual (decision D6 of the `catalog-refresh` spec): the
 * currently published catalog is read FIRST (the diff baseline), then the raw
 * extraction is read and validated, and only if it passes are
 * `normalize-catalog` and `generate-index` run. A validation failure must never
 * leave `public/data` half-updated.
 *
 * Decisions this CLI honors:
 *   - D4: the pipeline is invoked by subprocess (`node <script>`), never by
 *     refactoring those two verified CLIs.
 *   - D6: validate before writing.
 *
 * Exit codes (distinct so CI can branch):
 *   0 — ok
 *   1 — raw validation failed (nothing was written)
 *   2 — raw record count differs from `--esperado`
 *   3 — a pipeline step failed, or an explicit `--baseline` is missing/unreadable
 *
 * Log hygiene (the repo is public; `raw-catalog.json` carries the user's cost
 * and margin): this script never prints a record. Validation diagnostics name
 * the reason, the index and the offending field only — never the value. The
 * report prints the catalog's own public fields (`id`, `nombre`, `barcode`,
 * `categoria`, price summaries).
 *
 * Usage: node scripts/refresh-catalog.ts [raw.json] [--raw <p>] [--catalogo <p>]
 *                                       [--baseline <p>] [--esperado <N>] [--json] [--help]
 *
 * `--catalogo` is the output path and, when `--baseline` is absent, the diff
 * baseline too (today's behaviour). `--baseline` decouples the two: the diff is
 * compared against that file while the regenerated catalog is still written to
 * `--catalogo`. The daily workflow needs this because its baseline lives in a
 * temp directory while the output goes to `public/data` (T7/D7). An explicitly
 * passed baseline that is missing or unreadable is a failure, never a silent
 * `primeraCarga`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import {
  compararCatalogos,
  validarProductos,
} from './catalog-diff.ts'
import type { FechasDelRaw, ProductoLite, ReporteDiff, ResultadoValidacion } from './catalog-diff.ts'

const DEFAULT_RAW = 'raw-catalog.json'
const DEFAULT_CATALOGO = 'public/data/catalogo.json'
const SCRIPT_DIR = import.meta.dirname

interface Opciones {
  raw: string
  catalogo: string
  baseline: string | null
  esperado: number | null
  json: boolean
}

const USAGE = `Uso: node scripts/refresh-catalog.ts [raw.json] [opciones]

Valida la extracción cruda y, solo si pasa, corre normalize-catalog y
generate-index; al final imprime el reporte del refresh.

Opciones:
  --raw <path>        extracción cruda (default: ${DEFAULT_RAW}); también se acepta como primer argumento posicional
  --catalogo <path>   catálogo regenerado, destino de la escritura (default: ${DEFAULT_CATALOGO})
  --baseline <path>   catálogo contra el que se calcula el diff (default: el mismo que --catalogo).
                      Debe existir: si falta o no se puede leer, el CLI falla sin escribir nada
  --esperado <N>      conteo del oráculo GET /api/productos-cuantos; si el raw difiere, exit 2
  --json              imprime el reporte como un único objeto JSON (la prosa del pipeline va a stderr)
  --help              muestra esta ayuda y no ejecuta nada

Exit codes: 0 ok · 1 raw inválido (no se escribió nada) · 2 conteo ≠ --esperado · 3 falló un paso del pipeline`

function fail(code: number, msg: string): never {
  console.error(`refresh-catalog: ${msg}`)
  process.exit(code)
}

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseArgs(argv: string[]): Opciones | { help: true } {
  const opts: Opciones = {
    raw: DEFAULT_RAW,
    catalogo: DEFAULT_CATALOGO,
    baseline: null,
    esperado: null,
    json: false,
  }
  let rawFromFlag = false
  let rawFromPositional = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--json') {
      opts.json = true
    } else if (arg === '--raw') {
      const value = argv[++i]
      if (!value) fail(1, '--raw necesita un path')
      opts.raw = value
      rawFromFlag = true
    } else if (arg === '--catalogo') {
      const value = argv[++i]
      if (!value) fail(1, '--catalogo necesita un path')
      opts.catalogo = value
    } else if (arg === '--baseline') {
      const value = argv[++i]
      if (!value) fail(1, '--baseline necesita un path')
      opts.baseline = value
    } else if (arg === '--esperado') {
      const value = argv[++i]
      const n = Number(value)
      if (!value || !Number.isInteger(n) || n < 0) {
        fail(1, `--esperado necesita un entero >= 0 (recibí "${value ?? ''}")`)
      }
      opts.esperado = n
    } else if (arg.startsWith('--')) {
      fail(1, `opción desconocida: ${arg}`)
    } else if (rawFromPositional) {
      fail(1, `argumento de más: ${arg}`)
    } else {
      opts.raw = arg
      rawFromPositional = true
    }
  }

  if (rawFromFlag && rawFromPositional) {
    fail(1, 'el raw se pasó dos veces (posicional y --raw)')
  }
  return opts
}

/**
 * Reads the diff baseline. A missing file means "no previous catalog" ONLY for
 * the default (`--catalogo`) baseline, where `null` is today's `primeraCarga`.
 * An EXPLICIT `--baseline` must exist: silently treating it as absent would turn
 * every daily report into `primeraCarga` and destroy the one thing the diff is
 * for (T7/D7), so it fails loudly instead.
 */
function leerCatalogoVigente(path: string, requerido: boolean): ProductoLite[] | null {
  if (!existsSync(path)) {
    if (requerido) fail(3, `no existe el baseline: ${path}`)
    return null
  }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    // Deliberately no errno message: it can quote a path we did not choose.
    fail(3, `no se pudo leer el baseline: ${path}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    fail(3, `el catálogo vigente no es JSON válido: ${path}`)
  }
  if (!esObjetoPlano(parsed) || !Array.isArray(parsed.products)) {
    fail(3, `el catálogo vigente no tiene un array products: ${path}`)
  }
  return parsed.products as ProductoLite[]
}

/** Reads the raw extraction; invalid JSON is a validation failure (exit 1). */
function leerRaw(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    fail(1, `no se pudo leer el raw: ${path}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    // Deliberately do NOT echo the parser message: it can quote raw bytes,
    // and the raw contains the user's cost and margin.
    fail(1, `el raw no es JSON válido: ${path}`)
  }
}

/** `raw.products ?? raw` (an array, or an object with a `products` array). */
function extraerProductos(parsed: unknown): unknown {
  if (esObjetoPlano(parsed)) {
    const products = parsed.products
    if (products !== undefined && products !== null) return products
  }
  return parsed
}

/**
 * The extraction moment the raw itself carries (`generada`), or `null` when it
 * is absent or not a usable date — an old raw that predates the field has
 * neither. Anything that is not a string parsing as a date is treated as "no
 * date", never guessed from the clock here: the date must come from the data.
 */
function fechaDelRaw(parsed: unknown): string | null {
  if (!esObjetoPlano(parsed)) return null
  const generada = parsed.generada
  if (typeof generada !== 'string' || generada.trim() === '') return null
  return Number.isNaN(Date.parse(generada)) ? null : generada
}

/**
 * The raw's date fields, keyed by product id. Only string values are kept —
 * anything else is "no date". This is the evidence T12 exists to preserve:
 * `normalize` drops these fields and the runner's raw dies with the job.
 *
 * Read-only and log-safe: it never echoes a record, and the dates are
 * timestamps, not commercial data.
 */
function fechasDelRaw(parsed: unknown): Map<string, FechasDelRaw> {
  const fechas = new Map<string, FechasDelRaw>()
  const productos = extraerProductos(parsed)
  if (!Array.isArray(productos)) return fechas

  for (const registro of productos) {
    if (!esObjetoPlano(registro)) continue
    const id = typeof registro.id === 'string' ? registro.id.trim() : ''
    if (id === '') continue
    const actualizado = typeof registro.actualizado === 'string' ? registro.actualizado : null
    const precioCambiado = typeof registro.precioCambiado === 'string' ? registro.precioCambiado : null
    // A record with neither field is "without date" anyway: the absent entry
    // says the same thing and keeps the map small.
    if (actualizado === null && precioCambiado === null) continue
    fechas.set(id, { actualizado, precioCambiado })
  }
  return fechas
}

function imprimirErrores(resultado: ResultadoValidacion): void {
  console.error(
    `refresh-catalog: el raw no pasó la validación (conteo ${resultado.conteo}, ` +
      `${resultado.errores.length} error(es)); no se escribió nada`,
  )
  for (const e of resultado.errores) {
    console.error(`  - [${e.motivo}] ${e.detalle}`)
  }
}

/**
 * Runs one pipeline script. In prose mode its stdio is inherited (per D4); in
 * `--json` mode its stdout is routed to stderr so the report stays the only
 * thing on stdout. A non-zero exit is a pipeline failure (exit 3).
 */
function correrPipeline(script: string, args: string[], json: boolean): void {
  const resultado = json
    ? spawnSync(process.execPath, [join(SCRIPT_DIR, script), ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawnSync(process.execPath, [join(SCRIPT_DIR, script), ...args], { stdio: 'inherit' })

  if (json) {
    // Keep the pipeline's own diagnostics visible, but on stderr: stdout must
    // stay a single JSON object for `--json` consumers.
    if (resultado.stdout) process.stderr.write(resultado.stdout)
    if (resultado.stderr) process.stderr.write(resultado.stderr)
  }
  if (resultado.error) {
    fail(3, `no se pudo ejecutar ${script}: ${resultado.error.message}`)
  }
  if (resultado.status !== 0) {
    const motivo = resultado.signal ? `señal ${resultado.signal}` : `exit ${resultado.status ?? '?'}`
    fail(3, `${script} falló (${motivo})`)
  }
}

function leerProductosEscritos(path: string): ProductoLite[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(3, `el catálogo recién escrito no es legible: ${path}`)
  }
  if (!esObjetoPlano(parsed) || !Array.isArray(parsed.products)) {
    fail(3, `el catálogo recién escrito no tiene un array products: ${path}`)
  }
  return parsed.products as ProductoLite[]
}

function pct(n: number | null): string {
  return n === null ? 'n/d' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

/** ` · actualizado <x> · precioCambiado <y>` for whichever dates exist. */
function fechasDeEjemplo(c: { actualizado?: string; precioCambiado?: string }): string {
  let s = ''
  if (c.actualizado) s += ` · actualizado ${c.actualizado}`
  if (c.precioCambiado) s += ` · precioCambiado ${c.precioCambiado}`
  return s
}

function imprimirReporte(r: ReporteDiff): void {
  const lineas: string[] = []
  if (r.primeraCarga) {
    lineas.push('refresh-catalog: primer refresh (no había catálogo previo para comparar)')
    lineas.push(`  catálogo: ${r.nextConteo} productos`)
    lineas.push(
      `  cobertura EAN: ${r.coberturaEan.next}/${r.nextConteo} (${r.coberturaEan.nextPorcentaje.toFixed(2)}%)`,
    )
  } else {
    lineas.push(
      `refresh-catalog: ${r.prevConteo} → ${r.nextConteo} productos (delta ${r.deltaConteo! >= 0 ? '+' : ''}${r.deltaConteo})`,
    )
    lineas.push(`  altas: ${r.altas.conteo}`)
    for (const a of r.altas.ejemplos) lineas.push(`    + ${a.id} ${a.nombre} (EAN ${a.barcode || '—'})`)
    lineas.push(`  bajas: ${r.bajas.conteo}`)
    for (const b of r.bajas.ejemplos) lineas.push(`    - ${b.id} ${b.nombre} (EAN ${b.barcode || '—'})`)
    lineas.push(
      `  ids huérfanos (rompen favoritos): ${r.idsHuerfanos.conteo}` +
        (r.idsHuerfanos.truncado ? ` (en --json se listan ${r.idsHuerfanos.valores.length})` : ''),
    )
    for (const id of r.idsHuerfanos.valores.slice(0, 10)) lineas.push(`    ! ${id}`)
    lineas.push(
      `  cambios de precio: ${r.cambiosDePrecio.conteo} (sin base para %: ${r.cambiosDePrecio.conBaseCero})`,
    )
    lineas.push(
      `    mediana ${pct(r.cambiosDePrecio.mediana)} · máximo ${pct(r.cambiosDePrecio.maximo)}`,
    )
    for (const c of r.cambiosDePrecio.top10) {
      lineas.push(`    ${pct(c.pct)} ${c.id} (${c.precioPrev} → ${c.precioNext})`)
    }
    // The anomalies, annotated: without this line a big change is bare, and a
    // reader cannot tell a drifted price from a real correction (risk R7).
    const g = r.cambiosGrandes
    lineas.push(
      `  cambios grandes (>${g.umbralPct}%): ${g.conteo}` +
        (g.fechasDisponibles
          ? ` — con fecha de cambio registrada: ${g.conFechaDeCambio} · sin fecha: ${g.sinFechaDeCambio}`
          : ' — sin fechas del raw: no se puede saber si traen un cambio registrado'),
    )
    for (const c of g.ejemplos) {
      lineas.push(
        `    ${pct(c.pct)} ${c.id} (${c.precioPrev} → ${c.precioNext})${fechasDeEjemplo(c)}`,
      )
    }
    lineas.push(
      `  cobertura EAN: prev ${r.coberturaEan.prev}/${r.prevConteo} (${r.coberturaEan.prevPorcentaje!.toFixed(2)}%) → ` +
        `next ${r.coberturaEan.next}/${r.nextConteo} (${r.coberturaEan.nextPorcentaje.toFixed(2)}%)`,
    )
    lineas.push(
      `  EANs desaparecidos: ${r.coberturaEan.barcodesDesaparecidos.conteo}` +
        (r.coberturaEan.barcodesDesaparecidos.truncado
          ? ` (en --json se listan ${r.coberturaEan.barcodesDesaparecidos.valores.length})`
          : ''),
    )
    for (const ean of r.coberturaEan.barcodesDesaparecidos.valores.slice(0, 10)) lineas.push(`    ! ${ean}`)
    lineas.push(`  categorias nuevas: ${r.categoriasAltas.length ? r.categoriasAltas.join(', ') : '—'}`)
    lineas.push(`  categorias desaparecidas: ${r.categoriasBajas.length ? r.categoriasBajas.join(', ') : '—'}`)
  }
  console.log(lineas.join('\n'))
}

function main(): void {
  const parsedArgs = parseArgs(process.argv.slice(2))
  if ('help' in parsedArgs) {
    console.log(USAGE)
    return
  }
  const opts = parsedArgs
  const rawPath = resolve(opts.raw)
  const catalogoPath = resolve(opts.catalogo)
  // `--baseline` is optional: absent means "the output path is the baseline too",
  // which is exactly what this CLI did before the flag existed.
  const baselinePath = opts.baseline === null ? catalogoPath : resolve(opts.baseline)

  // 1. Baseline first, so the diff has something to compare against. An explicit
  //    baseline that does not exist is fatal here — before the raw is read and
  //    long before anything is written.
  const prev = leerCatalogoVigente(baselinePath, opts.baseline !== null)

  // 2. Read the raw.
  const parsedRaw = leerRaw(rawPath)

  // 3. Validate before writing. A count mismatch is its own exit code.
  const resultado = validarProductos(extraerProductos(parsedRaw), { esperado: opts.esperado })
  if (!resultado.ok) {
    imprimirErrores(resultado)
    const soloConteo = resultado.errores.every((e) => e.motivo === 'conteo-esperado')
    process.exit(soloConteo ? 2 : 1)
  }

  // Diagnostic, on stderr so it can never mix with the `--json` report on
  // stdout: what `normalize` is about to exclude. The raw count and the oracle
  // count matching says nothing about how many records survive.
  console.error(
    `refresh-catalog: raw válido — ${resultado.conteo} registros ` +
      `(${resultado.sinPrecio} sin precio, ${resultado.precioNoPositivo} con precio ≤ 0: ` +
      `${resultado.sinPrecio + resultado.precioNoPositivo} quedan fuera del catálogo)`,
  )

  // 4. Pipeline, by subprocess (D4). The extraction date, when the raw has
  //    one, is passed to `generate-index` as `--generada` so it lands in the
  //    facets ONLY — never in `catalogo.json`, whose sha256 keys the client
  //    cache. Without a usable date, no flag and no field, which keeps the
  //    output byte-identical to the pre-T10 pipeline.
  const generada = fechaDelRaw(parsedRaw)
  correrPipeline('normalize-catalog.ts', [rawPath, catalogoPath], opts.json)
  correrPipeline(
    'generate-index.ts',
    [catalogoPath, dirname(catalogoPath), ...(generada === null ? [] : ['--generada', generada])],
    opts.json,
  )

  // 5. Re-read what was produced and report. The date map built from the raw
  //    is passed along: the raw is ephemeral, so this report is the only place
  //    those dates survive (T12).
  const next = leerProductosEscritos(catalogoPath)
  const reporte = compararCatalogos(prev, next, { fechas: fechasDelRaw(parsedRaw) })

  if (opts.json) {
    console.log(JSON.stringify(reporte))
  } else {
    imprimirReporte(reporte)
  }
}

main()
