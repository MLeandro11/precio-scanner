#!/usr/bin/env node
/**
 * catalog-diff.ts — catalog validation and refresh comparison, all pure.
 *
 * This module is deliberately I/O-free: no `fs`, no `child_process`, no
 * `process.exit`. It is the vocabulary the refresh CLI speaks (decision D5 of
 * the `catalog-refresh` spec), and the only place the diff math lives.
 *
 * Two entry points:
 *   - `validarProductos(productos, { esperado })` — shape/count/duplicate
 *     validation of a raw extraction, including the exact-count check against
 *     the `GET /api/productos-cuantos` oracle. It compares the RAW record
 *     count, because that is what the oracle counts; exclusions happen later,
 *     in `normalize-catalog`.
 *   - `compararCatalogos(prev, next)` — the refresh report: what was added,
 *     removed, orphaned, repriced, and which EANs disappeared.
 *
 * Log hygiene note: validation diagnostics never echo a record (the raw
 * carries the user's cost and margin). Only the reason and the offending
 * index/field are reported.
 */

/** The minimal product the report works with (same shape as `public/data`). */
export interface ProductoLite {
  id: string
  nombre: string
  marca: string
  categoria: string
  barcode: string
  precio: number
}

/** Machine-readable validation reasons. Distinct so CI can branch on them. */
export type MotivoValidacion =
  | 'no-es-array'
  | 'registro-no-objeto'
  | 'id-ausente'
  | 'id-no-string'
  | 'id-vacio'
  | 'nombre-ausente'
  | 'nombre-no-string'
  | 'nombre-vacio'
  | 'precio-no-numerico'
  | 'barcode-no-string'
  | 'categoria-no-string'
  | 'marca-no-string'
  | 'id-duplicado'
  | 'conteo-esperado'

export interface ValidacionError {
  motivo: MotivoValidacion
  /** Index of the offending record, when the error is per-record. */
  indice?: number
  /** Every occurrence index, for `id-duplicado` (all occurrences, not just the 2nd). */
  indices?: number[]
  /** The raw count, for `conteo-esperado`. */
  conteo?: number
  /** The oracle count, for `conteo-esperado`. */
  esperado?: number
  /** Human-readable detail; never contains the whole record. */
  detalle: string
}

export interface ResultadoValidacion {
  ok: boolean
  /** Raw input record count — the oracle compares against THIS number. */
  conteo: number
  errores: ValidacionError[]
  /** Ids appearing more than once, in first-seen order. */
  idsDuplicados: string[]
  /** Records with no `precio`: NOT an error, `normalize` excludes them. */
  sinPrecio: number
  /** Records whose `precio` is <= 0: NOT an error, `normalize` excludes them. */
  precioNoPositivo: number
}

export interface EjemploProducto {
  id: string
  nombre: string
  barcode: string
}

export interface ConteoConEjemplos {
  conteo: number
  ejemplos: EjemploProducto[]
}

export interface CambioDePrecio {
  id: string
  nombre: string
  precioPrev: number
  precioNext: number
  /** Percentage change vs. the previous price (0.1 means +0.1%). */
  pct: number
}

/**
 * The raw's own date fields for one product. `precioCambiado` is the "the
 * price changed on this date" marker; `actualizado` is "last write of the
 * record" and is context only — measured as uniformly recent in the real raw,
 * so it never decides anything.
 */
export interface FechasDelRaw {
  actualizado?: string | null
  precioCambiado?: string | null
}

/** One big price change, annotated with whatever dates the raw had. */
export interface CambioGrande {
  id: string
  nombre: string
  pct: number
  precioPrev: number
  precioNext: number
  actualizado?: string
  precioCambiado?: string
}

/**
 * A price change is "big" above this absolute percentage. Exported so the
 * report can state the threshold it applied instead of leaving the number a
 * mystery.
 */
export const UMBRAL_GRANDE = 50

/**
 * A list the report keeps bounded: the exact count is always present, the
 * values are capped. `--json` feeds an issue body, so an unbounded list of
 * 20k orphans must not become a megabyte of payload.
 */
export interface ListaAcotada {
  conteo: number
  truncado: boolean
  valores: string[]
}

