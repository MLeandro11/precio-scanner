#!/usr/bin/env node
/**
 * tune-threshold.ts — Fuse threshold sweep against the real catalog (WU7.1).
 *
 * `src/lib/searchEngine.ts` holds the fuzzy-match options; this script imports that
 * exact object and rebuilds the engine once per candidate `threshold`, so the sweep
 * measures what the app ships rather than a copy that can drift from it.
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
import { FUSE_OPTIONS, DEFAULT_LIMIT } from '../src/lib/searchEngine.ts'
import { ALL_QUERIES } from './tuning-queries.ts'
import type { Catalog, Producto } from '../src/lib/types.ts'

const DEFAULT_SWEEP = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]

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
      const raw = fuse.search(q.query, { limit: args.limit })
      const items = raw.map((r) => r.item)
      column.push(rankOf(items, q.expect))
      const topN = items.slice(0, args.top)
      window.push(topN.filter((p) => q.expect.test(p.nombre)).length)
      // total matches, independent of the fetch limit
      counts.push(fuse.search(q.query).length)
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

  // The tightest threshold that still satisfies every expectation inside the window.
  const passing = args.sweep.filter((_, ti) =>
    ranks[ti].every((rank) => rank !== null && rank <= args.top),
  )
  const failing = args.sweep.filter((t) => !passing.includes(t))
  const tightest = passing.length ? Math.min(...passing) : null

  console.log()
  const production = FUSE_OPTIONS.threshold

  if (passing.length === 0) {
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
