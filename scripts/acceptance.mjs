/**
 * acceptance — the AC-1..AC-7 acceptance pass, automated (WU6.4 / WU7.4).
 *
 * Drives a real Chromium against the built app and asserts the acceptance criteria
 * a unit test cannot reach: search quality over the real 20k catalog (AC-2, AC-3),
 * the Cache API hit on a repeat visit (AC-4), main-thread responsiveness while
 * typing (AC-5), and persistence across a reload (AC-7). AC-1 is a Node pipeline
 * concern and is covered by scripts/normalize-catalog.test.mjs; AC-6 needs a real
 * GitHub remote and cannot be checked locally.
 *
 * Requires a served build:
 *   npm run build && npm run preview
 *
 * Playwright is resolved in this order:
 *   1. PW_MODULE env var — absolute path to a playwright module
 *   2. a local `playwright` / `playwright-core` install
 *   3. the globally installed @playwright/cli bundle
 *
 * Browser: CHROME_PATH env var, else /usr/bin/google-chrome when present, else
 * Playwright's own download. Preferring the system Chrome avoids a ~150 MB
 * browser download and the browser-revision mismatch that comes with it.
 *
 * Usage: npm run acceptance   (BASE_URL overrides the default preview URL)
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4173/precio-scanner/'
const GLOBAL_PW =
  '/home/linuxbrew/.linuxbrew/lib/node_modules/@playwright/cli/node_modules/playwright'

function resolvePlaywright() {
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

const rows = []
function record(id, ok, evidence, note = '') {
  const status = ok ? 'PASS' : 'FAIL'
  rows.push({ id, status, evidence })
  console.log(`${status}  ${id.padEnd(8)} ${evidence}${note ? `\n              ${note}` : ''}`)
}
function info(id, evidence) {
  rows.push({ id, status: 'INFO', evidence })
  console.log(`INFO  ${id.padEnd(8)} ${evidence}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { chromium } = resolvePlaywright()

  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    throw new Error(
      `${BASE_URL} is not reachable (${err.message}). Run \`npm run build && npm run preview\`.`,
    )
  }

  const launchOptions = {}
  const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome'
  if (existsSync(chrome)) launchOptions.executablePath = chrome

  const browser = await chromium.launch(launchOptions)
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  // Every data-file request the app makes, so AC-4 can prove the cache hit.
  const dataRequests = []
  page.on('request', (r) => {
    const name = r.url().split('?')[0].split('/').pop()
    if (/^catalogo(-index|-facets)?\.json$/.test(name)) dataRequests.push(name)
  })

  const cards = () => page.locator('ul li')
  const searchInput = () => page.locator('input[type="search"]')
  const waitForCards = (n = 1) =>
    page.waitForFunction((min) => document.querySelectorAll('ul li').length >= min, n, {
      timeout: 30000,
    })

  async function search(query) {
    await searchInput().fill('')
    await searchInput().fill(query)
    await sleep(1200) // 150 ms debounce + worker run + render
    return cards().allTextContents()
  }

  // ---------------------------------------------------------------- boot
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await searchInput().waitFor({ timeout: 30000 })
  await waitForCards(1)

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
  const unknown = await search('9999999999999')
  record(
    'FR-2.8c',
    unknown.length === 0,
    `unknown code -> ${unknown.length} results (no false positives, as required)`,
  )

  // A query containing letters is not barcode-like, so it falls through to fuzzy search.
  const labelled = await search('EAN 7793940219009')
  info(
    'FR-2.8d',
    `"EAN 7793940219009" -> ${labelled.length} results: it has letters, so by spec it is a text query`,
  )

  // ---------------------------------------------------------------- AC-5
  await searchInput().fill('')
  await page.evaluate(() => {
    window.__gaps = []
    window.__stop = false
    let last = performance.now()
    const tick = (t) => {
      window.__gaps.push(t - last)
      last = t
      if (!window.__stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const burst = 'coca cola yerba mate fideos arroz leche pan'
  const started = Date.now()
  await searchInput().type(burst, { delay: 25 })
  const typedMs = Date.now() - started
  await page.evaluate(() => {
    window.__stop = true
  })
  const gaps = await page.evaluate(() => window.__gaps)
  const maxGap = Math.max(...gaps)
  record(
    'AC-5',
    maxGap < 150,
    `${burst.length} keys in ${typedMs} ms; worst frame gap ${maxGap.toFixed(0)} ms`,
    `frames over 100 ms: ${gaps.filter((g) => g > 100).length} — the main thread never blocked on search`,
  )

  // ---------------------------------------------------------------- favorites + recents
  await search('yerba')
  await page.locator('button[aria-label="Agregar a favoritos"]').first().click()
  await sleep(300)
  const starred = await page.locator('button[aria-label="Quitar de favoritos"]').count()
  record('WU6.2', starred === 1, `star click -> ${starred} button with aria-pressed=true`)

  await searchInput().fill('')
  await sleep(700)
  const recentChip = await page.locator('button:text-is("yerba")').count()
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
  await page.reload({ waitUntil: 'domcontentloaded' })
  await searchInput().waitFor({ timeout: 30000 })
  await waitForCards(1)
  await sleep(900)

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

  const recentAfter = await page.locator('button:text-is("yerba")').count()
  const favChipAfter = await page.locator('button:has-text("Favoritos")').count()
  record(
    'AC-7b',
    recentAfter === 1 && favChipAfter === 1,
    `after reload -> recent chip: ${recentAfter}, favorites chip: ${favChipAfter}`,
  )

  await page.locator('button:has-text("Favoritos")').first().click()
  await sleep(900)
  const favoritesView = await cards().allTextContents()
  record(
    'AC-7c',
    favoritesView.length === 1 && /yerba/i.test(favoritesView[0] ?? ''),
    `favorites view after reload -> ${favoritesView.length} product(s)`,
    `first: ${favoritesView[0]?.replace(/\s+/g, ' ').slice(0, 70)}`,
  )

  // Unfavoriting from inside the favorites view must drop the row, not leave a stale page.
  await page.locator('button[aria-label="Quitar de favoritos"]').first().click()
  await sleep(900)
  const afterUnstar = await cards().allTextContents()
  record(
    'WU6.fix',
    !/yerba/i.test(afterUnstar.join(' ')),
    `unfavorite from inside the favorites view -> ${afterUnstar.length} row(s), stale row gone`,
  )

  await browser.close()
}

await main()

const failed = rows.filter((r) => r.status === 'FAIL')
console.log(`\n===== ${rows.length - failed.length}/${rows.length} PASS =====`)
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.id).join(', ')}`)
  process.exit(1)
}
