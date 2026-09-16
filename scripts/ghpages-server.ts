#!/usr/bin/env node
/**
 * ghpages-server.ts — a minimal static server that reproduces GitHub Pages.
 *
 * `vite preview` (and `npm run dev`) answer unknown paths with index.html, the
 * SPA fallback built into Vite. That convenience hid a production bug: GitHub
 * Pages has no fallback, so a hard GET to /precio-scanner/buscar returned
 * GitHub's own 404 page and the app never booted. Testing the deep-link paths
 * against `vite preview` proves nothing, so this server is deliberately
 * unhelpful in exactly that way:
 *
 *   - a path that maps to an existing file under the root -> 200 + Content-Type
 *     from the extension map below;
 *   - a directory path (`/precio-scanner/`, `/precio-scanner/sub/`) -> its
 *     index.html;
 *   - any other path -> `404.html` from the root with **HTTP status 404**, which
 *     is what GitHub Pages does. That file is the app shell (written by
 *     scripts/postbuild.ts), so the app still boots and the router resolves the
 *     deep link, but the status stays 404 like production.
 *
 * Bare `/` redirects to the base path, mirroring the project-site redirect
 * GitHub Pages performs for `/` -> `/precio-scanner/`. Nothing outside the root
 * is ever served: raw `..` segments are normalized away by the URL parser before
 * the guard sees them (they land off-base and get the 404 fallback), while
 * percent-encoded escapes that survive parsing are refused with 403.
 *
 * Usage:
 *   node scripts/ghpages-server.ts [port]        (default 4173)
 *
 * Exported for scripts/acceptance.ts, which starts it over dist/ and closes it
 * in a finally when BASE_URL is not set.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Same defaults the app and the acceptance harness use. */
const DEFAULT_PORT = 4173
const DEFAULT_BASE = '/precio-scanner/'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
}

export interface GhPagesServer {
  /** Base URL of the app, e.g. http://127.0.0.1:4173/precio-scanner/ */
  url: string
  port: number
  root: string
  close(): Promise<void>
}

function sendFile(
  res: ServerResponse,
  file: string,
  status: number,
  method: string,
): void {
  const body = readFileSync(file)
  res.writeHead(status, {
    'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(body.length),
    // The acceptance harness reloads the same URL and must always hit the real
    // server, never a cached copy: GitHub Pages serves 404.html for many paths.
    'cache-control': 'no-store',
  })
  res.end(method === 'HEAD' ? undefined : body)
}

/**
 * Builds the request handler. Exported so a test or a harness could mount the
 * same semantics without a listening socket.
 */
export function createGhPagesHandler(
  root: string,
  base = DEFAULT_BASE,
): (req: IncomingMessage, res: ServerResponse) => void {
  const rootDir = resolve(root)
  const basePath = base.endsWith('/') ? base : `${base}/`
  const fallback = join(rootDir, '404.html')

  return function handle(req, res) {
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed\n')
      return
    }

    const notFound = (status = 404): void => {
      if (existsSync(fallback) && statSync(fallback).isFile()) {
        sendFile(res, fallback, status, method)
        return
      }
      // No fallback published: keep the 404 semantics (the app cannot boot),
      // rather than inventing an SPA fallback this host does not have.
      const body = `ghpages-server: no 404.html in ${rootDir}\n`
      res.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': 'no-store',
      })
      res.end(method === 'HEAD' ? undefined : body)
    }

    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('bad request\n')
      return
    }

    // The site only exists under the base path; `/` is a project-site redirect.
    if (pathname === '/') {
      res.writeHead(302, { location: basePath })
      res.end()
      return
    }
    if (!pathname.startsWith(basePath)) {
      notFound()
      return
    }

    // Traversal guard: dot segments survive percent-encoding, so compare the
    // resolved path against the root instead of trusting the raw URL.
    const target = resolve(rootDir, pathname.slice(basePath.length))
    const within = relative(rootDir, target)
    if (within.startsWith('..') || isAbsolute(within) || within.split(sep).includes('..')) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('forbidden\n')
      return
    }

    let file = target
    const isDirectory = existsSync(target) && statSync(target).isDirectory()
    if (isDirectory || pathname.endsWith('/')) {
      file = join(target, 'index.html')
    }

    if (existsSync(file) && statSync(file).isFile()) {
      sendFile(res, file, 200, method)
      return
    }
    notFound()
  }
}

/** Starts the server over `root` (default dist/) and resolves once it listens. */
export async function startServer(
  options: { port?: number; root?: string; base?: string } = {},
): Promise<GhPagesServer> {
  const root = resolve(options.root ?? 'dist')
  const index = join(root, 'index.html')
  if (!existsSync(index)) {
    throw new Error(`ghpages-server: ${index} is missing; run \`npm run build\` first`)
  }

  const base = options.base ?? DEFAULT_BASE
  const server: Server = createServer(createGhPagesHandler(root, base))
  const wanted = options.port ?? DEFAULT_PORT

  await new Promise<void>((res, rej) => {
    const onError = (err: Error) => rej(err)
    server.once('error', onError)
    server.listen(wanted, '127.0.0.1', () => {
      server.off('error', onError)
      res()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : wanted

  return {
    url: `http://127.0.0.1:${port}${base}`,
    port,
    root,
    close: () =>
      new Promise<void>((res, rej) => {
        // Keep-alive sockets would otherwise hold close() open for seconds.
        server.closeAllConnections()
        server.close((err) => (err ? rej(err) : res()))
      }),
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const portArg = process.argv[2]
  const port = portArg === undefined ? DEFAULT_PORT : Number(portArg)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`ghpages-server: invalid port "${String(portArg)}"`)
    process.exit(1)
  }
  startServer({ port })
    .then((server) => {
      console.log(
        `ghpages-server: serving ${server.root} at ${server.url} ` +
          `(unknown paths → 404.html with status 404)`,
      )
    })
    .catch((err: unknown) => {
      console.error(`ghpages-server: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    })
}