export interface ReporteDiff {
  /** `true` when there was no previous catalog to diff against. */
  primeraCarga: boolean
  prevConteo: number | null
  nextConteo: number
  deltaConteo: number | null
  altas: ConteoConEjemplos
  bajas: ConteoConEjemplos
  /** Ids present in `prev` but not in `next` (they orphan a user's favorites). */
  idsHuerfanos: ListaAcotada
  cambiosDePrecio: {
    /** Products whose price changed (including zero-baseline ones). */
    conteo: number
    /** Of those, how many had a previous price of 0 (pct not computable). */
    conBaseCero: number
    mediana: number | null
    /** Largest signed percentage change. */
    maximo: number | null
    top10: CambioDePrecio[]
  }
  /**
   * The anomalies, annotated. A naked "44 big changes" cannot be judged; with
   * the raw's own dates a reader can tell whether a change was recorded as a
   * price change or is unexplained (risk R7).
   */
  cambiosGrandes: {
    /** The threshold used, in percent, so the number is never a mystery. */
    umbralPct: number
    conteo: number
    /** Of those, how many carry a `precioCambiado` in the raw. `null` when we had no dates at all. */
    conFechaDeCambio: number | null
    sinFechaDeCambio: number | null
    /** `false` when no date map was supplied — so a reader never mistakes "unknown" for "zero". */
    fechasDisponibles: boolean
    /** Up to 10, ordered by absolute percentage change, each with whatever dates exist. */
    ejemplos: CambioGrande[]
  }
  coberturaEan: {
    prev: number
    next: number
    prevPorcentaje: number | null
    nextPorcentaje: number
    /** EANs present in `prev` but not `next` (they break EAN-keyed lists). */
    barcodesDesaparecidos: ListaAcotada
  }
  categoriasAltas: string[]
  categoriasBajas: string[]
}

const MAX_EJEMPLOS = 10
/** Cap for the two lists that can grow with the catalog itself. */
export const MAX_LISTA = 200

function acotar(valores: string[]): ListaAcotada {
  return {
    conteo: valores.length,
    truncado: valores.length > MAX_LISTA,
    valores: valores.slice(0, MAX_LISTA),
  }
}

/** Same numeric shape `normalize-catalog` accepts for an included record. */
const NUMBER_RE = /^-?\d+(?:[.,]\d+)?$/

/**
 * The price as `normalize-catalog` would read it, or `null` when it is not a
 * price at all. Mirrors its contract on purpose: `null`/absent means "the
 * record gets excluded", not "the extraction broke".
 */
