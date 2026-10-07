/**
 * fetch-data.test.ts — the git contract, driven by a fake runner and by real
 * offline git.
 *
 * The core (`descargarDatos` / `verificarDatos`) is exercised with an injected
 * command runner, so no test here touches the real repository, the real
 * `public/data` or the real remote. The CLI is spawned as a subprocess only for
 * the things that live in the CLI: argument errors and exit codes; the `--check`
 * runs use a fake `git` on `PATH` so "never invokes git" is an observation, not
 * a promise.
 *
 * The integration test builds its own bare origin and working clone under the
 * system temp directory, pushes a `datos` branch to it and runs the real CLI
 * there. It is fully offline: the "remote" is a local path.
 */
import { describe, it, expect } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ARCHIVOS,
  BRANCH_DEFAULT,
  DEST_DEFAULT,
  FetchDataError,
  UsoError,
  descargarDatos,
  parseArgs,
  validarContenidos,
  verificarDatos,
} from './fetch-data.ts'
import type { RunnerGit, SalidaGit } from './fetch-data.ts'

const SCRIPT = join(__dirname, 'fetch-data.ts')

/** A 40-hex commit id the fake runner pretends to be at. */
const COMMIT = 'a'.repeat(40)

const CATALOGO = JSON.stringify({
  version: 'v-catalogo',
  products: [{ id: 'p1', nombre: 'Uno', precio: 100 }],
})
const INDEX = JSON.stringify({ keys: ['uno'], fuseIndex: {} })
const FACETS = JSON.stringify({
  version: 'v-dataset-123',
  categories: ['Bebidas'],
  brands: [],
  priceBounds: { min: 0, max: 100 },
})

function bytes(s: string): Buffer {
  return Buffer.from(s, 'utf8')
}

function tmp(prefijo = 'fetch-data-test-'): string {
  return mkdtempSync(join(tmpdir(), prefijo))
}

/**
 * The three files as they travel in the `datos` branch: keyed by their path in
 * the commit, so the fake runner answers `git show <commit>:<path>` the way git
 * would.
 */
function archivosDelBranch(over: Partial<Record<string, string>> = {}): Map<string, Buffer> {
  const base: Record<string, string> = {
    'public/data/catalogo.json': CATALOGO,
    'public/data/catalogo-index.json': INDEX,
    'public/data/catalogo-facets.json': FACETS,
  }
  const m = new Map<string, Buffer>()
  for (const a of ARCHIVOS) {
    const contenido = over[a.nombre]
    if (contenido !== undefined) m.set(a.ruta, bytes(contenido))
    else m.set(a.ruta, bytes(base[a.ruta]))
  }
  return m
}

interface RunnerFalso {
  run: RunnerGit
  llamadas: string[][]
}

/**
 * A runner that answers the three commands the core issues: `fetch`,
 * `rev-parse` and `show`. Anything else is a test bug and fails loudly.
 */
function runnerFalso(
  archivos: Map<string, Buffer>,
  opts: { fetchCode?: number; commit?: string } = {},
): RunnerFalso {
  const llamadas: string[][] = []
  const run: RunnerGit = (args, _cwd): SalidaGit => {
    llamadas.push(args)
    if (args[0] === 'fetch') {
      return { code: opts.fetchCode ?? 0, stdout: Buffer.alloc(0), stderr: opts.fetchCode ? 'remote ref not found' : '' }
    }
    if (args[0] === 'rev-parse') {
      return { code: 0, stdout: bytes(`${opts.commit ?? COMMIT}\n`), stderr: '' }
    }
    if (args[0] === 'show') {
      const key = args[1].slice(args[1].indexOf(':') + 1)
      const buf = archivos.get(key)
      if (buf === undefined) return { code: 128, stdout: Buffer.alloc(0), stderr: 'path not in commit' }
      return { code: 0, stdout: buf, stderr: '' }
    }
    throw new Error(`comando inesperado en el runner falso: ${args.join(' ')}`)
  }
  return { run, llamadas }
}

