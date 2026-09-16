#!/usr/bin/env node
/**
 * postbuild.ts — GitHub Pages SPA fallback: dist/index.html → dist/404.html
 *
 * GitHub Pages has no rewrite/fallback rule: a request for a path with no file
 * behind it is answered with GitHub's own 404 page (served with `default-src
 * 'none'`), so the app shell never loads and a hard GET to /buscar, /lista or
 * /producto/<ean> is a dead end. GitHub does serve `404.html` from the site
 * root for those requests, so publishing a copy of the shell as `dist/404.html`
 * hands the request to the SPA: the copied HTML keeps its absolute asset URLs
 * (Vite's `base: '/precio-scanner/'`), and `BrowserRouter` with
 * `basename={import.meta.env.BASE_URL}` reads the real pathname and renders the
 * right route.
 *
 * Runs as npm's `postbuild` hook, so `npm run build` publishes the fallback and
 * the deploy workflow needs no rewrite step.
 *
 * Fail-loud (exit non-zero): dist/index.html missing (build did not run), or the
 * written fallback is not byte-identical to the shell.
 *
 * Usage: node scripts/postbuild.ts   (via `npm run build`; no arguments)
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function fail(msg: string): never {
  console.error(`postbuild: ${msg}`)
  process.exit(1)
}

function main(): void {
  const dist = resolve('dist')
  const index = resolve(dist, 'index.html')
  const fallback = resolve(dist, '404.html')

  if (!existsSync(index)) {
    fail(`missing ${index}; run \`npm run build\` (this task is its postbuild hook)`)
  }

  copyFileSync(index, fallback)

  const shell = readFileSync(index)
  const written = readFileSync(fallback)
  if (!shell.equals(written)) {
    fail(
      `wrote ${fallback} but it is not byte-identical to ${index} ` +
        `(${shell.length} vs ${written.length} bytes); the fallback would serve a stale shell`,
    )
  }

  console.log(
    `postbuild: dist/index.html → dist/404.html (${written.length} bytes, byte-identical); ` +
      `GitHub Pages now serves the app shell for unknown paths`,
  )
}

main()
