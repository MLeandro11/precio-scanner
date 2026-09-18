/**
 * tuning-queries.ts — the query set consumed by `scripts/tune-threshold.ts` (WU7.1).
 *
 * Each entry pairs what a person TYPES with the product they EXPECT to find, expressed
 * as a regex over the product name. The regex is the whole measurement: `tune-threshold`
 * reports the rank of the first result matching it, per candidate threshold.
 *
 * Only queries whose expectation is already written down somewhere are listed here. A
 * tuning run over invented expectations would be a fake tuning run, so the personal set
 * (task 7.1) is empty until it comes from the person who actually searches.
 */
export interface TuningQuery {
  /** What the person types into the search bar. */
  query: string
  /** Regex the expected product's `nombre` must match, case-insensitive. */
  expect: RegExp
  /** Where the expectation comes from. Provenance is not optional. */
  note: string
}

/**
 * From `sdd/02-spec.md`, acceptance criteria AC-2 and AC-3. These were verified manually
 * against the real catalog; the harness re-checks them on every run so the claim cannot
 * rot silently.
 */
export const SPEC_QUERIES: TuningQuery[] = [
  {
    query: 'serenisma',
    expect: /seren[ií]sima/i,
    note: 'AC-2 — a misspelling of a brand word, inside a longer product name',
  },
  {
    query: 'cocacola',
    expect: /coca\s*cola/i,
    note: 'AC-3 — two concatenated words against a space-separated name',
  },
]

/**
 * The personal set required by task 7.1: searches that are tricky for reasons only the
 * actual user knows — a half-remembered name, a word that is ambiguous in this catalog,
 * a brand that is not spelled the way it sounds.
 *
 * Format, one line each:
 *   { query: 'lo que escribís', expect: /lo que esperás ver/i, note: 'por qué es difícil' }
 *
 * Leave it empty to run the spec set alone.
 */
export const PERSONAL_QUERIES: TuningQuery[] = [
  {
    query: 'coca 2,5',
    expect: /coca.*\b2[.,]5\b/i,
    note: 'brand + volume; the catalog has "COCA COLA X 2.5" and "coca cola zero x 2.5"',
  },
  {
    query: 'zero 1,5',
    expect: /zero.*1[.,]5/i,
    note: 'catalog has "COCA COLA ZERO X 1,5L" plus 8 more zero 1.5L drinks',
  },
  {
    query: 'quilmes 1890',
    expect: /quilmes.*1890/i,
    note: 'brand + variant number; catalog has "CERVEZA QUILMES 1890 473CC" (and a typo variant)',
  },
  {
    query: 'yogurt griego',
    expect: /griego/i,
    note: 'typeless "yogurt" vs catalog "YOGUR"; 21 products carry the word GRIEGO',
  },
]

export const ALL_QUERIES: TuningQuery[] = [...SPEC_QUERIES, ...PERSONAL_QUERIES]