function precioNumerico(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.trim().replace(',', '.')
    return NUMBER_RE.test(s) ? Number(s) : null
  }
  return null
}

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function noVacio(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * Validates a raw extraction. Never mutates `productos`.
 *
 * `opts.esperado` is the oracle count from `GET /api/productos-cuantos`; when
 * it is a number, a raw count that differs is an error with its own motivo.
 * The comparison is against the raw record count — exclusions applied later by
 * `normalize-catalog` are irrelevant here.
 */
export function validarProductos(
  productos: unknown,
  opts?: { esperado?: number | null },
): ResultadoValidacion {
  const errores: ValidacionError[] = []
  const idsDuplicados: string[] = []

  if (!Array.isArray(productos)) {
    errores.push({
      motivo: 'no-es-array',
      detalle: 'la entrada no es un array de productos',
    })
    return { ok: false, conteo: 0, errores, idsDuplicados, sinPrecio: 0, precioNoPositivo: 0 }
  }

  const conteo = productos.length
  const ocurrenciasPorId = new Map<string, number[]>()
  let sinPrecio = 0
  let precioNoPositivo = 0

  productos.forEach((registro, i) => {
    if (!esObjetoPlano(registro)) {
      errores.push({
        motivo: 'registro-no-objeto',
        indice: i,
        detalle: `registro ${i}: no es un objeto`,
      })
      return
    }

    // id — missing / non-string / empty are distinct reasons.
    const id = registro.id
    if (id === undefined || id === null) {
      errores.push({ motivo: 'id-ausente', indice: i, detalle: `registro ${i}: falta id` })
    } else if (typeof id !== 'string') {
      errores.push({ motivo: 'id-no-string', indice: i, detalle: `registro ${i}: id no es string` })
    } else if (id.trim() === '') {
      errores.push({ motivo: 'id-vacio', indice: i, detalle: `registro ${i}: id vacío` })
    } else {
      const prev = ocurrenciasPorId.get(id)
      if (prev) prev.push(i)
      else ocurrenciasPorId.set(id, [i])
    }

    // nombre — missing / non-string / empty are distinct reasons.
    const nombre = registro.nombre
    if (nombre === undefined || nombre === null) {
      errores.push({ motivo: 'nombre-ausente', indice: i, detalle: `registro ${i}: falta nombre` })
    } else if (typeof nombre !== 'string') {
      errores.push({ motivo: 'nombre-no-string', indice: i, detalle: `registro ${i}: nombre no es string` })
    } else if (nombre.trim() === '') {
      errores.push({ motivo: 'nombre-vacio', indice: i, detalle: `registro ${i}: nombre vacío` })
    }

    // precio — mirrors `normalize-catalog`'s own contract instead of being
    // stricter than the pipeline that consumes it:
    //   absent / null   -> the record is excluded later; counted, not an error
    //   <= 0            -> excluded later (`precio <= 0`); counted, not an error
    //   numeric string  -> accepted there, so accepted here
    //   anything else   -> a real shape change, and the only failure case
    const precio = registro.precio
    if (precio === undefined || precio === null) {
      sinPrecio++
    } else {
      const n = precioNumerico(precio)
      if (n === null) {
        errores.push({
          motivo: 'precio-no-numerico',
          indice: i,
          detalle: `registro ${i}: precio no es numérico (${typeof precio})`,
        })
      } else if (n <= 0) {
        precioNoPositivo++
      }
    }

    // Optional string fields: absent / null is fine, a wrong type is not.
    const opcionales: Array<[MotivoValidacion, unknown]> = [
      ['barcode-no-string', registro.barcode],
      ['categoria-no-string', registro.categoria],
      ['marca-no-string', registro.marca],
    ]
    for (const [motivo, valor] of opcionales) {
      if (valor === undefined || valor === null) continue
      if (typeof valor !== 'string') {
        const campo = motivo.replace('-no-string', '')
        errores.push({ motivo, indice: i, detalle: `registro ${i}: ${campo} no es string` })
      }
    }
  })

  for (const [id, indices] of ocurrenciasPorId) {
    if (indices.length > 1) {
      idsDuplicados.push(id)
      errores.push({
        motivo: 'id-duplicado',
        indice: indices[0],
        indices,
        detalle: `id duplicado "${id}" (ocurre ${indices.length} veces en los índices ${indices.join(', ')})`,
      })
    }
  }

  if (typeof opts?.esperado === 'number' && Number.isFinite(opts.esperado) && conteo !== opts.esperado) {
    errores.push({
      motivo: 'conteo-esperado',
      conteo,
      esperado: opts.esperado,
      detalle: `el raw tiene ${conteo} registros y el oráculo esperaba ${opts.esperado}`,
    })
  }

  return { ok: errores.length === 0, conteo, errores, idsDuplicados, sinPrecio, precioNoPositivo }
}

function eanDe(p: ProductoLite): string {
  return typeof p.barcode === 'string' ? p.barcode.trim() : ''
}

function contarEan(productos: ProductoLite[]): number {
  return productos.reduce((n, p) => (eanDe(p) !== '' ? n + 1 : n), 0)
}

function porcentaje(parte: number, total: number): number {
  return total === 0 ? 0 : (parte / total) * 100
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const orden = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  return orden.length % 2 === 1 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2
}

function ejemplos(productos: ProductoLite[]): EjemploProducto[] {
  return productos
    .slice(0, MAX_EJEMPLOS)
    .map((p) => ({ id: p.id, nombre: p.nombre, barcode: p.barcode }))
}

function eansUnicos(productos: ProductoLite[]): string[] {
  const vistos = new Set<string>()
  const items: string[] = []
  for (const p of productos) {
    const ean = eanDe(p)
    if (ean !== '' && !vistos.has(ean)) {
      vistos.add(ean)
      items.push(ean)
    }
  }
  return items
}

function categoriasUnicas(productos: ProductoLite[]): string[] {
  const vistos = new Set<string>()
  for (const p of productos) {
    const cat = typeof p.categoria === 'string' ? p.categoria.trim() : ''
    if (cat !== '') vistos.add(cat)
  }
  return [...vistos]
}

/** A non-empty string, trimmed; the raw's dates arrive as strings or not at all. */
function textoDeFecha(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

/**
 * Builds the `cambiosGrandes` section. `fechas === null` means no date map was
 * supplied, and the counts are then `null` on purpose: reporting 0 would claim
 * a measurement nobody made.
 */
function seccionCambiosGrandes(
  cambios: CambioDePrecio[],
  fechas: Map<string, FechasDelRaw> | null,
): ReporteDiff['cambiosGrandes'] {
  const fechasDisponibles = fechas !== null
  // Reuses the exact percentage already computed for `cambiosDePrecio`; a
  // zero baseline never reaches `cambios`, so it is excluded here too.
  const grandes = cambios.filter((c) => Math.abs(c.pct) > UMBRAL_GRANDE)
  const ordenados = [...grandes].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))

  let conFecha = 0
  if (fechas) {
    for (const c of grandes) {
      if (textoDeFecha(fechas.get(c.id)?.precioCambiado) !== null) conFecha++
    }
  }

  const ejemplos: CambioGrande[] = ordenados.slice(0, MAX_EJEMPLOS).map((c) => {
    const e: CambioGrande = {
      id: c.id,
      nombre: c.nombre,
      pct: c.pct,
      precioPrev: c.precioPrev,
      precioNext: c.precioNext,
    }
    const f = fechas?.get(c.id)
    const actualizado = textoDeFecha(f?.actualizado)
    const precioCambiado = textoDeFecha(f?.precioCambiado)
    if (actualizado !== null) e.actualizado = actualizado
    // `actualizado` is carried as context only; it never decides `conFecha`.
    if (precioCambiado !== null) e.precioCambiado = precioCambiado
    return e
  })

  return {
    umbralPct: UMBRAL_GRANDE,
    conteo: grandes.length,
    conFechaDeCambio: fechasDisponibles ? conFecha : null,
    sinFechaDeCambio: fechasDisponibles ? grandes.length - conFecha : null,
    fechasDisponibles,
    ejemplos,
  }
}

