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
 * The LIST-badge rows at the end pin the bottom-nav list counter (`data-list-badge` on the
 * Lista tab). They matter because the badge lives in AppLayout, the *layout* route: it
 * stays mounted while a page hook mutates the list, so a counter read only on mount would
 * stay stale. The live row therefore adds an item from the search screen and requires the
 * badge to follow **without a reload** — the exact assertion that fails when the hook
 * instances are not subscribed to each other.
 *
 * Requires a built app (`npm run build`), served in one of two modes:
 *
 *   - **Self-serve (default, no `BASE_URL`).** The harness starts
 *     scripts/ghpages-server.ts on port 4173 over `dist/` and closes it when the run
 *     ends, so `npm run acceptance` is a single command. That server reproduces
 *     GitHub Pages semantics — an unknown path answers with `dist/404.html` and
 *     status 404, where `vite preview` would silently answer with index.html — and
 *     that is what makes the deep-link checks below meaningful locally.
 *   - **External (`BASE_URL` set).** The harness targets that URL exactly and starts
 *     nothing; this is how it is pointed at production or at a server started by
 *     hand (`node scripts/ghpages-server.ts`).
 *
 * Playwright is resolved in this order:
 *   1. PW_MODULE env var — absolute path to a playwright module
 *   2. a local `playwright` / `playwright-core` install
 *   3. the globally installed @playwright/cli bundle
 *   Browser: CHROME_PATH env var, else /usr/bin/google-chrome when present, else
 *   Playwright's own download.
 *
 * Usage: npm run acceptance                     (self-served, faithful server)
 *        BASE_URL=https://… npm run acceptance  (external host, e.g. production)
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { startServer, type GhPagesServer } from './ghpages-server.ts'

const EXTERNAL_BASE_URL = process.env.BASE_URL
const SELF_SERVE_PORT = 4173
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

/**
 * Resolves where the run points and owns the self-served server's lifetime:
 * in self-serve mode the server is closed even when a check throws, so the
 * process always exits cleanly.
 */
async function main(): Promise<void> {
  let server: GhPagesServer | undefined
  let baseUrl: string
  if (EXTERNAL_BASE_URL) {
    baseUrl = EXTERNAL_BASE_URL
  } else {
    server = await startServer({ port: SELF_SERVE_PORT, root: 'dist' })
    baseUrl = server.url
  }

  try {
    // The offline row stops the server itself, so the handle has to reach it.
    await runChecks(baseUrl, server)
  } finally {
    // ghpages-server's close() rejects when called twice (ERR_SERVER_NOT_RUNNING), and
    // shutting down an already-stopped server is not a failure here.
    await server?.close().catch(() => undefined)
  }
}

