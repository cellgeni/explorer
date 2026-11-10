// Builds examples/index.json and the table in examples/README.md from the
// example manifests in examples/<repository>/<ACCESSION>[-<slug>].json.
//
//   node scripts/examples-index.ts           write both files
//   node scripts/examples-index.ts --check   exit 1 if either is out of date
//
// Each example is linked through its raw.githubusercontent.com URL on main, so
// fixing a manifest takes effect without a viewer release. Both files go
// through Prettier, so the output also passes `npm run format:check`.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { format, resolveConfig } from 'prettier'

export const EXAMPLES_DIR = 'examples'
export const EXAMPLES_INDEX_FILE = 'index.json'
export const EXAMPLES_README_FILE = 'README.md'
export const EXAMPLES_RAW_BASE_URL =
  'https://raw.githubusercontent.com/cellgeni/explorer/main/examples/'
export const EXAMPLES_VIEWER_URL = 'https://cellgeni.github.io/explorer/'

const README_START = '<!-- examples:start -->'
const README_END = '<!-- examples:end -->'

export interface ExampleSource {
  readonly repository?: string
  readonly accession?: string
  readonly url?: string
  readonly license?: string
  readonly citation?: string
}

export interface ExampleEntry {
  // `<repository folder>/<file name without .json>`.
  readonly id: string
  readonly path: string
  readonly manifestUrl: string
  readonly viewerUrl: string
  readonly platform: string
  readonly name: string
  readonly description: string
  readonly source: ExampleSource
}

export interface ExamplesBuild {
  readonly entries: readonly ExampleEntry[]
  readonly index: string
  readonly readme: string
}

// Paths of the example manifests, relative to the examples folder, sorted.
export function exampleManifestPaths(rootDir: string): string[] {
  const examplesDir = join(rootDir, EXAMPLES_DIR)

  return readdirSync(examplesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((folder) =>
      readdirSync(join(examplesDir, folder.name))
        .filter((file) => file.endsWith('.json'))
        .map((file) => `${folder.name}/${file}`),
    )
    .sort()
}

export function exampleManifestUrl(path: string): string {
  return `${EXAMPLES_RAW_BASE_URL}${path}`
}

export function exampleViewerUrl(manifestUrl: string): string {
  return `${EXAMPLES_VIEWER_URL}?dataset=${manifestUrl}`
}

export async function buildExamples(rootDir: string): Promise<ExamplesBuild> {
  const entries = exampleManifestPaths(rootDir).map((path): ExampleEntry => {
    const json = JSON.parse(
      readFileSync(join(rootDir, EXAMPLES_DIR, path), 'utf8'),
    ) as Record<string, unknown>
    const manifestUrl = exampleManifestUrl(path)

    return {
      id: path.replace(/\.json$/, ''),
      path,
      manifestUrl,
      viewerUrl: exampleViewerUrl(manifestUrl),
      platform: String(json.platform),
      name: String(json.name ?? path),
      description: String(json.description ?? ''),
      source: (json.source ?? {}) as ExampleSource,
    }
  })
  const indexPath = join(rootDir, EXAMPLES_DIR, EXAMPLES_INDEX_FILE)
  const readmePath = join(rootDir, EXAMPLES_DIR, EXAMPLES_README_FILE)
  const index = await prettierFormat(
    indexPath,
    JSON.stringify({ version: 1, examples: entries }),
  )
  const readme = await prettierFormat(
    readmePath,
    replaceReadmeTable(readFileSync(readmePath, 'utf8'), entries),
  )

  return { entries, index, readme }
}

async function prettierFormat(filepath: string, text: string): Promise<string> {
  return format(text, { ...(await resolveConfig(filepath)), filepath })
}

function replaceReadmeTable(readme: string, entries: readonly ExampleEntry[]): string {
  const start = readme.indexOf(README_START)
  const end = readme.indexOf(README_END)

  if (start === -1 || end < start) {
    throw new Error(
      `${EXAMPLES_DIR}/${EXAMPLES_README_FILE} needs ${README_START} and ${README_END} markers.`,
    )
  }

  const rows = entries.map((entry) => {
    const { repository, accession, url, license } = entry.source
    const sourceLabel = [repository, accession].filter(Boolean).join(' ')
    const source = url === undefined ? sourceLabel : `[${sourceLabel}](${url})`

    return `| [${cell(entry.name)}](${entry.viewerUrl}) | ${entry.platform} | ${cell(
      entry.description,
    )} | ${source} | ${cell(license ?? '')} | [manifest](${entry.path}) |`
  })
  const table = [
    '| Example | Platform | What it shows | Source | Licence | |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')

  return `${readme.slice(0, start + README_START.length)}\n\n${table}\n\n${readme.slice(end)}`
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
}

async function main(): Promise<void> {
  const rootDir = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const check = process.argv.includes('--check')
  const { index, readme } = await buildExamples(rootDir)
  const targets = [
    [join(rootDir, EXAMPLES_DIR, EXAMPLES_INDEX_FILE), index],
    [join(rootDir, EXAMPLES_DIR, EXAMPLES_README_FILE), readme],
  ] as const
  const stale = targets.filter(([file, content]) => {
    try {
      return readFileSync(file, 'utf8') !== content
    } catch {
      return true
    }
  })

  if (check) {
    for (const [file] of stale) {
      console.error(`${relative(rootDir, file)} is out of date; run npm run examples.`)
    }

    process.exitCode = stale.length === 0 ? 0 : 1
    return
  }

  for (const [file, content] of stale) {
    writeFileSync(file, content)
    console.log(`Wrote ${relative(rootDir, file)}`)
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
