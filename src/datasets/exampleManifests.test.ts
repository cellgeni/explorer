import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildExamples,
  EXAMPLES_DIR,
  EXAMPLES_INDEX_FILE,
  EXAMPLES_RAW_BASE_URL,
  EXAMPLES_README_FILE,
  exampleManifestPaths,
  exampleManifestUrl,
} from '../../scripts/examples-index.ts'
import { DATASET_MANIFEST_SOURCE_KEYS, parseDatasetManifest } from './datasetManifest'

// The manifests in examples/ are opened from their raw GitHub URLs, so they
// must validate as they are and must not point back into the repository.
const rootDir = process.cwd()
const paths = exampleManifestPaths(rootDir)

function readExample(path: string): unknown {
  return JSON.parse(readFileSync(join(rootDir, EXAMPLES_DIR, path), 'utf8'))
}

describe('example manifests', () => {
  it('has examples', () => {
    expect(paths.length).toBeGreaterThan(0)
  })

  it.each(paths)('%s is a valid manifest with its source', (path) => {
    const manifest = parseDatasetManifest(readExample(path), exampleManifestUrl(path))

    expect(manifest.name).toBeDefined()
    expect(manifest.description).toBeDefined()

    for (const key of DATASET_MANIFEST_SOURCE_KEYS) {
      expect(manifest.source?.[key], `source.${key}`).toBeDefined()
    }

    const fileName =
      path
        .split('/')
        .at(-1)
        ?.replace(/\.json$/, '') ?? ''
    const accession = manifest.source?.accession ?? ''
    expect(
      fileName === accession || fileName.startsWith(`${accession}-`),
      `${path} is named after its accession, ${accession}`,
    ).toBe(true)

    // Single-file platforms read only their files; the others also read
    // standard file names from the root.
    const readsFromRoot = !['h5ad', 'spatialdata', 'image'].includes(manifest.platform)
    const dataUrls = [
      ...(readsFromRoot ? [manifest.rootUrl] : []),
      ...Object.values(manifest.files).map((file) => file.url),
    ]

    for (const url of dataUrls) {
      expect(
        url.startsWith(EXAMPLES_RAW_BASE_URL),
        `${url} points into examples/ on GitHub`,
      ).toBe(false)
    }
  })

  it('keeps index.json and the README table up to date', async () => {
    const { index, readme } = await buildExamples(rootDir)
    const onDisk = (file: string) =>
      readFileSync(join(rootDir, EXAMPLES_DIR, file), 'utf8')

    expect(onDisk(EXAMPLES_INDEX_FILE), 'run npm run examples').toBe(index)
    expect(onDisk(EXAMPLES_README_FILE), 'run npm run examples').toBe(readme)
  })
})