/** A destination seeded with a sentinel whose bytes must survive a failure. */
const CENTINELA = Buffer.from('{"centinela":"no tocar"}\n', 'utf8')

function sembrarCentinela(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'centinela.json')
  writeFileSync(p, CENTINELA)
  return p
}

function esperarIntacto(p: string): void {
  expect(existsSync(p)).toBe(true)
  expect(readFileSync(p).equals(CENTINELA)).toBe(true)
}

function correrCli(
  cwd: string,
  args: string[] = [],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    let out = ''
    let err = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => (out += d))
    child.stderr?.on('data', (d: string) => (err += d))
    child.on('error', (e) => (err += String(e)))
    child.on('close', (code) => resolve({ code: code ?? 1, out, err }))
  })
}

/** Writes a `git` that never does anything but record that it was called. */
function gitFalso(binDir: string): { binDir: string; invocado: () => boolean } {
  mkdirSync(binDir, { recursive: true })
  const script = join(binDir, 'git')
  writeFileSync(script, `#!/bin/sh\n: > "$(dirname "$0")/invocado"\nexit 128\n`)
  chmodSync(script, 0o755)
  return { binDir, invocado: () => existsSync(join(binDir, 'invocado')) }
}

function git(args: string[], cwd: string): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} falló: ${r.stderr}`)
  }
}

describe('scripts/fetch-data.ts — core', () => {
  it('fetches the branch, validates, creates the dest and writes the exact bytes', () => {
    const dest = join(tmp(), 'anidado', 'data')
    const archivos = archivosDelBranch()
    const { run, llamadas } = runnerFalso(archivos)

    const res = descargarDatos(run, { branch: BRANCH_DEFAULT, dest, cwd: '/irrelevante' })

    for (const a of ARCHIVOS) {
      expect(readFileSync(join(dest, a.nombre)).equals(archivos.get(a.ruta)!)).toBe(true)
    }
    expect(res.branch).toBe(BRANCH_DEFAULT)
    expect(res.commit).toBe(COMMIT)
    expect(res.products).toBe(1)
    expect(res.version).toBe('v-dataset-123')

    // `--depth=1` is part of the contract, not an optimisation detail: without
    // it every deploy would download the entire history of the data branch,
    // which grows by a commit of several megabytes per day, forever.
    expect(llamadas[0]).toEqual(['fetch', '--depth=1', 'origin', 'datos'])
    expect(llamadas[1]).toEqual(['rev-parse', '--verify', 'FETCH_HEAD'])
    expect(llamadas.slice(2).map((a) => a[1])).toEqual([
      `${COMMIT}:public/data/catalogo.json`,
      `${COMMIT}:public/data/catalogo-index.json`,
      `${COMMIT}:public/data/catalogo-facets.json`,
    ])
  })

  it('honours --branch: fetches origin <branch> and names it in the result', () => {
    const dest = tmp()
    const { run, llamadas } = runnerFalso(archivosDelBranch())

    const res = descargarDatos(run, { branch: 'datos-v2', dest, cwd: '/irrelevante' })

    expect(llamadas[0]).toEqual(['fetch', '--depth=1', 'origin', 'datos-v2'])
    expect(res.branch).toBe('datos-v2')
  })

  it('fails with exit-2-class error when git fetch fails (branch absent), writing nothing', () => {
    const dest = tmp()
    const centinela = sembrarCentinela(dest)
    const { run, llamadas } = runnerFalso(archivosDelBranch(), { fetchCode: 128 })

    expect(() => descargarDatos(run, { branch: 'no-existe', dest, cwd: '/irrelevante' })).toThrow(
      FetchDataError,
    )
    expect(() => descargarDatos(run, { branch: 'no-existe', dest, cwd: '/irrelevante' })).toThrow(
      /no-existe/,
    )
    // it never got past the fetch
    expect(llamadas.every((a) => a[0] === 'fetch')).toBe(true)
    esperarIntacto(centinela)
    for (const a of ARCHIVOS) expect(existsSync(join(dest, a.nombre))).toBe(false)
  })

  it('fails naming the file when it is missing from the fetched commit', () => {
    const dest = tmp()
    const centinela = sembrarCentinela(dest)
    const archivos = archivosDelBranch()
    archivos.delete('public/data/catalogo-index.json')
    const { run } = runnerFalso(archivos)

    expect(() => descargarDatos(run, { branch: 'datos', dest, cwd: '/x' })).toThrow(/catalogo-index\.json/)
    esperarIntacto(centinela)
  })

  it('fails naming the file when it is not JSON', () => {
    const dest = tmp()
    const { run } = runnerFalso(archivosDelBranch({ 'catalogo.json': '{esto no es JSON' }))

    expect(() => descargarDatos(run, { branch: 'datos', dest, cwd: '/x' })).toThrow(/catalogo\.json/)
    expect(existsSync(join(dest, 'catalogo.json'))).toBe(false)
  })

  it('fails when catalogo.json has an empty products array', () => {
    const dest = tmp()
    const { run } = runnerFalso(
      archivosDelBranch({ 'catalogo.json': JSON.stringify({ version: 'v', products: [] }) }),
    )

    expect(() => descargarDatos(run, { branch: 'datos', dest, cwd: '/x' })).toThrow(/products/)
  })

  it('fails when catalogo.json has no products array at all', () => {
    const dest = tmp()
    const { run } = runnerFalso(archivosDelBranch({ 'catalogo.json': JSON.stringify({ version: 'v' }) }))

    expect(() => descargarDatos(run, { branch: 'datos', dest, cwd: '/x' })).toThrow(/catalogo\.json/)
  })

  it('fails when catalogo-facets.json has no version string', () => {
    const dest = tmp()
    const { run } = runnerFalso(
      archivosDelBranch({ 'catalogo-facets.json': JSON.stringify({ categories: [] }) }),
    )

    expect(() => descargarDatos(run, { branch: 'datos', dest, cwd: '/x' })).toThrow(/catalogo-facets\.json/)
  })

  it('writes nothing at all when validation fails, leaving a seeded sentinel byte-identical', () => {
    const dest = tmp()
    const centinela = sembrarCentinela(dest)
    const { run } = runnerFalso(
      archivosDelBranch({ 'catalogo-facets.json': JSON.stringify({ version: 7 }) }),
    )

    expect(() => descargarDatos(run, { branch: 'datos', dest, cwd: '/x' })).toThrow(FetchDataError)

    esperarIntacto(centinela)
    for (const a of ARCHIVOS) expect(existsSync(join(dest, a.nombre))).toBe(false)
  })

  it('validarContenidos treats an empty file as a named hard failure', () => {
    const archivos = archivosDelBranch()
    archivos.set('public/data/catalogo-index.json', Buffer.alloc(0))
    const leer = (n: string): Buffer | null => {
      const a = ARCHIVOS.find((x) => x.nombre === n)!
      return archivos.get(a.ruta) ?? null
    }

    expect(() => validarContenidos(leer)).toThrow(/catalogo-index\.json/)
  })

  it('validarContenidos reports a missing file by name', () => {
    expect(() => validarContenidos(() => null)).toThrow(/catalogo\.json/)
  })
})

describe('scripts/fetch-data.ts — --check', () => {
  it('passes on valid existing files and reports products and version, without any runner', () => {
    const dest = tmp()
    writeFileSync(join(dest, 'catalogo.json'), CATALOGO)
    writeFileSync(join(dest, 'catalogo-index.json'), INDEX)
    writeFileSync(join(dest, 'catalogo-facets.json'), FACETS)

    const res = verificarDatos(dest)

    expect(res).toEqual({ products: 1, version: 'v-dataset-123' })
  })

  it('fails on a missing file, naming it', () => {
    const dest = tmp()
    writeFileSync(join(dest, 'catalogo.json'), CATALOGO)
    writeFileSync(join(dest, 'catalogo-facets.json'), FACETS)

    expect(() => verificarDatos(dest)).toThrow(/catalogo-index\.json/)
  })

  it('fails on an invalid file, naming it', () => {
    const dest = tmp()
    writeFileSync(join(dest, 'catalogo.json'), CATALOGO)
    writeFileSync(join(dest, 'catalogo-index.json'), 'no soy JSON')
    writeFileSync(join(dest, 'catalogo-facets.json'), FACETS)

    expect(() => verificarDatos(dest)).toThrow(/catalogo-index\.json/)
  })

  it('does not modify the files it checks', () => {
    const dest = tmp()
    const antes = new Map<string, Buffer>()
    for (const a of ARCHIVOS) {
      const contenido = a.nombre === 'catalogo.json' ? CATALOGO : a.nombre === 'catalogo-index.json' ? INDEX : FACETS
      writeFileSync(join(dest, a.nombre), contenido)
      antes.set(a.nombre, readFileSync(join(dest, a.nombre)))
    }

    verificarDatos(dest)

    for (const a of ARCHIVOS) {
      expect(readFileSync(join(dest, a.nombre)).equals(antes.get(a.nombre)!)).toBe(true)
    }
  })
})

describe('scripts/fetch-data.ts — parseArgs', () => {
  it('defaults to branch datos and dest public/data, without --check', () => {
    expect(parseArgs([])).toEqual({ branch: BRANCH_DEFAULT, dest: DEST_DEFAULT, check: false })
  })

  it('reads --branch, --dest and --check', () => {
    expect(parseArgs(['--branch', 'x', '--dest', 'y', '--check'])).toEqual({
      branch: 'x',
      dest: 'y',
      check: true,
    })
  })

  it('returns help for --help and -h', () => {
    expect(parseArgs(['--help'])).toEqual({ help: true })
    expect(parseArgs(['-h'])).toEqual({ help: true })
  })

  it('rejects an unknown option, a missing value and a stray positional', () => {
    expect(() => parseArgs(['--nope'])).toThrow(UsoError)
    expect(() => parseArgs(['--branch'])).toThrow(UsoError)
    expect(() => parseArgs(['--dest'])).toThrow(UsoError)
    expect(() => parseArgs(['suelto'])).toThrow(UsoError)
  })
})

describe('scripts/fetch-data.ts — CLI', () => {
  it('--help exits 0 and documents both exit codes', async () => {
    const r = await correrCli(tmp(), ['--help'])

    expect(r.code).toBe(0)
    expect(r.out).toMatch(/--branch/)
    expect(r.out).toMatch(/--dest/)
    expect(r.out).toMatch(/--check/)
    expect(r.out).toMatch(/0[^\n]*ok/i)
    expect(r.out).toMatch(/1[^\n]*(argument|uso)/i)
    expect(r.out).toMatch(/2[^\n]*(datos|fetch|valid)/i)
  })

  it('an unknown option exits 1', async () => {
    const r = await correrCli(tmp(), ['--nope'])

    expect(r.code).toBe(1)
    expect(r.err).toMatch(/--nope/)
  })

  it('--check on valid files exits 0 with the summary and never runs git', async () => {
    const dest = tmp()
    writeFileSync(join(dest, 'catalogo.json'), CATALOGO)
    writeFileSync(join(dest, 'catalogo-index.json'), INDEX)
    writeFileSync(join(dest, 'catalogo-facets.json'), FACETS)
    const falso = gitFalso(tmp())

    const r = await correrCli(dest, ['--check', '--dest', '.'], { PATH: falso.binDir })

    expect(r.code).toBe(0)
    expect(r.out).toContain('1')
    expect(r.out).toContain('v-dataset-123')
    expect(falso.invocado()).toBe(false)
  })

  it('--check on missing files exits 2, names the file and never runs git', async () => {
    const dest = tmp()
    writeFileSync(join(dest, 'catalogo.json'), CATALOGO)
    const falso = gitFalso(tmp())

    const r = await correrCli(dest, ['--check', '--dest', '.'], { PATH: falso.binDir })

    expect(r.code).toBe(2)
    expect(r.err).toMatch(/catalogo-index\.json/)
    expect(falso.invocado()).toBe(false)
  })

  it('--check on an invalid file exits 2', async () => {
    const dest = tmp()
    writeFileSync(join(dest, 'catalogo.json'), CATALOGO)
    writeFileSync(join(dest, 'catalogo-index.json'), 'no soy JSON')
    writeFileSync(join(dest, 'catalogo-facets.json'), FACETS)

    const r = await correrCli(dest, ['--check', '--dest', '.'])

    expect(r.code).toBe(2)
    expect(r.err).toMatch(/catalogo-index\.json/)
  })

  it('--check on an empty products array exits 2', async () => {
    const dest = tmp()
    writeFileSync(join(dest, 'catalogo.json'), JSON.stringify({ version: 'v', products: [] }))
    writeFileSync(join(dest, 'catalogo-index.json'), INDEX)
    writeFileSync(join(dest, 'catalogo-facets.json'), FACETS)

    const r = await correrCli(dest, ['--check', '--dest', '.'])

    expect(r.code).toBe(2)
    expect(r.err).toMatch(/catalogo\.json/)
    expect(r.err).toMatch(/products/)
  })
})

describe('scripts/fetch-data.ts — real git, no network', () => {
  it(
    'fetches a datos branch from a local bare origin and writes the files',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'fetch-data-git-'))
      try {
        const bare = join(root, 'origen.git')
        const seed = join(root, 'seed')
        const run = join(root, 'run')
        const dest = join(run, 'datos-descargados')

        git(['init', '--bare', '-b', 'datos', bare], root)
        git(['init', '-b', 'main', seed], root)
        git(['-C', seed, 'config', 'user.email', 'test@ejemplo.com'], root)
        git(['-C', seed, 'config', 'user.name', 'Test'], root)
        mkdirSync(join(seed, 'public', 'data'), { recursive: true })
        writeFileSync(join(seed, 'public', 'data', 'catalogo.json'), CATALOGO)
        writeFileSync(join(seed, 'public', 'data', 'catalogo-index.json'), INDEX)
        writeFileSync(join(seed, 'public', 'data', 'catalogo-facets.json'), FACETS)
        git(['-C', seed, 'add', 'public/data'], root)
        git(['-C', seed, 'commit', '-m', 'datos'], root)
        git(['-C', seed, 'branch', '-M', 'datos'], root)
        git(['-C', seed, 'remote', 'add', 'origin', bare], root)
        git(['-C', seed, 'push', 'origin', 'datos'], root)

        git(['init', '-b', 'main', run], root)
        git(['-C', run, 'remote', 'add', 'origin', bare], root)

        const ok = await correrCli(run, ['--dest', dest])

        expect(ok.code).toBe(0)
        expect(readFileSync(join(dest, 'catalogo.json'), 'utf8')).toBe(CATALOGO)
        expect(readFileSync(join(dest, 'catalogo-index.json'), 'utf8')).toBe(INDEX)
        expect(readFileSync(join(dest, 'catalogo-facets.json'), 'utf8')).toBe(FACETS)
        expect(ok.out).toContain('datos')
        expect(ok.out).toContain('v-dataset-123')
        expect(ok.out).toContain('1')

        // A branch that does not exist is a loud exit 2 and writes nothing.
        const malo = await correrCli(run, ['--branch', 'no-existe', '--dest', join(run, 'otro')])
        expect(malo.code).toBe(2)
        expect(existsSync(join(run, 'otro'))).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
    30_000,
  )
})