/**
 * Compares two catalogs and returns the refresh report. Pure: neither array is
 * mutated. `prev === null` means "first refresh" and is reported as such —
 * never as if every product were a new `alta`.
 *
 * `opts.fechas` maps a product id to the raw's date fields. Its absence is a
 * fact the report states (`fechasDisponibles: false`) rather than hides.
 */
export function compararCatalogos(
  prev: ProductoLite[] | null,
  next: ProductoLite[],
  opts?: { fechas?: Map<string, FechasDelRaw> | null },
): ReporteDiff {
  const fechas = opts?.fechas ?? null
  const nextConteo = next.length
  const coberturaNext = contarEan(next)

  if (prev === null) {
    return {
      primeraCarga: true,
      prevConteo: null,
      nextConteo,
      deltaConteo: null,
      altas: { conteo: 0, ejemplos: [] },
      bajas: { conteo: 0, ejemplos: [] },
      idsHuerfanos: acotar([]),
      cambiosDePrecio: { conteo: 0, conBaseCero: 0, mediana: null, maximo: null, top10: [] },
      cambiosGrandes: seccionCambiosGrandes([], fechas),
      coberturaEan: {
        prev: 0,
        next: coberturaNext,
        prevPorcentaje: null,
        nextPorcentaje: porcentaje(coberturaNext, nextConteo),
        barcodesDesaparecidos: acotar([]),
      },
      categoriasAltas: [],
      categoriasBajas: [],
    }
  }

  const prevPorId = new Map(prev.map((p) => [p.id, p]))
  const nextPorId = new Map(next.map((p) => [p.id, p]))

  const altasLista = next.filter((p) => !prevPorId.has(p.id))
  const bajasLista = prev.filter((p) => !nextPorId.has(p.id))

  const cambios: CambioDePrecio[] = []
  let conBaseCero = 0
  for (const [id, p] of prevPorId) {
    const n = nextPorId.get(id)
    if (!n || n.precio === p.precio) continue
    if (p.precio === 0) {
      // Division-by-zero guard: the change is real but the percentage is not.
      conBaseCero++
      continue
    }
    cambios.push({
      id,
      nombre: n.nombre,
      precioPrev: p.precio,
      precioNext: n.precio,
      pct: ((n.precio - p.precio) / p.precio) * 100,
    })
  }

  const pcts = cambios.map((c) => c.pct)
  const top10 = [...cambios].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, MAX_EJEMPLOS)

  const prevEan = eansUnicos(prev)
  const nextEan = new Set(eansUnicos(next))
  const barcodesDesaparecidos = prevEan.filter((ean) => !nextEan.has(ean))

  const prevCategorias = new Set(categoriasUnicas(prev))
  const nextCategorias = new Set(categoriasUnicas(next))

  return {
    primeraCarga: false,
    prevConteo: prev.length,
    nextConteo,
    deltaConteo: nextConteo - prev.length,
    altas: { conteo: altasLista.length, ejemplos: ejemplos(altasLista) },
    bajas: { conteo: bajasLista.length, ejemplos: ejemplos(bajasLista) },
    // Same id set as `bajas`, as plain ids: these are the ones that orphan favorites.
    idsHuerfanos: acotar(bajasLista.map((p) => p.id)),
    cambiosDePrecio: {
      conteo: cambios.length + conBaseCero,
      conBaseCero,
      mediana: mediana(pcts),
      maximo: pcts.length === 0 ? null : pcts.reduce((a, b) => (b > a ? b : a)),
      top10,
    },
    cambiosGrandes: seccionCambiosGrandes(cambios, fechas),
    coberturaEan: {
      prev: contarEan(prev),
      next: coberturaNext,
      prevPorcentaje: porcentaje(contarEan(prev), prev.length),
      nextPorcentaje: porcentaje(coberturaNext, nextConteo),
      barcodesDesaparecidos: acotar(barcodesDesaparecidos),
    },
    categoriasAltas: [...nextCategorias].filter((c) => !prevCategorias.has(c)).sort(),
    categoriasBajas: [...prevCategorias].filter((c) => !nextCategorias.has(c)).sort(),
  }
}
