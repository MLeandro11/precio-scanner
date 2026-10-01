#!/usr/bin/env node
/**
 * tune-threshold.ts — Fuse threshold sweep against the real catalog (WU7.1).
 *
 * `src/lib/searchEngine.ts` holds the fuzzy-match options; this script imports that
 * exact object and rebuilds the engine once per candidate `threshold`, so the sweep
 * measures what the app ships rather than a copy that can drift from it.
 *
 * Since 7.7 the shipped engine uses Fuse's extended search, so EVERY query below is
 * searched through the shipped path: `buildQueryPattern(q.query)` neutralizes each user
 * token into a literal term and joins them with the space separator (AND). A SAFETY block
 * then proves, at the production threshold, that adversarial single tokens still resolve
 * to exactly what the pre-7.7 raw parser returns.
 *
 * For every query in `scripts/tuning-queries.ts` it reports the rank of the first result
 * whose name matches the query's expectation, plus the total match count. A higher
 * threshold is looser: better recall, more noise. The useful answer is the TIGHTEST
 * threshold that still surfaces the expectation inside the evaluation window.
 *
 * Usage:
 *   node scripts/tune-threshold.ts [--top N] [--sweep a,b,c] [--limit N]
 *
 *   --top    evaluation window; expectations must land inside it (default 10)
 *   --sweep  candidate thresholds (default 0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5)
 *   --limit  results fetched per query, so a rank outside `top` is still visible
 *            (default 50, the app's DEFAULT_LIMIT)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Fuse from 'fuse.js'
import { FUSE_OPTIONS, DEFAULT_LIMIT, buildQueryPattern } from '../src/lib/searchEngine.ts'
import { ALL_QUERIES, OPERATOR_PROBES } from './tuning-queries.ts'
import type { Catalog, Producto } from '../src/lib/types.ts'

const DEFAULT_SWEEP = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]

/** Fuse's extended-search metacharacters: a token carrying one of these is adversarial. */
const META_RE = /['$!=^|"\\]/

interface Args {
  top: number
  sweep: number[]
  limit: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = { top: 10, sweep: DEFAULT_SWEEP, limit: DEFAULT_LIMIT }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--top' && value) {
      args.top = Number(value)
      i += 1
    } else if (flag === '--limit' && value) {
      args.limit = Number(value)
      i += 1
    } else if (flag === '--sweep' && value) {
      args.sweep = value.split(',').map((t) => Number(t.trim()))
      i += 1
    }
  }
  return args
}

/** Engine construction mirrors `createEngine`, but with a variable threshold. */
function engineAt(products: Producto[], index: unknown, threshold: number): Fuse<Producto> {
  const serialized = (index as { fuseIndex?: unknown } | null)?.fuseIndex ?? index
  return new Fuse<Producto>(
    products,
    { ...FUSE_OPTIONS, threshold },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Fuse.parseIndex<Producto>(serialized as any),
  )
}

/**
 * The pre-7.7 reference engine: same products, same serialized index and same options,
 * only `useExtendedSearch` back to false. A single user token must behave identically
 * here and in the shipped engine — that equivalence is the whole safety proof.
 */