async function runChecks(baseUrl: string, server?: GhPagesServer): Promise<void> {
  const { chromium } = resolvePlaywright()

  try {
    const res = await fetch(baseUrl, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    throw new Error(
      `${baseUrl} is not reachable (${err instanceof Error ? err.message : String(err)}). Run ` +
        `\`npm run build\`, or start a server and point BASE_URL at it.`,
    )
  }

  const baseLaunch: { executablePath?: string } = {}
  const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
  if (existsSync(chrome)) baseLaunch.executablePath = chrome

  // The scanner is a real camera surface: a fake media device makes its live
  // path exercisable here. That device reports no `torch` capability, which is
  // exactly what the torch gating must react to (button hidden, never dead).
  const browser = await chromium.launch({
    ...baseLaunch,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  })
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
   * Bounded variant of `waitForSearchSettled` that returns false instead of
   * throwing: a page that never booted (the production 404) must FAIL its own row
   * with its id, and let the run reach the summary line.
   */
  async function searchSettledWithin(query: string, timeout = 30000): Promise<boolean> {
    try {
      await waitForSearchSettled(query, timeout)
      return true
    } catch {
      return false
    }
  }

  /**
   * Page-agnostic `waitForSearchSettled`: the scanner rows run on their own phone
   * page (and for the no-camera case, a second browser), so the readiness contract
   * is read from that page instead of the main one.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function searchSettledOn(target: any, query: string, timeout = 30000): Promise<boolean> {
    try {
      await target.waitForFunction(
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
      return true
    } catch {
      return false
    }
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
    await page.goto(`${baseUrl}buscar?q=${encodeURIComponent(query)}`, {
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
    await page.goto(`${baseUrl}buscar`, { waitUntil: 'domcontentloaded' })
    await searchInput().waitFor({ timeout: 30000 })
    await waitForSearchReady()
  }

  // ---------------------------------------------------------------- boot
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await searchInput().waitFor({ timeout: 30000 })

  const firstVisit = [...dataRequests]
  record(
    'AC-4a',
    firstVisit.length === 3,
    `first visit requests all three data files: [${firstVisit.join(', ')}]`,
  )

  // ------------------------------------------- deep links and hard navigation
  // The rows above never prove the host can serve a subroute: reaching a screen by
  // clicking around never issues the GET a browser makes when a discarded mobile tab
  // is reloaded or a shared link is opened. GitHub Pages has no SPA fallback, so
  // without the published 404.html shell every one of these GETs lands on GitHub's
  // own 404 page and the app never boots. These rows do the GET.
  const deepQuery = 'yerba'
  await page.goto(`${baseUrl}buscar?q=${encodeURIComponent(deepQuery)}`, {
    waitUntil: 'domcontentloaded',
  })
  const deepBooted = await waitForVisible(searchInput())
  const deepSettled = deepBooted && (await searchSettledWithin(deepQuery))
  const deepResults = deepBooted ? await cards().allTextContents() : []
  record(
    'DEEP-search',
    deepBooted && deepSettled && deepResults.length > 0,
    `hard GET /buscar?q=${deepQuery} -> app ${deepBooted ? 'booted' : 'did NOT boot'}, ` +
      `${deepResults.length} result(s) for the query`,
  )

  // The path the bug actually breaks in the wild: reloading a discarded tab while
  // the user sits on a deep subroute.
  await page.reload({ waitUntil: 'domcontentloaded' })
  const reloadBooted = await waitForVisible(searchInput())
  const reloadSettled = reloadBooted && (await searchSettledWithin(deepQuery))
  const reloadResults = reloadBooted ? await cards().allTextContents() : []
  record(
    'DEEP-reload',
    reloadBooted && reloadSettled && reloadResults.length === deepResults.length && reloadResults.length > 0,
    `reload on /buscar?q=${deepQuery} -> app ${reloadBooted ? 'booted' : 'did NOT boot'}, ` +
      `${reloadResults.length} result(s) (before reload: ${deepResults.length})`,
  )

  // A shared product link: /producto/<ean> straight from the address bar.
  const deepEan = '7793940219009'
  await page.goto(`${baseUrl}producto/${deepEan}`, { waitUntil: 'domcontentloaded' })
  const detailRendered = await waitForVisible(page.locator(`text=EAN ${deepEan}`))
  const notFoundShown = await page.locator('text=Producto no encontrado').count()
  const detailName = detailRendered
    ? ((await page.locator('main h2').first().textContent()) ?? '').replace(/\s+/g, ' ').trim()
    : ''
  record(
    'DEEP-prod',
    detailRendered && notFoundShown === 0,
    `hard GET /producto/${deepEan} -> ${detailRendered ? 'detail rendered' : 'detail did NOT render'}`,
    `name: "${detailName.slice(0, 70)}"`,
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
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }) // Home
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

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' }) // Home
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

  // ---------------------------------------------------------------- scanner (/escanear)
  // The scanner is a mobile-first surface: measure it on a 390×844 phone viewport.
  await page.setViewportSize({ width: 390, height: 844 })

  // A hard GET to the deep link must boot the app (the GH Pages 404 shell).
  await page.goto(`${baseUrl}escanear`, { waitUntil: 'domcontentloaded' })
  const scanBooted = await waitForVisible(page.locator('[data-scan-state]'))
  record(
    'SCAN-boot',
    scanBooted,
    `hard GET /escanear -> app ${scanBooted ? 'booted' : 'did NOT boot'} (data-scan-state present)`,
  )

  // A second browser with no fake camera: getUserMedia is denied, so the scanner must
  // fall back to the compact layout instead of an empty camera box. The real rejection
  // is only delayed, so the transient "requesting" state stays observable (the old
  // page rendered that message twice).
  const noCamBrowser = await chromium.launch({ ...baseLaunch, args: ['--deny-permission-prompts'] })
  const noCamContext = await noCamBrowser.newContext({ viewport: { width: 390, height: 844 } })
  await noCamContext.addInitScript(() => {
    const md = navigator.mediaDevices
    if (!md || typeof md.getUserMedia !== 'function') return
    const original = md.getUserMedia.bind(md)
    md.getUserMedia = (constraints?: MediaStreamConstraints) =>
      new Promise((resolve, reject) => {
        setTimeout(() => original(constraints).then(resolve, reject), 700)
      })
  })
  const noCamPage = await noCamContext.newPage()
  await noCamPage.goto(`${baseUrl}escanear`, { waitUntil: 'domcontentloaded' })

  let requestingCount = -1
  try {
    await noCamPage.waitForFunction(
      () => (document.body.textContent ?? '').includes('Pidiendo acceso a la cámara'),
      undefined,
      { timeout: 30000 },
    )
    requestingCount = await noCamPage.evaluate(
      () => ((document.body.textContent ?? '').split('Pidiendo acceso a la cámara').length - 1),
    )
  } catch {
    // Settled before the message could be observed; recorded as -1, never assumed.
  }

  let noCamState = 'never settled'
  try {
    await noCamPage.waitForFunction(
      () =>
        ['denied', 'unsupported', 'error'].includes(
          document.querySelector('[data-scan-state]')?.getAttribute('data-scan-state') ?? '',
        ),
      undefined,
      { timeout: 30000 },
    )
    noCamState =
      (await noCamPage.getAttribute('[data-scan-state]', 'data-scan-state')) ?? 'unknown'
  } catch {
    noCamState = 'never settled'
  }

  const noCamMetrics = await noCamPage.evaluate(() => {
    const manual = document.querySelector('input[aria-label="Código EAN"]')
    const mr = manual ? manual.getBoundingClientRect() : null
    const hasVisibleContent = (el: Element) =>
      Array.from(el.querySelectorAll('*')).some((d) => {
        const dr = d.getBoundingClientRect()
        if (dr.width <= 0 || dr.height <= 0) return false
        const tag = d.tagName.toLowerCase()
        if (tag === 'video') return (d as HTMLVideoElement).videoWidth > 0
        return ['img', 'canvas', 'input', 'button', 'a', 'ul', 'li', 'svg', 'textarea', 'select'].includes(tag)
      })
    const emptyBlocks: Array<{ tag: string; w: number; h: number }> = []
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect()
      if (r.height <= 200 || r.width <= 0) continue
      if ((el.textContent ?? '').trim() !== '') continue
      const tag = el.tagName.toLowerCase()
      if (tag !== 'video' && hasVisibleContent(el)) continue
      if (tag === 'video' && (el as HTMLVideoElement).videoWidth > 0) continue
      emptyBlocks.push({ tag, w: Math.round(r.width), h: Math.round(r.height) })
    }
    return {
      manualVisible: !!mr && mr.width > 0 && mr.height > 0 && mr.top >= 0 && mr.top < 844,
      manualTop: mr ? Math.round(mr.top) : -1,
      emptyBlocks,
    }
  })
  record(
    'SCAN-nocam',
    noCamState !== 'never settled' &&
      requestingCount === 1 &&
      noCamMetrics.manualVisible &&
      noCamMetrics.emptyBlocks.length === 0,
    `settled "${noCamState}"; manual EAN input visible at top ${noCamMetrics.manualTop}px; ` +
      `empty blocks >200px: ${noCamMetrics.emptyBlocks.length}`,
    `"requesting" message occurrences while pending: ${requestingCount} (the old page rendered 2)` +
      (noCamMetrics.emptyBlocks.length ? ` — offenders: ${JSON.stringify(noCamMetrics.emptyBlocks)}` : ''),
  )

  // The documented primary fallback must survive the redesign: type an EAN and land
  // on the search screen with the product resolved.
  const manualEan = '7793940219009'
  await noCamPage.locator('input[aria-label="Código EAN"]').fill(manualEan)
  await noCamPage.getByRole('button', { name: 'Buscar' }).click()
  let manualNavigated = false
  try {
    await noCamPage.waitForURL(
      (url: URL) => url.pathname.endsWith('/buscar') && url.searchParams.get('q') === manualEan,
      { timeout: 30000 },
    )
    manualNavigated = true
  } catch {
    manualNavigated = false
  }
  const manualResolved = manualNavigated && (await searchSettledOn(noCamPage, manualEan))
  const manualRows = manualResolved ? await noCamPage.locator('ul li').allTextContents() : []
  record(
    'SCAN-manual',
    manualNavigated && manualResolved && manualRows.length === 1,
    `manual EAN ${manualEan} -> /buscar?q=… resolved ${manualRows.length} product(s)`,
  )

  // The measured defect: every bottom-nav target below the 44×44 minimum.
  const navTargets: Array<{ label: string; w: number; h: number }> | null =
    await noCamPage.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Navegación principal"]')
    if (!nav) return null
    return Array.from(nav.querySelectorAll('a')).map((a) => {
      const r = a.getBoundingClientRect()
      return {
        label: (a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 14),
        w: r.width,
        h: r.height,
      }
    })
  })
  record(
    'SCAN-nav44',
    !!navTargets &&
      navTargets.length === 5 &&
      navTargets.every((t) => t.w >= 43.99 && t.h >= 43.99),
    `bottom-nav targets: ${
      navTargets
        ? navTargets.map((t) => `${t.label} ${t.w.toFixed(0)}×${t.h.toFixed(0)}`).join(', ')
        : 'nav not found'
    }`,
  )

  await noCamBrowser.close()

  // With the fake camera the live path is reachable. The scan window must render, the
  // manual fallback must stay reachable, and the torch button must mirror the real
  // capability — never a dead control. No status message may appear twice.
  await page.bringToFront()
  let camActive = true
  try {
    await page.waitForFunction(
      () => document.querySelector('[data-scan-state]')?.getAttribute('data-scan-state') === 'active',
      undefined,
      { timeout: 30000 },
    )
  } catch {
    camActive = false
  }
  const camInfo = camActive
    ? await page.evaluate(() => {
        const video = document.querySelector('video') as HTMLVideoElement | null
        const track =
          video && video.srcObject ? (video.srcObject as MediaStream).getVideoTracks()[0] : null
        const caps =
          track && track.getCapabilities ? (track.getCapabilities() as { torch?: boolean }) : null
        const torchCap = !!caps?.torch
        const torchBtn = document.querySelector(
          'button[aria-label="Prender la linterna"], button[aria-label="Apagar la linterna"]',
        )
        const win = document.querySelector('[data-scan-window]')
        const wr = win ? win.getBoundingClientRect() : null
        const statuses = Array.from(document.querySelectorAll('[role="status"]')).map((e) =>
          (e.textContent ?? '').trim().replace(/\s+/g, ' '),
        )
        return {
          windowW: wr ? Math.round(wr.width) : 0,
          windowH: wr ? Math.round(wr.height) : 0,
          caption: (document.body.textContent ?? '').includes('Poné el código dentro del recuadro'),
          manualFallback: (document.body.textContent ?? '').includes('Escribí el EAN a mano'),
          torchCap,
          torchBtn: !!torchBtn,
          statuses,
        }
      })
    : null
  const camDuplicates = camInfo ? camInfo.statuses.length - new Set(camInfo.statuses).size : -1
  record(
    'SCAN-cam',
    !!camInfo &&
      camInfo.windowW > 0 &&
      camInfo.windowH > 0 &&
      camInfo.caption &&
      camInfo.manualFallback &&
      camInfo.torchBtn === camInfo.torchCap &&
      camDuplicates === 0,
    camInfo
      ? `data-scan-state="active"; scan window ${camInfo.windowW}×${camInfo.windowH}; ` +
        `manual fallback ${camInfo.manualFallback ? 'reachable' : 'MISSING'}; ` +
        `torch ${camInfo.torchBtn ? 'shown' : 'hidden'} (capability ${camInfo.torchCap ? 'present' : 'absent'})`
      : 'data-scan-state never reached "active" with the fake camera',
    camInfo ? `status messages: ${camInfo.statuses.length}, duplicates: ${camDuplicates}` : '',
  )

  /*
   * Touch targets (docs/design-system.md §7/§9: every interactive target >= 44×44).
   * These rows measure the real bounding boxes on /lista and /producto with the same
   * idiom SCAN-nav44 uses for the bottom nav: read getBoundingClientRect in the page,
   * judge >= 43.99 on both axes.
   *
   * Seeding: useList persists to `precio-scanner:lupa:lista`, so writing that key
   * before the goto gives the list page real rows (the same approach the SAVED-* rows
   * use with the sentinel items). The two EANs are the working list's own seed, so
   * useResolveEans resolves names/prices from the catalog and the steppers render.
   */
  const touchItems = [
    { ean: '7793940219009', cantidad: 2, alerta: true },
    { ean: '7790895000016', cantidad: 1, alerta: false },
  ]
  /** Maps every control in a page snapshot to {label, w, h}; null when the page never booted. */
  const touchTargets = () =>
    page.evaluate(
      () => {
        const sizeOf = (el: Element) => {
          const r = el.getBoundingClientRect()
          return { w: r.width, h: r.height }
        }
        const label = (el: Element) =>
          (el.getAttribute('aria-label') || el.textContent || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 24)
        const asTarget = (el: Element) => ({ label: label(el), ...sizeOf(el) })
        const byAria = (a: string) => {
          const el = document.querySelector(`button[aria-label="${a}"]`)
          return el ? asTarget(el) : null
        }
        // The decrement's accessible name is value-dependent (at cantidad 1 it
        // names the row removal), so the stepper is matched by prefix.
        const restar = document.querySelector('button[aria-label^="Restar uno"]')
        const byRestar = restar ? asTarget(restar) : null
        const viewButtons = Array.from(
          document.querySelectorAll('[role="group"] button'),
        ).map(asTarget)
        const vaciar = Array.from(document.querySelectorAll('button')).find((b) =>
          (b.textContent ?? '').includes('Vaciar'),
        )
        const quitar = Array.from(document.querySelectorAll('button')).filter((b) =>
          // Only the row-remove controls: they carry the Minus SVG. The value-1
          // stepper (“Quitar la última unidad de …”) is a text glyph, no icon.
          (b.getAttribute('aria-label') ?? '').startsWith('Quitar ') && b.querySelector('svg'),
        )
        const historial = Array.from(document.querySelectorAll('a')).find((a) =>
          (a.textContent ?? '').includes('Historial'),
        )
        return {
          steppers: [
            byRestar,
            byAria('Sumar uno'),
          ],
          viewButtons,
          vaciar: vaciar ? asTarget(vaciar) : null,
          quitar: quitar.map(asTarget),
          volver: byAria('Volver'),
          favorite: (() => {
            const el = document.querySelector(
              'button[aria-label="Agregar a favoritos"], button[aria-label="Quitar de favoritos"]',
            )
            return el ? asTarget(el) : null
          })(),
          historial: historial ? asTarget(historial) : null,
          rowH: (() => {
            const li = document.querySelector('main ul li')
            return li ? { w: Math.round(li.getBoundingClientRect().width), h: Math.round(li.getBoundingClientRect().height) } : null
          })(),
        }
      },
    )
  const touchOk = (t: { w: number; h: number } | null | undefined) =>
    !!t && t.w >= 43.99 && t.h >= 43.99

  // The exact left column of the four: the list's controls at phone size.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(
    (items: Array<{ ean: string; cantidad: number; alerta: boolean }>) => {
      localStorage.setItem('precio-scanner:lupa:lista', JSON.stringify(items))
    },
    touchItems,
  )
  await page.goto(`${baseUrl}lista`, { waitUntil: 'domcontentloaded' })
  // The bottom nav is the layout's client the page always booted with; wait for it
  // instead of guessing — it is also the element the LIST-badge rows measure below.
  const navShownForTouch = await page.locator('nav[aria-label="Navegación principal"]').first().waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false)
  // Ready when the empty/loaded list contract is on screen: "Vaciar" only renders
  // with items, so its presence is the readiness contract for the seeded rows.
  const vaciarReady = await waitForVisible(page.locator('button:has-text("Vaciar")'))
  const listaTouch = navShownForTouch && vaciarReady ? await touchTargets() : null
  // Row heights for the density note: what the list renders now vs the 73px the defect report measured.
  const listaRowH = listaTouch?.rowH?.h ?? -1
  const baselineRowH = 73

  const listaSteppersOk =
    !!listaTouch && listaTouch.steppers.length === 2 && listaTouch.steppers.every((t: any) => touchOk(t))
  record(
    'TOUCH-lista-steppers',
    listaSteppersOk,
    `list quantity steppers (${listaTouch?.steppers.length ?? 0}): ${
      listaTouch
        ? listaTouch.steppers.map((t: { label: string; w: number; h: number }) => `${t.label} ${Math.round(t.w)}×${Math.round(t.h)}`).join(', ')
        : 'page never settled'
    }`,
  )
  record(
    'TOUCH-lista-quitar',
    !!listaTouch && listaTouch.quitar.length === 2 && listaTouch.quitar.every(touchOk),
    `per-item Quitar buttons (${listaTouch?.quitar.length ?? 0}): ${
      listaTouch
        ? listaTouch.quitar.map((t: { label: string; w: number; h: number }) => `${t.label} ${Math.round(t.w)}×${Math.round(t.h)}`).join(', ')
        : 'page never settled'
    }`,
    `list-row height with h-11 controls: ${listaRowH}px (baseline before this change: ${baselineRowH}px; the density cost is accepted and expected)`,
  )
  record(
    'TOUCH-lista-vaciar',
    touchOk(listaTouch?.vaciar),
    `"Vaciar" button: ${
      listaTouch?.vaciar ? `${listaTouch.vaciar.w.toFixed(0)}×${listaTouch.vaciar.h.toFixed(0)}` : 'page never settled'
    }`,
  )
  record(
    'TOUCH-lista-view',
    !!listaTouch && listaTouch.viewButtons.length === 2 && listaTouch.viewButtons.every(touchOk),
    `view selector buttons (${listaTouch?.viewButtons.length ?? 0}): ${
      listaTouch
        ? listaTouch.viewButtons.map((t: { label: string; w: number; h: number }) => `${t.label} ${Math.round(t.w)}×${Math.round(t.h)}`).join(', ')
        : 'page never settled'
    }`,
  )

  // The product detail controls on the same rule.
  await page.goto(`${baseUrl}producto/7793940219009`, { waitUntil: 'domcontentloaded' })
  // The star renders only after the worker resolves the EAN; wait for it, never sleep.
  const prodReady = await waitForVisible(page.locator('button[aria-label="Agregar a favoritos"], button[aria-label="Quitar de favoritos"]'))
  const prodTouch = prodReady ? await touchTargets() : null
  record(
    'TOUCH-prod-control',
    touchOk(prodTouch?.volver) && touchOk(prodTouch?.favorite) && touchOk(prodTouch?.historial),
    `/producto controls: Volver ${
      prodTouch?.volver ? `${prodTouch.volver.w.toFixed(0)}×${prodTouch.volver.h.toFixed(0)}` : 'not found'
    }, favorite ${
      prodTouch?.favorite ? `${prodTouch.favorite.w.toFixed(0)}×${prodTouch.favorite.h.toFixed(0)}` : 'not found'
    }, Historial ${
      prodTouch?.historial ? `${prodTouch.historial.w.toFixed(0)}×${prodTouch.historial.h.toFixed(0)}` : 'not found'
    }`,
  )

  /*
   * Contrast gate (§9: visible text ≥ 4.5:1, or ≥ 3:1 for large text) over the
   * main routes at the phone viewport, in BOTH themes. A regression in the text
   * ramp or in any pairing fails the run instead of shipping unreadable grey.
   *
   * Exclusions, both justified:
   *  - `.sr-only` subtrees: visually hidden, so contrast does not apply.
   *  - anything inside the live camera feed host on /escanear: that text is
   *    drawn over the video, where the background is whatever the camera sees.
   *
   * The colour math runs in linear sRGB and resolves the oklab()/oklch() forms
   * Tailwind v4 emits (alpha modifiers compile to oklab), then walks ancestors
   * compositing backgrounds until opaque — the effective background a pixel
   * actually renders against, not just the first colored box.
   */
  const contrastRoutes = ['/', '/lista', '/perfil', '/buscar', '/producto/7793940219009']
  /** Sets a theme by OS emulation (never localStorage: it must not persist). */
  const useScheme = async (scheme: 'light' | 'dark') => {
    await page.emulateMedia({ colorScheme: scheme })
  }
  const measureContrast = () =>
    page.evaluate(() => {
      const linearFromSRGB = (c: number) => {
        const v = c / 255
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      }
      const oklabToLinear = (L: number, a: number, b: number): [number, number, number] => {
        const l_ = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
        const m_ = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
        const s_ = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
        return [
          Math.max(0, 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
          Math.max(0, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
          Math.max(0, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
        ]
      }
      const oklchToLinear = (L: number, c: number, hDeg: number): [number, number, number] => {
        const h = (hDeg * Math.PI) / 180
        return oklabToLinear(L, Math.cos(h) * c, Math.sin(h) * c)
      }
      type Lin = { rgb: [number, number, number]; alpha: number }
      const alphaOf = (t: string | undefined) =>
        t === undefined ? 1 : t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t)
      const parseColor = (s: string): Lin | null => {
        s = s.trim()
        if (s.startsWith('oklch(')) {
          const m = s.match(/oklch\(([^)]+)\)/)
          if (!m) return null
          const parts = m[1].split(/[\s/]+/).filter(Boolean)
          if (parts.length < 3) return null
          return { rgb: oklchToLinear(Number(parts[0]), Number(parts[1]), Number(parts[2])), alpha: alphaOf(parts[3]) }
        }
        if (s.startsWith('oklab(')) {
          const m = s.match(/oklab\(([^)]+)\)/)
          if (!m) return null
          const parts = m[1].split(/[\s/]+/).filter(Boolean)
          if (parts.length < 3) return null
          return { rgb: oklabToLinear(Number(parts[0]), Number(parts[1]), Number(parts[2])), alpha: alphaOf(parts[3]) }
        }
        const m = s.match(/rgba?\(([^)]+)\)/)
        if (!m) return null
        const parts = m[1].split(/[\s,]+/).filter(Boolean).map(Number)
        if (parts.length < 3) return null
        return { rgb: [linearFromSRGB(parts[0]), linearFromSRGB(parts[1]), linearFromSRGB(parts[2])], alpha: parts[3] ?? 1 }
      }
      const luminance = (lin: [number, number, number]) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
      const compose = (layer: Lin | null, under: Lin): Lin => {
        if (layer === null || layer.alpha >= 1) return layer ?? under
        const a = layer.alpha
        return {
          rgb: [
            layer.rgb[0] * a + under.rgb[0] * (1 - a),
            layer.rgb[1] * a + under.rgb[1] * (1 - a),
            layer.rgb[2] * a + under.rgb[2] * (1 - a),
          ],
          alpha: a + under.alpha * (1 - a),
        }
      }
      const effectiveBg = (el: Element): Lin => {
        let bg: Lin = { rgb: [0, 0, 0], alpha: 0 }
        let node: Element | null = el
        while (node && node !== document.documentElement) {
          const c = parseColor(getComputedStyle(node).backgroundColor)
          if (c) bg = compose(c, bg)
          if (bg.alpha === 1) break
          node = node.parentElement
        }
        return bg.alpha === 1 ? bg : { rgb: [1, 1, 1], alpha: 1 }
      }
      const visible = (el: Element) => {
        const st = getComputedStyle(el)
        if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }
      const offenders: Array<{ text: string; ratio: number; need: number }> = []
      let checked = 0
      let worstPassing = 99
      const video = document.querySelector('video')
      const feedHost = video ? (video.parentElement as HTMLElement) : null
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
      while (walker.nextNode()) {
        const el = walker.currentNode as HTMLElement
        if (!visible(el)) continue
        if (el.classList.contains('sr-only') || el.closest('.sr-only')) continue
        const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())
        if (!ownText) continue
        /* text drawn over the live camera feed: the overlay is a sibling of the <video> */
        if (feedHost && feedHost.contains(el) && el !== video) continue
        const st = getComputedStyle(el)
        const fg = parseColor(st.color)
        if (!fg) continue
        const bg = effectiveBg(el)
        const l1 = luminance(fg.rgb)
        const l2 = luminance(bg.rgb)
        const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
        const ratio = (hi + 0.05) / (lo + 0.05)
        const fs = parseFloat(st.fontSize)
        const bold = Number(st.fontWeight) >= 700
        const large = fs >= 24 || (fs >= 18.66 && bold)
        const need = large ? 3 : 4.5
        checked++
        if (ratio < worstPassing) worstPassing = ratio
        if (ratio < need)
          offenders.push({ text: (el.textContent ?? '').trim().slice(0, 40), ratio: +ratio.toFixed(2), need })
      }
      return {
        checked,
        worstPassing: +worstPassing.toFixed(2),
        offenders: offenders.slice(0, 5),
      }
    })
  const contrastOk = (res: { checked: number; offenders: unknown[] }) =>
    res.checked > 0 && res.offenders.length === 0
  for (const scheme of ['light', 'dark'] as const) {
    await useScheme(scheme)
    const perRoute: string[] = []
    let allOk = true
    let minRatio = 99
    let checkedTotal = 0
    let failures: string[] = []
    for (const route of contrastRoutes) {
      await page.goto(`${baseUrl}${route.replace(/^\//, '')}`, { waitUntil: 'domcontentloaded' })
      // The layout nav is the one element every route renders; wait for it, and
      // on the search route additionally for the settled run (no fixed sleeps).
      const navShown = await waitForVisible(
        page.locator('nav[aria-label="Navegación principal"]'),
        30000,
      )
      if (route === '/buscar') await waitForSearchReady()
      if (route.startsWith('/producto')) {
        await waitForVisible(page.locator('button[aria-label="Agregar a favoritos"], button[aria-label="Quitar de favoritos"]'), 30000)
      }
      const res = await measureContrast()
      checkedTotal += res.checked
      if (res.worstPassing < minRatio) minRatio = res.worstPassing
      const ok = contrastOk(res)
      allOk = allOk && ok
      if (!ok)
        failures.push(
          `${route}: ${res.offenders
            .map((o: { text: string; ratio: number; need: number }) => `«${o.text}» ${o.ratio}:1 (need ${o.need})`)
            .join('; ')}`,
        )
      perRoute.push(`${route} ${res.worstPassing}`)
    }
    record(
      `CONTRAST-${scheme}`,
      allOk,
      `${scheme} theme at 390×844 over [${contrastRoutes.join(', ')}] -> worst measured ratio ${minRatio} ` +
        `across ${checkedTotal} visible text nodes; per-route worst passing: ${perRoute.join(', ')}`,
      allOk ? '' : `FAILURES: ${failures.join(' || ')}`,
    )
  }
  await page.emulateMedia({ colorScheme: null })

  /*
   * Touch-target rows for the surfaces the audit measured on /perfil and
   * /buscar (same idiom and 43.99 rule as the TOUCH-lista rows above).
   */
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${baseUrl}perfil`, { waitUntil: 'domcontentloaded' })
  const perfilNavReady = await waitForVisible(
    page.locator('nav[aria-label="Navegación principal"]'),
  )
  type TouchBox = { label: string; w: number; h: number }
  const temaRadios: TouchBox[] | null = perfilNavReady
    ? await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="radio"]')).map((el) => {
          const r = el.getBoundingClientRect()
          return {
            label: (el.textContent || '').trim().slice(0, 14),
            w: r.width,
            h: r.height,
          }
        }),
      )
    : null
  record(
    'TOUCH-perfil-tema',
    !!temaRadios && temaRadios.length === 3 && temaRadios.every((t) => t.w >= 43.99 && t.h >= 43.99),
    `theme radiogroup buttons (${temaRadios?.length ?? 0}): ${
      temaRadios
        ? temaRadios.map((t) => `${t.label} ${t.w.toFixed(0)}×${t.h.toFixed(0)}`).join(', ')
        : 'page never settled'
    }`,
  )

  await page.goto(`${baseUrl}buscar`, { waitUntil: 'domcontentloaded' })
  await waitForSearchReady()
  const buscarAdd: Array<{ w: number; h: number }> = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('button[aria-label^="Agregar a la lista"], button[aria-label^="En tu lista"]'),
    ).map((el) => {
      const r = el.getBoundingClientRect()
      return { w: r.width, h: r.height }
    }),
  )
  record(
    'TOUCH-buscar-add',
    buscarAdd.length > 0 && buscarAdd.every((t) => t.w >= 43.99 && t.h >= 43.99),
    `per-card add buttons (${buscarAdd.length} measured): ${buscarAdd
      .slice(0, 3)
      .map((t) => `${t.w.toFixed(0)}×${t.h.toFixed(0)}`)
      .join(', ')}...`,
  )

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${baseUrl}buscar?pmin=1000&pmax=5000`, { waitUntil: 'domcontentloaded' })
  await waitForSearchReady()
  const filterChips: TouchBox[] = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('button[aria-label^="Quitar filtro"]'),
    ).map((el) => {
      const r = el.getBoundingClientRect()
      return { label: (el.textContent ?? '').trim().slice(0, 12), w: r.width, h: r.height }
    }),
  )
  const limpiarLoc = page.locator('button:text-is("Limpiar")')
  const limpiarShown = await waitForVisible(limpiarLoc)
  const limpiarBox = limpiarShown ? await limpiarLoc.first().boundingBox() : null
  record(
    'TOUCH-buscar-chips',
    filterChips.length === 2 && filterChips.every((t) => t.w >= 43.99 && t.h >= 43.99) &&
      !!limpiarBox && limpiarBox.width >= 43.99 && limpiarBox.height >= 43.99,
    `active-filter chips (${filterChips.length}): ${filterChips
      .map((t) => `${t.label} ${t.w.toFixed(0)}×${t.h.toFixed(0)}`)
      .join(', ')}; "Limpiar" ${
      limpiarBox ? `${limpiarBox.width.toFixed(0)}×${limpiarBox.height.toFixed(0)}` : 'not found'
    }`,
  )


  // /guardadas is Firebase-coupled: an unauthenticated run lands on the page's
  // signed-out contract, not on rendered lists. That contract's controls are real
  // and measurable now; the signed-in per-list delete button is class-fixed at
  // h-11 w-11 but cannot be rendered by the harness (no session to drive).
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${baseUrl}guardadas`, { waitUntil: 'domcontentloaded' })
  const guardadasStateShown = await waitForVisible(page.locator('[data-saved-lists-state]'), 30000)
  const guardadasState = guardadasStateShown
    ? await page.evaluate(() =>
        document.querySelector('[data-saved-lists-state]')?.getAttribute('data-saved-lists-state') ??
        null,
      )
    : null
  const guardadasControls: TouchBox[] | null =
    guardadasStateShown
      ? await page.evaluate(() =>
          Array.from(document.querySelectorAll('main button')).map((el) => {
            const r = el.getBoundingClientRect()
            return { label: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 22), w: r.width, h: r.height }
          }),
        )
      : null
  record(
    'TOUCH-guardadas',
    guardadasStateShown &&
      guardadasState === 'signed-out' &&
      !!guardadasControls &&
      guardadasControls.length > 0 &&
      guardadasControls.every((t) => t.w >= 43.99 && t.h >= 43.99),
    `guardadas signed-out contract (data-saved-lists-state="${guardadasState}") -> ` +
      `${guardadasControls?.length ?? 0} button(s) measured >= 44x44: ${guardadasControls
        ?.map((t) => `${t.label} ${Math.round(t.w)}×${Math.round(t.h)}`)
        .join(', ')}`,
    'the signed-in per-list delete button is class-fixed at h-11 w-11 but needs a real Firebase '+
    'session the harness cannot hold, so no runtime row can render it — the limitation is in the docs.',
  )

    /*
   * The boot-failure screen (App's ErrorScreen), reached through the route a
   * first visit on a dead connection really takes: a FRESH context has no
   * service worker and an empty Cache API, so the aborted catalog fetches make
   * loadCatalog throw `offline with no cached facets` — the honest
   * "No se pudo descargar el catálogo." branch. The old code kept the app on
   * BootScreen forever on this route; this row waits on the app's own
   * `data-boot-state="error"` hook (the same convention as data-search-state /\n   * data-scan-state), so it can never pass against the eternal skeleton.
   *
   * Recovery: the screen's own Reintentar button reloads the page; with the
   * catalog requests unblocked, the same URL boots to the search screen.
   */
  const bootErrBrowser = await chromium.launch({ ...baseLaunch })
  const bootErrContext = await bootErrBrowser.newContext({ viewport: { width: 390, height: 844 } })
  let bootBlocked = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await bootErrContext.route(/catalogo(-index|-facets)?\.json/, (route: any) => {
    if (bootBlocked) void route.abort()
    else void route.continue().catch(() => undefined)
  })
  const bootErrPage = await bootErrContext.newPage()
  await bootErrPage.goto(`${baseUrl}buscar?q=yerba`, { waitUntil: 'domcontentloaded' })

  const bootErrorShown = await waitForVisible(bootErrPage.locator('[data-boot-state="error"]'))
  const bootAlertText = bootErrorShown
    ? await bootErrPage.evaluate(() =>
        (document.querySelector('[data-boot-state="error"]')?.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
      )
    : ''
  const bootRetry = bootErrPage.locator('[data-boot-state="error"] button:has-text("Reintentar")')
  const bootRetryShown = await waitForVisible(bootRetry)
  const bootRetryBox = bootRetryShown ? await bootRetry.boundingBox() : null

  bootBlocked = false
  if (bootRetryShown) await bootRetry.click()
  const bootRecovered = await searchSettledOn(bootErrPage, 'yerba')
  const bootResults = bootRecovered ? await bootErrPage.locator('ul li').allTextContents() : []
  record(
    'BOOT-err',
    bootErrorShown &&
      /No se pudo descargar el catálogo/.test(bootAlertText) &&
      !/Ocurrió un error al buscar/.test(bootAlertText) &&
      !/Cargando catálogo/.test(bootAlertText) &&
      bootRetryShown &&
      !!bootRetryBox &&
      bootRetryBox.height >= 43.99 &&
      bootRetryBox.width >= 43.99 &&
      bootRecovered &&
      bootResults.length > 0,
    `fresh context with catalog downloads aborted -> ` +
      `${bootErrorShown ? 'error screen' : 'error screen NOT reached'}, ` +
      `alert "${bootAlertText.slice(0, 70)}", Reintentar ` +
      `${bootRetryBox ? `${bootRetryBox.width.toFixed(0)}×${bootRetryBox.height.toFixed(0)}` : 'MISSING'} (min 44×44), ` +
      `after unblocking + retry -> ${bootResults.length} result(s) for "yerba"`,
    'the cause is named (the download-failure branch, not the generic fallback), and the ' +
      'skeleton copy ("Cargando catálogo…") must be gone — a row that could pass on the ' +
      'old eternal BootScreen would be vacuous',
  )
  await bootErrBrowser.close()

  // ---------------------------------------------------------------- Lista badge (bottom nav)
  // The Lista badge lives in AppLayout — the *layout* route, which stays mounted
  // across every child route — so it must follow a list mutated by a page hook.
  // These rows therefore drive the mutation from /buscar (SearchPage's own useList
  // instance) with the badge already on screen, and never reload the page. A badge
  // that read storage only on mount would stay empty here: that is the row's point.
  const mainNav = () => page.locator('nav[aria-label="Navegación principal"]')
  const listaBadge = () => mainNav().locator('[data-list-badge]')
  /** Bounded badge read: an absent pill is null, never a 30 s wait that aborts the run. */
  const listaBadgeValue = async (): Promise<string | null> =>
    (await listaBadge().count()) === 0
      ? null
      : listaBadge().first().getAttribute('data-list-badge')
  const listaRows = () =>
    page.evaluate(() => {
      try {
        const raw = JSON.parse(localStorage.getItem('precio-scanner:lupa:lista') ?? '[]')
        return Array.isArray(raw) ? raw.length : -1
      } catch {
        return -1
      }
    })

  /** Bottom-bar geometry: the pill must never resize the tab or reflow the bar. */
  const navMetrics = () =>
    page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Navegación principal"]')
      const bar = nav?.firstElementChild as HTMLElement | null
      const lista = Array.from(nav?.querySelectorAll('a') ?? []).find((a) =>
        (a.textContent ?? '').includes('Lista'),
      )
      const barRect = bar?.getBoundingClientRect()
      const listaRect = lista?.getBoundingClientRect()
      return {
        barW: barRect ? Math.round(barRect.width) : -1,
        barH: barRect ? Math.round(barRect.height) : -1,
        barOverflow: bar ? bar.scrollWidth - bar.clientWidth : -1,
        listaW: listaRect ? listaRect.width : -1,
        listaH: listaRect ? listaRect.height : -1,
      }
    })

  // Empty-list precondition, stated explicitly instead of assumed: nothing before
  // this point touches the list, and this row pins the persisted list to zero.
  await page.evaluate(() => localStorage.removeItem('precio-scanner:lupa:lista'))
  await page.goto(`${baseUrl}lista`, { waitUntil: 'domcontentloaded' })
  const emptyNavReady = await waitForVisible(mainNav())
  const emptyNav = emptyNavReady ? await navMetrics() : null
  const emptyBadges = await listaBadge().count()
  record(
    'LIST-badge-0',
    emptyNavReady && emptyBadges === 0,
    `empty list -> ${emptyBadges} badge(s) on the Lista tab; bar ${emptyNav?.barW}×${emptyNav?.barH}`,
    'the app booted (nav visible) and the pill is absent, not a rendered "0"',
  )

  // The critical row. The scanner's manual EAN path navigates client-side, so
  // AppLayout keeps the badge it rendered at mount; the add then happens on the
  // search card, i.e. from SearchPage's useList instance — a different one.
  const badgeEan = '7793940219009'
  const rowsBefore = await listaRows()
  const expectedCount = rowsBefore + 1
  await page.goto(`${baseUrl}escanear`, { waitUntil: 'domcontentloaded' })
  const scanPageReady = await waitForVisible(page.locator('[data-scan-state]'))
  const manualToggle = page.locator('button:has-text("Escribí el EAN a mano")')
  if ((await manualToggle.count()) > 0) await manualToggle.first().click()
  const manualField = page.locator('input[aria-label="Código EAN"]').first()
  const manualFieldShown = await waitForVisible(manualField)
  await manualField.fill(badgeEan)
  await page.getByRole('button', { name: 'Buscar' }).first().click()
  let manualLanded = false
  try {
    await page.waitForURL(
      (url: URL) => url.pathname.endsWith('/buscar') && url.searchParams.get('q') === badgeEan,
      { timeout: 30000 },
    )
    manualLanded = true
  } catch {
    manualLanded = false
  }
  const readyToAdd = manualLanded && (await searchSettledWithin(badgeEan))
  const addToList = page.locator('button[aria-label^="Agregar a la lista"]').first()
  const addShown = await waitForVisible(addToList)
  if (addShown) await addToList.click()
  let badgeFollowed = false
  try {
    await page.waitForFunction(
      (want: string) =>
        document
          .querySelector('nav[aria-label="Navegación principal"] [data-list-badge]')
          ?.getAttribute('data-list-badge') === want,
      String(expectedCount),
      { timeout: 20000 },
    )
    badgeFollowed = true
  } catch {
    badgeFollowed = false
  }
  const rowsAfter = await listaRows()
  const badgeValue = await listaBadgeValue()
  const navAfterAdd = await navMetrics()
  record(
    'LIST-badge-live',
    scanPageReady &&
      manualFieldShown &&
      readyToAdd &&
      addShown &&
      rowsBefore === 0 &&
      rowsAfter === expectedCount &&
      badgeFollowed,
    `added ${badgeEan} from /escanear -> /buscar (client-side nav, no reload) -> ` +
      `storage ${rowsBefore} -> ${rowsAfter} row(s), Lista badge "${badgeValue}" (wanted ${expectedCount})`,
    `the add came from SearchPage's useList(), while AppLayout's own instance stayed mounted: ` +
      `the badge only updates because the two are subscribed to each other`,
  )

  // Accessibility and touch target, measured with the pill on screen. The name is read
  // the way the accessibility tree reads it (aria-hidden subtrees dropped), and the role
  // lookup below re-checks it through Playwright's own accessible-name computation.
  const listaName = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Navegación principal"]')
    const link = Array.from(nav?.querySelectorAll('a') ?? []).find((a) =>
      (a.textContent ?? '').includes('Lista'),
    )
    if (!link) return ''
    const clone = link.cloneNode(true) as HTMLElement
    clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
    // Element boundaries separate the accessible-name parts, so join the surviving
    // children with a space instead of concatenating them ("Lista1" would be wrong).
    return Array.from(clone.childNodes)
      .map((n) => (n.textContent ?? '').trim())
      .filter(Boolean)
      .join(' ')
  })
  const srPhrase = `${expectedCount} producto${expectedCount === 1 ? '' : 's'} en la lista`
  const byName = await page.getByRole('link', { name: `Lista ${srPhrase}`, exact: true }).count()
  record(
    'LIST-badge-a11y',
    byName === 1 &&
      listaName === `Lista ${srPhrase}` &&
      !!navAfterAdd &&
      navAfterAdd.listaW >= 43.99 &&
      navAfterAdd.listaH >= 43.99,
    `Lista link accessible name "${listaName}" (exact role lookup matched ${byName}); box ` +
      `${navAfterAdd?.listaW}×${navAfterAdd?.listaH} with the pill visible (min 44×44)`,
    'the pill is aria-hidden (so its digits never enter the name), which is why the name is ' +
      'the visible label plus the sr-only sentence',
  )

  // Cap and bar stability: a big count renders "99+" and must not move the bar.
  await page.evaluate(() => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      ean: `77900000000${String(i).padStart(2, '0')}`,
      cantidad: 1,
      alerta: false,
    }))
    localStorage.setItem('precio-scanner:lupa:lista', JSON.stringify(items))
  })
  await page.goto(`${baseUrl}lista`, { waitUntil: 'domcontentloaded' })
  const capReady = await waitForVisible(listaBadge())
  const capValue = capReady ? await listaBadgeValue() : null
  const capNav = capReady ? await navMetrics() : null
  record(
    'LIST-badge-cap',
    capReady &&
      capValue === '99+' &&
      !!emptyNav &&
      !!capNav &&
      capNav.barW === emptyNav.barW &&
      capNav.barH === emptyNav.barH &&
      capNav.barOverflow <= 0 &&
      capNav.listaW >= 43.99 &&
      capNav.listaH >= 43.99,
    `100 rows -> badge "${capValue}"; bar ${capNav?.barW}×${capNav?.barH} ` +
      `vs ${emptyNav?.barW}×${emptyNav?.barH} with an empty list`,
    `nav horizontal overflow ${capNav?.barOverflow}px (no wrap/shift); ` +
      `Lista tab ${capNav?.listaW}×${capNav?.listaH}`,
  )

  /*
   * The host contract itself (WU7.6, WU9.5). This runs from Node, so it bypasses the
   * page and therefore the service worker by construction: the worker cannot answer a
   * request it never sees.
   *
   * That matters because the DEEP-* rows above assert only that a deep link boots the
   * app, and the worker's navigateFallback produces that same outcome straight from its
   * precache. The worker also calls clientsClaim, so it controls the page from
   * activation onward and those rows may never reach the host at all. The HTTP status
   * is the part of the contract they cannot observe.
   */
  const missingRes = await fetch(`${baseUrl}definitely-not-a-real-path`)
  const missingBody = await missingRes.text()
  const shellPresent = /<div id="root">/.test(missingBody)
  const realFileRes = await fetch(`${baseUrl}manifest.webmanifest`)
  record(
    'HOST-404',
    missingRes.status === 404 && shellPresent && realFileRes.status === 200,
    `unknown path -> HTTP ${missingRes.status} carrying the app shell ` +
      `(${missingBody.length} bytes, root div ${shellPresent ? 'present' : 'MISSING'}); ` +
      `an existing file -> HTTP ${realFileRes.status}`,
    'Node-side: the service worker cannot answer for the host',
  )

  /*
   * Barcode chunk hygiene (perf audit, offline-first constraint).
   *
   * JsBarcode left the entry chunk (dynamic import) but must stay PRECACHED:
   * the list's "Códigos de barras" view is used at the register, offline. This
   * row fails on the old code — the library was bundled INTO the entry chunk,
   * so no JsBarcode precache entry existed and the entry contained the
   * library's own format table ("CODE39" appears in jsbarcode's internals but
   * never in app code; the app's own "CODE128" literal is in the entry by
   * design and is NOT used here for that reason).
   */
  const swText = await (await fetch(`${baseUrl}sw.js`)).text()
  const barcodePrecacheEntry = swText.match(/assets\/JsBarcode-[^"\\]+\.js/)
  const entryScript = (missingBody ?? '').match(/assets\/index-[^"\\]+\.js/)
  let barcodeOutOfEntry = false
  if (entryScript) {
    const entryText = await (await fetch(`${baseUrl}${entryScript[0]}`)).text()
    barcodeOutOfEntry = !entryText.includes('CODE39')
  }
  record(
    'PWA-barcode',
    !!barcodePrecacheEntry && barcodeOutOfEntry,
    `precache manifest lists ${barcodePrecacheEntry ? barcodePrecacheEntry[0] : 'NO JsBarcode chunk'}; ` +
      `entry chunk ${entryScript ? entryScript[0] : '?'} ${barcodeOutOfEntry ? 'does not contain' : 'CONTAINS'} the barcode library`,
    'offline constraint: the barcode chunk must be precached, not lazy-only; ' +
      'perf constraint: the entry must not carry the library',
  )

  /*
   * Saved lists (FR-12, WU10).
   *
   * Only the logged-out half is assertable here: the harness drives one unauthenticated
   * browser, and handing it credentials is precisely what it must not have. So these rows pin
   * the contract a visitor without a session actually gets. The authenticated behaviours are
   * covered by the unit tests over the pure mapper plus a manual two-account probe, and
   * `02-spec.md` AC-15 records that seam instead of implying coverage that does not exist.
   */
  await page.goto(`${baseUrl}lista`, { waitUntil: 'domcontentloaded' })
  const savedLink = page.locator('[data-saved-lists-link]')
  const savedLinkShown = await waitForVisible(savedLink)
  const savedLinkBox = savedLinkShown ? await savedLink.boundingBox() : null
  const savedLinkHref = savedLinkShown ? await savedLink.getAttribute('href') : null
  record(
    'SAVED-link',
    savedLinkShown &&
      !!savedLinkBox &&
      savedLinkBox.height >= 43.99 &&
      !!savedLinkHref &&
      savedLinkHref.endsWith('/guardadas'),
    `/lista offers "Mis listas guardadas" -> ${savedLinkHref} ` +
      `(${savedLinkBox ? savedLinkBox.height.toFixed(0) : '?'}px tall)`,
    'a link, not a save button: /lista must not pull the Firebase SDK, so the save action ' +
      'lives on /guardadas where the session is already loaded',
  )

  // A known working list, so "unchanged" is a comparison and not merely an absence.
  const sentinelItems = [
    { ean: '7793940219009', cantidad: 2, alerta: true },
    { ean: '7790895000016', cantidad: 1, alerta: false },
  ]
  await page.evaluate(
    (items: Array<{ ean: string; cantidad: number; alerta: boolean }>) => {
      localStorage.setItem('precio-scanner:lupa:lista', JSON.stringify(items))
    },
    sentinelItems,
  )
  const listBeforeSaved = await page.evaluate(() =>
    localStorage.getItem('precio-scanner:lupa:lista'),
  )

  await page.goto(`${baseUrl}guardadas`, { waitUntil: 'domcontentloaded' })
  const savedStateEl = page.locator('[data-saved-lists-state]')
  const savedStateShown = await waitForVisible(savedStateEl)
  let savedState: string | null = null
  if (savedStateShown) {
    try {
      // The page starts in 'loading' and settles once the session resolves; a stuck 'loading'
      // is a FAIL row, not an aborted run.
      await page.waitForFunction(
        () => {
          const v = document
            .querySelector('[data-saved-lists-state]')
            ?.getAttribute('data-saved-lists-state')
          return !!v && v !== 'loading'
        },
        undefined,
        { timeout: 20000 },
      )
    } catch {
      // read whatever it is below and let the row judge it
    }
    savedState = await savedStateEl.getAttribute('data-saved-lists-state')
  }
  const listAfterSaved = await page.evaluate(() =>
    localStorage.getItem('precio-scanner:lupa:lista'),
  )
  record(
    'SAVED-page',
    savedStateShown && (savedState === 'unconfigured' || savedState === 'signed-out'),
    `/guardadas -> data-saved-lists-state="${savedState}"`,
    'an unauthenticated browser is told it has no session; the page never invents one and ' +
      'never leaves "loading" on screen',
  )
  record(
    'SAVED-no-write',
    listBeforeSaved !== null && listAfterSaved === listBeforeSaved,
    `working list ${listBeforeSaved === listAfterSaved ? 'identical' : 'CHANGED'} across the ` +
      `visit (${listBeforeSaved?.length ?? 0} -> ${listAfterSaved?.length ?? 0} chars)`,
    'AC-11, logged-out half: opening the saved-lists page cannot touch ' +
      'precio-scanner:lupa:lista — saving is the only path to the cloud (FR-12.1)',
  )

  /*
   * Offline boot (FR-11.2 / AC-9, WU9.4).
   *
   * The server is stopped for real rather than emulated with `context.setOffline`. If
   * the app's request still reaches the server it succeeds, the loader's offline
   * fallback never runs, and the row would pass without having tested anything.
   *
   * It runs last because every row above needs the server.
   */
  if (!server) {
    info(
      'OFFLINE',
      'skipped: BASE_URL is set, so this harness has no server to stop. Run without ' +
        'BASE_URL for the self-served offline check.',
    )
  } else {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

    // The worker must be active AND controlling. Stopping the server while the page is
    // uncontrolled would only prove that an uncontrolled page cannot load.
    const workerState = () =>
      page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) {
          return { supported: false, ready: false, controlled: false }
        }
        const ready = await Promise.race([
          navigator.serviceWorker.ready.then(() => true),
          new Promise<boolean>((r) => setTimeout(() => r(false), 15000)),
        ])
        return { supported: true, ready, controlled: !!navigator.serviceWorker.controller }
      })

    let sw = await workerState()
    if (sw.ready && !sw.controlled) {
      // clientsClaim normally takes over open pages on activation; reloading makes it
      // deterministic instead of depending on that.
      await page.reload({ waitUntil: 'domcontentloaded' })
      sw = await workerState()
    }

    // The offline boot needs the app's own data cache populated, facets included:
    // they carry the version every other cached file is keyed by.
    const cacheEntries: string[] = await page.evaluate(async () => {
      const names = await caches.keys()
      const data = names.find((n) => n.includes('data-v1'))
      if (!data) return [] as string[]
      const c = await caches.open(data)
      return (await c.keys()).map((r) => new URL(r.url).pathname)
    })
    const facetsCached = cacheEntries.some((p) => p.endsWith('catalogo-facets.json'))

    await server.close()

    const offlineQuery = 'serenisma'
    let booted = true
    try {
      await page.goto(`${baseUrl}buscar?q=${offlineQuery}`, { waitUntil: 'domcontentloaded' })
    } catch {
      // A navigation the worker cannot answer rejects here; that is a FAIL row, not an
      // aborted run.
      booted = false
    }
    const settled = booted && (await searchSettledWithin(offlineQuery))
    const offlineCards: string[] = settled ? await cards().allTextContents() : []
    const relevant = offlineCards.filter((t: string) => /seren[ií]sima/i.test(t)).length
    record(
      'OFFLINE',
      sw.supported && sw.ready && sw.controlled && facetsCached && settled && relevant > 0,
      `server stopped -> /buscar?q=${offlineQuery} ${settled ? 'settled' : 'did NOT settle'}, ` +
        `${offlineCards.length} result(s), ${relevant} La Serenísima`,
      `worker ${sw.supported ? (sw.ready ? 'ready' : 'never became ready') : 'unsupported'}, ` +
        `${sw.controlled ? 'controlling' : 'NOT controlling'}; data cache before shutdown: ` +
        `${facetsCached ? 'facets present' : 'facets MISSING'} (${cacheEntries.length} entries)`,
    )
  }

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