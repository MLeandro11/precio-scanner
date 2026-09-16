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
import { startServer } from './ghpages-server.ts'

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
  let server: { url: string; close(): Promise<void> } | undefined
  let baseUrl: string
  if (EXTERNAL_BASE_URL) {
    baseUrl = EXTERNAL_BASE_URL
  } else {
    server = await startServer({ port: SELF_SERVE_PORT, root: 'dist' })
    baseUrl = server.url
  }

  try {
    await runChecks(baseUrl)
  } finally {
    await server?.close()
  }
}

async function runChecks(baseUrl: string): Promise<void> {
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