function rawEngineAt(products: Producto[], index: unknown, threshold: number): Fuse<Producto> {
  const serialized = (index as { fuseIndex?: unknown } | null)?.fuseIndex ?? index
  return new Fuse<Producto>(
    products,
    { ...FUSE_OPTIONS, threshold, useExtendedSearch: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Fuse.parseIndex<Producto>(serialized as any),
  )
}

/**
 * The catalog's own adversarial tokens: every distinct whitespace token of every `nombre`
 * that carries one of Fuse's extended-search metacharacters. Pure and derived from the
 * shipped data, so the safety set cannot drift away from the catalog.
 */
export function catalogMetacharTokens(products: Producto[]): string[] {
  const tokens = new Set<string>()
  for (const product of products) {
    const nombre = String(product.nombre ?? '')
    if (!META_RE.test(nombre)) continue
    for (const token of nombre.split(/\s+/)) {
      if (token && META_RE.test(token)) tokens.add(token)
    }
  }
  return [...tokens]
}

interface SafetyRow {
  token: string
  escapedTotal: number
  rawTotal: number
  ok: boolean
}

/**
 * The 7.7 safety proof at the production threshold: every adversarial single token must
 * return exactly what the pre-7.7 raw (non-extended) engine returns. Equivalence is the
 * evidence, not a maximum-total ceiling: a ceiling catches the exploding direction
 * (`!coca` -> all 20,294 products) and stays blind to the collapsing one (`=coca` -> 0),
 * and both are the same bug — input read as a query language.
 */
function runSafetyBlock(
  products: Producto[],
  index: unknown,
): { ok: boolean; rows: SafetyRow[] } {
  const shipped = engineAt(products, index, FUSE_OPTIONS.threshold)
  const raw = rawEngineAt(products, index, FUSE_OPTIONS.threshold)
  const tokens = [...OPERATOR_PROBES, ...catalogMetacharTokens(products)]
  const rows = tokens.map((token) => {
    const escapedTotal = shipped.search(buildQueryPattern(token)).length
    const rawTotal = raw.search(token).length
    return { token, escapedTotal, rawTotal, ok: escapedTotal === rawTotal }
  })
  return { ok: rows.every((row) => row.ok), rows }
}

/**
 * Rank (1-based) of the first result whose name matches the expectation, searching the
 * results in Fuse's relevance order. `null` when nothing inside `limit` matches.
 */
function rankOf(results: Producto[], expect: RegExp): number | null {
  const at = results.findIndex((p) => expect.test(p.nombre))
  return at === -1 ? null : at + 1
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const catalogPath = resolve('public/data/catalogo.json')
  const indexPath = resolve('public/data/catalogo-index.json')

  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Catalog
  const index: unknown = JSON.parse(readFileSync(indexPath, 'utf8'))

  if (ALL_QUERIES.length === 0) {
    console.log('No queries to run. Add some to scripts/tuning-queries.ts.')
    return
  }

  console.log(
    `${catalog.products.length} products · ${ALL_QUERIES.length} queries · ` +
      `evaluation window: top ${args.top} · current production threshold: ${FUSE_OPTIONS.threshold}`,
  )
  console.log()

  // rank[thresholdIndex][queryIndex]
  const ranks: Array<Array<number | null>> = []
  const totals: Array<number[]> = []
  // precision[thresholdIndex][queryIndex] — expected results inside the window, as a raw
  // count over the FIXED window size. Rank alone hides pollution: a query can hit #1 and
  // still fill positions 2..N with results that ignore half the query.
  //
  // The denominator is `args.top`, never the number of results returned. A ratio over the
  // returned count reports a threshold that truncates the set down to one correct hit as
  // "100% precision", which is the opposite of what it is.
  const precisions: number[][] = []

  for (const threshold of args.sweep) {
    const fuse = engineAt(catalog.products, index, threshold)
    const column: Array<number | null> = []
    const counts: number[] = []
    const window: number[] = []
    for (const q of ALL_QUERIES) {
      const pattern = buildQueryPattern(q.query)
      const raw = fuse.search(pattern, { limit: args.limit })
      const items = raw.map((r) => r.item)
      column.push(rankOf(items, q.expect))
      const topN = items.slice(0, args.top)
      window.push(topN.filter((p) => q.expect.test(p.nombre)).length)
      // total matches, independent of the fetch limit
      counts.push(fuse.search(pattern).length)
    }
    ranks.push(column)
    totals.push(counts)
    precisions.push(window)
  }

  const labelWidth = Math.max(...ALL_QUERIES.map((q) => q.query.length)) + 2
  console.log(pad('query', labelWidth) + args.sweep.map((t) => pad(String(t), 9)).join(''))
  console.log('-'.repeat(labelWidth + args.sweep.length * 9))

  ALL_QUERIES.forEach((q, qi) => {
    const cells = args.sweep.map((_, ti) => {
      const rank = ranks[ti][qi]
      // a rank beyond the window is not a pass — mark it so the column reads honestly
      if (rank === null) return 'missing'
      return rank <= args.top ? `#${rank}` : `#${rank} out`
    })
    console.log(pad(`${q.query}`, labelWidth) + cells.map((c) => pad(c, 9)).join(''))
  })

  console.log()
  console.log(`precision — expected results inside the top ${args.top} (n/${args.top})`)
  console.log(pad('query', labelWidth) + args.sweep.map((t) => pad(String(t), 9)).join(''))
  console.log('-'.repeat(labelWidth + args.sweep.length * 9))
  ALL_QUERIES.forEach((q, qi) => {
    const cells = args.sweep.map((_, ti) => `${precisions[ti][qi]}/${args.top}`)
    console.log(pad(q.query, labelWidth) + cells.map((c) => pad(c, 9)).join(''))
  })

  console.log()
  console.log(pad('matches (total)', labelWidth) + args.sweep.map((_, ti) => pad(String(totals[ti].reduce((a, b) => a + b, 0)), 9)).join(''))

  // SAFETY: prove the shipped extended path reads adversarial single tokens literally.
  const safety = runSafetyBlock(catalog.products, index)
  const catalogProbes = safety.rows.length - OPERATOR_PROBES.length
  console.log()
  console.log(
    'SAFETY — operator and catalog metacharacter tokens are LITERAL at the production threshold',
  )
  console.log('  This is a proof of literal behaviour: the escaped (shipped) path must return the')
  console.log('  same match count as the raw pre-7.7 engine, for every probe. Both failure')
  console.log('  directions matter — `!coca` explodes to all products while `=coca` collapses to')
  console.log('  0 — so a max-total ceiling would only catch the exploding one.')
  const safetyLabelWidth = Math.max(labelWidth, ...safety.rows.map((r) => r.token.length + 2))
  console.log(pad('token', safetyLabelWidth) + pad('escaped', 10) + pad('raw', 10) + 'ok')
  console.log('-'.repeat(safetyLabelWidth + 22))
  for (const row of safety.rows) {
    console.log(
      pad(`"${row.token}"`, safetyLabelWidth) +
        pad(String(row.escapedTotal), 10) +
        pad(String(row.rawTotal), 10) +
        (row.ok ? 'ok' : 'MISMATCH'),
    )
  }
  console.log(
    `${safety.rows.length} probes (${OPERATOR_PROBES.length} operator + ${catalogProbes} from the catalog) — ` +
      (safety.ok ? 'every probe literal' : 'MISMATCH: input is being read as a query language'),
  )

  // The tightest threshold that still satisfies every expectation inside the window.
  const passing = args.sweep.filter((_, ti) =>
    ranks[ti].every((rank) => rank !== null && rank <= args.top),
  )
  const failing = args.sweep.filter((t) => !passing.includes(t))
  const tightest = passing.length ? Math.min(...passing) : null

  console.log()
  const production = FUSE_OPTIONS.threshold

  if (!safety.ok) {
    // A passing threshold here would be a lie: the rank/precision tables above measure a
    // parser that reads user input as a query language.
    const bad = safety.rows.filter((row) => !row.ok)
    console.log('VERDICT: META-SAFETY FAILED — no threshold verdict is reported.')
    console.log(
      `  ${bad.length} probe(s) differ from the raw engine, e.g. "${bad[0].token}": ` +
        `escaped ${bad[0].escapedTotal} vs raw ${bad[0].rawTotal}.`,
    )
    console.log('  Fix the escaping before trusting any rank or precision number above.')
  } else if (passing.length === 0) {
    console.log('VERDICT: no candidate threshold satisfies every expectation.')
    console.log('  Either the expectation is unreachable in this catalog, or the options')
    console.log('  themselves (keys/weights/ignoreLocation) need revisiting, not just the')
    console.log('  threshold. Widen the sweep before changing anything.')
  } else if (passing.length === args.sweep.length) {
    // Every candidate works, so the expectations cannot pick a value. Saying "use the
    // tightest" here would be a fabricated verdict: tighter means less recall on the
    // queries this set does not contain.
    console.log('VERDICT: inconclusive — every candidate passes every query.')
    console.log('  The expectations do not discriminate, so the threshold cannot be chosen')
    console.log('  from this run. The match-count curve is the only signal available:')
    const totalsPer = args.sweep.map((_, ti) => totals[ti].reduce((a, b) => a + b, 0))
    let cliff = { from: 0, to: 0, ratio: 1 }
    for (let i = 1; i < totalsPer.length; i += 1) {
      const ratio = totalsPer[i - 1] === 0 ? 0 : totalsPer[i] / totalsPer[i - 1]
      console.log(`    ${args.sweep[i - 1]}\u2192${args.sweep[i]}: ${totalsPer[i - 1]}\u2192${totalsPer[i]} matches (\u00d7${ratio.toFixed(2)})`)
      if (ratio > cliff.ratio) cliff = { from: args.sweep[i - 1], to: args.sweep[i], ratio }
    }
    if (cliff.ratio > 1.5) {
      console.log()
      console.log(`  Widest jump: ${cliff.from}\u2192${cliff.to} multiplies the result set by ${cliff.ratio.toFixed(2)}.`)
      console.log(`  Production sits at ${production}, i.e. ${
        production <= cliff.from ? 'below that cliff' : 'past it'
      }.`)
    }
    console.log()
    console.log('  To make this run decide, add the personal queries to')
    console.log('  scripts/tuning-queries.ts (task 7.1).')
  } else {
    console.log(`VERDICT: tightest passing threshold = ${tightest}, first failing = ${failing[0]}`)
    console.log(
      `  Production is ${production} — ${
        passing.includes(production) ? 'inside the passing band' : 'OUTSIDE it'
      }.`,
    )
  }
  console.log()
  ALL_QUERIES.forEach((q) => console.log(`  "${q.query}" — ${q.note}`))
}

main()
