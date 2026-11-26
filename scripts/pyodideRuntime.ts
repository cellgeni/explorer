import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

// The Python console's runtime (plan 29-D1), served from the app's own host
// under `pyodide/`: the `pyodide` package's files, and NumPy's wheel, which
// the package leaves out. The wheel is fetched once from Pyodide's release by
// the name its lock file gives, checked against the lock file's SHA-256 and
// kept in node_modules/.cache. The app loads nothing from a CDN.

export const PYODIDE_DIR = 'pyodide'
export const PYODIDE_RUNTIME_FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
] as const
export const PYODIDE_PACKAGES = ['numpy'] as const

const root = path.resolve(import.meta.dirname, '..')
const packageDir = path.join(root, 'node_modules', 'pyodide')
const cacheDir = path.join(root, 'node_modules', '.cache', 'explorer-pyodide')

interface LockPackage {
  readonly file_name: string
  readonly sha256: string
}

interface PyodideFile {
  readonly name: string
  readonly path: string
}

async function pyodideVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(path.join(packageDir, 'package.json'), 'utf8'),
  ) as { version: string }
  return manifest.version
}

async function lockPackage(name: string): Promise<LockPackage> {
  const lock = JSON.parse(
    await readFile(path.join(packageDir, 'pyodide-lock.json'), 'utf8'),
  ) as { packages: Record<string, LockPackage | undefined> }
  const entry = lock.packages[name]
  if (entry === undefined) throw new Error(`Pyodide's lock file has no ${name}.`)
  return entry
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

// A package's wheel, from the cache or Pyodide's release.
export async function pyodidePackageWheel(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<PyodideFile> {
  const entry = await lockPackage(name)
  const cached = path.join(cacheDir, entry.file_name)
  if (existsSync(cached)) {
    const bytes = await readFile(cached)
    if (sha256(bytes) === entry.sha256) return { name: entry.file_name, path: cached }
  }

  const url = `https://cdn.jsdelivr.net/pyodide/v${await pyodideVersion()}/full/${entry.file_name}`
  const response = await fetcher(url)
  if (!response.ok) {
    throw new Error(`Fetching ${entry.file_name} failed: HTTP ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const actual = sha256(bytes)
  if (actual !== entry.sha256) {
    throw new Error(
      `${entry.file_name} has SHA-256 ${actual}; Pyodide's lock file says ${entry.sha256}.`,
    )
  }
  await mkdir(cacheDir, { recursive: true })
  const partial = `${cached}.${process.pid}.partial`
  await writeFile(partial, bytes)
  await rename(partial, cached)
  return { name: entry.file_name, path: cached }
}

// Every file the console loads, by its name under `pyodide/`.
export async function pyodideFiles(): Promise<readonly PyodideFile[]> {
  const wheels = await Promise.all(
    PYODIDE_PACKAGES.map((name) => pyodidePackageWheel(name)),
  )
  return [
    ...PYODIDE_RUNTIME_FILES.map((name) => ({ name, path: path.join(packageDir, name) })),
    ...wheels,
  ]
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.whl': 'application/zip',
}

// Copies the files into the build, and serves them in development.
export function pyodideRuntime(): Plugin {
  let files: Promise<readonly PyodideFile[]> | null = null
  const loadFiles = () => (files ??= pyodideFiles())

  return {
    name: 'pyodide-runtime',
    configureServer(server) {
      const prefix = `${server.config.base}${PYODIDE_DIR}/`
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0] ?? ''
        if (!url.startsWith(prefix)) {
          next()
          return
        }
        const name = url.slice(prefix.length)
        loadFiles()
          .then(async (all) => {
            const file = all.find((candidate) => candidate.name === name)
            if (file === undefined) {
              next()
              return
            }
            response.setHeader(
              'Content-Type',
              CONTENT_TYPES[path.extname(name)] ?? 'application/octet-stream',
            )
            response.end(await readFile(file.path))
          })
          .catch(next)
      })
    },
    async generateBundle() {
      for (const file of await loadFiles()) {
        this.emitFile({
          type: 'asset',
          fileName: `${PYODIDE_DIR}/${file.name}`,
          source: await readFile(file.path),
        })
      }
    },
  }
}
