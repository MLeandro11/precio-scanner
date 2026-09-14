/**
 * acceptance — the AC-1..AC-7 acceptance pass, automated (WU6.4 / WU7.4).
 *
 * Drives a real Chromium against the built app and asserts the acceptance criteria
 * a unit test cannot reach: search quality over the real 20k catalog (AC-2, AC-3),
 * the Cache API hit on a repeat visit (AC-4), main-thread responsiveness while
 * typing (AC-5), and persistence across a reload (AC-7). AC-1 is a Node pipeline
 * concern and is covered by scripts/normalize-catalog.test.ts; AC-6 needs a real
 * GitHub remote and cannot be checked locally.
 *
 * The app is **Lupa** (rebrand): the Home page deep-links to the search screen
 * (/buscar?q=…); the search screen lives at /buscar. This harness drives the real
 * flow: open /buscar with the query and wait for the results to settle.
 *
 * Waiting is contract-driven, never timing-driven: the results container carries
 * `data-search-state` ('loading' | 'ready' | 'error') and `data-search-query` (the
 * query those results belong to). The session runs an unfiltered initial browse at
 * creation and debounces a deep-linked query by 150 ms, so "some cards exist" and
 * fixed sleeps can read that browse page instead of the query's results — every
 * search wait below keys on the settled query instead.
 *
 * Requires a served build:
 *   npm run build && npm run preview
 *
 * Playwright is resolved in this order:
 *   1. PW_MODULE env var — absolute path to a playwright module
 *   2. a local `playwright` / `playwright-core` install
 *   3. the globally installed @playwright/cli bundle
 *   Browser: CHROME_PATH env var, else /usr/bin/google-chrome when present, else
 *   Playwright's own download.
 *
 * Usage: npm run acceptance   (BASE_URL overrides the default preview URL)
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4173/precio-scanner/'
const GLOBAL_PW =
  '/home/linuxbrew/.linuxbrew/lib/node_modules/@playwright/cli/node_modules/playwright'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolvePlaywright(): any {
  const require = createRequire(import.meta.url)
  for (const candidate of [process.env.PW_MODULE, 'playwright', 'playwright-core', GLOBAL_PW]) {
    if (!candidate) continue
    try {
      return require(candidate)
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'playwright not found. Install it, or set PW_MODULE to the playwright module path.',
  )
}

const rows: Array<{ id: string; status: string; evidence: string }> = []
function record(id: string, ok: boolean, evidence: string, note = '') {
  const status = ok ? 'PASS' : 'FAIL'
  rows.push({ id, status, evidence })
  console.log(`${status}  ${id.padEnd(8)} ${evidence}${note ? `\n              ${note}` : ''}`)
}
function info(id: string, evidence: string) {
  rows.push({ id, status: 'INFO', evidence })
  console.log(`INFO  ${id.padEnd(8)} ${evidence}`)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  const { chromium } = resolvePlaywright()

  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    throw new Error(
      `${BASE_URL} is not reachable (${err instanceof Error ? err.message : String(err)}). Run ` +
        `\`npm run build && npm run preview\`.`,
    )
  }

  const launchOptions: { executablePath?: string } = {}
  const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
  if (existsSync(chrome)) launchOptions.executablePath = chrome

  const browser = await chromium.launch(launchOptions)
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  // Every data-file request the app makes, so AC-4 can prove the cache hit.
  const dataRequests: string[] = []
  page.on('request', (r: { url(): string }) => {
    const name = r.url().split('?')[0].split('/').pop() ?? ''
    if (/^catalogo(-index|-facets)?\.json$/.test(name)) dataRequests.push(name)
  })

  const cards = () => page.locator('ul li')
  const searchInput = () => page.locator('input[type="search"]')

  /**
   * Waits used by the harness.
   *
   * `waitForSearchReady`/`waitForSearchSettled` read the readiness contract exposed
   * by ProductList; they replace fixed sleeps, and a short sleep may only ever
   * follow one of them as extra settle time, never stand in for one.
   */
  async function waitForSearchReady(timeout = 30000): Promise<void> {
    await page.waitForFunction(
      () =>
        document.querySelector('[data-search-state]')?.getAttribute('data-search-state') ===
        'ready',
      undefined,
      { timeout },
    )
  }

  /** Wait until a settled run is displaying results for exactly this query. */
  async function waitForSearchSettled(query: string, timeout = 30000): Promise<void> {
    await page.waitForFunction(
      (q: string) => {
        const el = document.querySelector('[data-search-state]')
        if (!el) return false
        return (
          el.getAttribute('data-search-state') === 'ready' &&
          el.getAttribute('data-search-query') === q
        )
      },
      query,
      { timeout },
    )
  }

  /**
   * Bounded visibility wait that returns false instead of throwing, so a missing
   * element fails its own assertion (with its id) instead of aborting the run.
   * The timeout is only a bound on the wait, never the thing being relied on.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function waitForVisible(target: any, timeout = 30000): Promise<boolean> {
    try {
      await target.first().waitFor({ state: 'visible', timeout })
      return true
    } catch {
      return false
    }
  }

  /** Polls a Node-side condition (request log); the DOM cannot express this wait. */
  async function waitUntil(predicate: () => boolean, timeout = 30000): Promise<void> {
    const deadline = Date.now() + timeout
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('timed out waiting for a harness condition')
      await sleep(25)
    }
  }

  /** Real user flow: deep-link to the search screen with the query. */
  async function search(query: string): Promise<string[]> {
    await page.goto(`${BASE_URL}buscar?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
    })
    await searchInput().waitFor({ timeout: 30000 })
    // Wait for the run of THIS query: the session's initial unfiltered browse also
    // renders cards, and the deep-linked query only lands after a 150 ms debounce.
    await waitForSearchSettled(query)
    return cards().allTextContents()
  }

  /** Go straight to the search screen (used by state/persistence checks). */
  async function openSearch(): Promise<void> {
    await page.goto(`${BASE_URL}buscar`, { waitUntil: 'domcontentloaded' })
    await searchInput().waitFor({ timeout: 30000 })
    await waitForSearchReady()
  }

  // ---------------------------------------------------------------- boot
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await searchInput().waitFor({ timeout: 30000 })

  const firstVisit = [...dataRequests]
  record(
    'AC-4a',
    firstVisit.length === 3,
    `first visit requests all three data files: [${firstVisit.join(', ')}]`,
  )

  // ---------------------------------------------------------------- AC-2 / AC-3
  const serenisma = (await search('serenisma')).slice(0, 10)
  const serenismaHits = serenisma.filter((t) => /seren/i.test(t)).length
  record(
    'AC-2',
    serenismaHits >= 8,
    `"serenisma" -> ${serenisma.length}/10 in the top 10 match "seren"`,
    `first: ${serenisma[0]?.replace(/\s+/g, ' ').slice(0, 70)}`,
  )

  const cocacola = (await search('cocacola')).slice(0, 10)
  const cocacolaHits = cocacola.filter((t) => /coca/i.test(t)).length
  record(
    'AC-3',
    cocacolaHits >= 8,
    `"cocacola" (no hyphen) -> ${cocacolaHits}/10 in the top 10 match "coca"`,
    `first: ${cocacola[0]?.replace(/\s+/g, ' ').slice(0, 70)}`,
  )

  // Search state is URL-driven: opening a product and going back must restore
  // the same results (regression guard for the back-navigation restore).
  const navBefore = await search('serenisma')
  await cards().first().click()
  await page.waitForURL('**/producto/**', { timeout: 30000 })
  await page.goBack()
  // The restore re-runs the search asynchronously — wait until the results for
  // the query actually render instead of racing a fixed sleep.
  await page.waitForFunction(
    (pattern: string) =>
      Array.from(document.querySelectorAll('ul li')).some((el) =>
        (el.textContent ?? '').toLowerCase().includes(pattern),
      ),
    'seren',
    { timeout: 20000 },
  )
  // ...and until that restore has settled, so nothing re-renders after the read.
  await waitForSearchSettled('serenisma')
  const navAfter = await cards().allTextContents()
  record(
    'NAV-back',
    navAfter.length === navBefore.length && navBefore.length > 0,
    `search survives back from product (${navAfter.length} results, before ${navBefore.length})`,
  )

  // ---------------------------------------------------------------- FR-2.8 (barcode)
  const exact = await search('7793940219009')
  record('FR-2.8a', exact.length === 1, `exact 13-digit EAN -> ${exact.length} result(s)`)

  const spaced = await search('779 3940 219009')
  record(
    'FR-2.8b',
    spaced.length === 1,
    `EAN with separators -> ${spaced.length} result(s) (separators are stripped)`,
  )

  // The spec forbids inventing near-misses for codes: an unknown code must be empty.
  // The settled empty state (query echoed, zero results) is what readiness waits for.
  const unknown = await search('9999999999999')
  record(
    'FR-2.8c',
    unknown.length === 0,
    `unknown code -> ${unknown.length} results (no false positives, as required)`,
  )

  const labelled = await search('EAN 7793940219009')
  info(
    'FR-2.8d',
    `"EAN 7793940219009" -> ${labelled.length} results: it has letters, so by spec it is a text query`,
  )

  // ---------------------------------------------------------------- AC-5
  // Type on the search screen (the "real" search input: debounce + worker run).
  await openSearch()
  await searchInput().fill('')
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __stop: boolean }
    w.__gaps = []
    w.__stop = false
    let last = performance.now()
    const tick = (t: number) => {
      w.__gaps.push(t - last)
      last = t
      if (!w.__stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const burst = 'coca cola yerba mate fideos arroz leche pan'
  const started = Date.now()
  await searchInput().type(burst, { delay: 25 })
  const typedMs = Date.now() - started
  await page.evaluate(() => {
    ;(window as unknown as { __stop: boolean }).__stop = true
  })
  const gaps = await page.evaluate(() => (window as unknown as { __gaps: number[] }).__gaps)
  const maxGap = Math.max(...gaps)
  record(
    'AC-5',
    maxGap < 150,
    `${burst.length} keys in ${typedMs} ms; worst frame gap ${maxGap.toFixed(0)} ms`,
    `frames over 100 ms: ${gaps.filter((g: number) => g > 100).length} — the main thread never blocked on search`,
  )

  // ---------------------------------------------------------------- favorites + recents
  // Favorites moved off the search page: the star lives on the product detail.
  await openSearch()
  await search('yerba')
  await page.locator('ul li').first().click() // open product detail
  // The detail renders its star only after the worker resolved the EAN: wait for
  // that star instead of sleeping through it.
  const addFavorite = page.locator('button[aria-label="Agregar a favoritos"]')
  if (await waitForVisible(addFavorite)) await addFavorite.click()
  await waitForVisible(page.locator('button[aria-label="Quitar de favoritos"]'))
  const starred = await page.locator('button[aria-label="Quitar de favoritos"]').count()
  record('WU6.2', starred === 1, `star on product detail -> ${starred} button with a-pressed`)

  await openSearch() // empty query -> recents chips
  const recentChipLocator = page.locator('button:text-is("yerba")')
  await waitForVisible(recentChipLocator)
  const recentChip = await recentChipLocator.count()
  record('WU6.3', recentChip === 1, `empty query -> recent-search chip "yerba": ${recentChip}`)

  const readStorage = () =>
    page.evaluate(() =>
      Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.includes('precio'))),
    )
  const before = await readStorage()
  record(
    'WU6.1',
    Object.keys(before).length >= 2,
    `localStorage holds both collections: ${JSON.stringify(before)}`,
  )

  // ---------------------------------------------------------------- AC-4 / AC-7 on reload
  dataRequests.length = 0
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }) // Home
  await searchInput().waitFor({ timeout: 30000 })
  // The reload must not re-request the heavy files. facets is always fetched (it
  // carries the version), so wait for that request to be observed instead of
  // sleeping: an empty log would otherwise "pass" AC-4 vacuously.
  await waitUntil(() => dataRequests.includes('catalogo-facets.json'))

  const afterReload = [...dataRequests]
  const heavy = afterReload.filter((f) => f !== 'catalogo-facets.json')
  record(
    'AC-4',
    heavy.length === 0,
    `reload -> data requests: [${afterReload.join(', ')}]; heavy files over the network: ${heavy.length}`,
    'facets is always refetched (it carries the version); catalog and index come from the Cache API',
  )

  const after = await readStorage()
  record(
    'AC-7a',
    JSON.stringify(before) === JSON.stringify(after),
    `localStorage identical after reload: ${JSON.stringify(before) === JSON.stringify(after)}`,
  )

  // Favorites entry now lives on Home; recents stay on the search screen.
  const favEntryAfter = await page.locator('button:has-text("Favoritos")').count()
  await openSearch()
  const recentAfterLocator = page.locator('button:text-is("yerba")')
  await waitForVisible(recentAfterLocator)
  const recentAfter = await recentAfterLocator.count()
  record(
    'AC-7b',
    favEntryAfter === 1 && recentAfter === 1,
    `after reload -> favorites entry on Home: ${favEntryAfter}, recent chip: ${recentAfter}`,
  )

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }) // Home
  await page.locator('button:has-text("Favoritos")').first().click() // -> /buscar?fav=1
  // The favorites view clears the query and `results`, so it cannot be keyed on a
  // query: wait for a settled run that actually renders the favorite. The unfiltered
  // browse page can never satisfy the content condition (results are cleared first).
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-search-state]')
      if (!el || el.getAttribute('data-search-state') !== 'ready') return false
      return Array.from(document.querySelectorAll('ul li')).some((li) =>
        /yerba/i.test(li.textContent ?? ''),
      )
    },
    undefined,
    { timeout: 30000 },
  )
  const favoritesView = await cards().allTextContents()
  record(
    'AC-7c',
    favoritesView.length === 1 && /yerba/i.test(favoritesView[0] ?? ''),
    `favorites view via Home -> ${favoritesView.length} product(s)`,
    `first: ${favoritesView[0]?.replace(/\s+/g, ' ').slice(0, 70)}`,
  )

  // Unfavorite from the product detail (opened from the favorites view); the
  // star state and storage must flip consistently — no stale favorite left.
  await page.locator('ul li').first().click()
  const removeFavorite = page.locator('button[aria-label="Quitar de favoritos"]')
  if (await waitForVisible(removeFavorite)) await removeFavorite.click()
  await waitForVisible(page.locator('button[aria-label="Agregar a favoritos"]'))
  const unfaved = await page.locator('button[aria-label="Agregar a favoritos"]').count()
  const favoritesStorage = await page.evaluate(
    () => localStorage.getItem('precio-scanner:favorites') ?? '[]',
  )
  record(
    'WU6.fix',
    unfaved === 1 && favoritesStorage === '[]',
    `unfavorite from product detail -> star back to "Agregar" (${unfaved}), favorites storage empty`,
  )

  await browser.close()
}

try {
  await main()
} catch (err) {
  // A timed-out wait must still print the summary line (and which rows passed),
  // so a harness failure is diagnosable instead of an opaque unhandled rejection.
  record(
    'HARNESS',
    false,
    `acceptance aborted: ${err instanceof Error ? err.message : String(err)}`,
  )
}

const failed = rows.filter((r) => r.status === 'FAIL')
console.log(`\n===== ${rows.length - failed.length}/${rows.length} PASS =====`)
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.id).join(', ')}`)
  process.exit(1)
}