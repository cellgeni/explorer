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
  isCollectionExample,
} from '../../scripts/examples-index.ts'
import { parseDatasetCollection } from './datasetCollection'
import {
  DATASET_MANIFEST_SOURCE_KEYS,
  parseDatasetManifest,
  type DatasetManifest,
} from './datasetManifest'

// The manifests and collections in examples/ are opened from their raw GitHub
// URLs, so they must validate as they are and their data must not point back
// into the repository.
const rootDir = process.cwd()
const allPaths = exampleManifestPaths(rootDir)

function readExample(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(rootDir, EXAMPLES_DIR, path), 'utf8')) as Record<
    string,
    unknown
  >
}

const paths = allPaths.filter((path) => !isCollectionExample(readExample(path)))
const collectionPaths = allPaths.filter((path) => isCollectionExample(readExample(path)))

function expectNamedAfterAccession(path: string, accession: string): void {
  const fileName =
    path
      .split('/')
      .at(-1)
      ?.replace(/\.json$/, '') ?? ''
  expect(
    fileName === accession || fileName.startsWith(`${accession}-`),
    `${path} is named after its accession, ${accession}`,
  ).toBe(true)
}

function expectDataOutsideExamples(manifest: DatasetManifest): void {
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

    expectNamedAfterAccession(path, manifest.source?.accession ?? '')
    expectDataOutsideExamples(manifest)
  })

  // A collection's datasets are on data hosts, or are dataset manifests in a
  // folder beside it, which the gallery does not list.
  it.each(collectionPaths)('%s is a valid collection with its source', (path) => {
    const collection = parseDatasetCollection(readExample(path), exampleManifestUrl(path))

    expect(collection.name).toBeDefined()
    expect(collection.description).toBeDefined()

    for (const key of DATASET_MANIFEST_SOURCE_KEYS) {
      expect(collection.source?.[key], `source.${key}`).toBeDefined()
    }

    expectNamedAfterAccession(path, collection.source?.accession ?? '')

    for (const entry of collection.datasets) {
      if (!entry.url.startsWith(EXAMPLES_RAW_BASE_URL)) {
        expect(entry.url).not.toContain('raw.githubusercontent.com')
        continue
      }

      const datasetPath = entry.url.slice(EXAMPLES_RAW_BASE_URL.length)
      expect(allPaths, `${datasetPath} is not listed as an example`).not.toContain(
        datasetPath,
      )
      expectDataOutsideExamples(parseDatasetManifest(readExample(datasetPath), entry.url))
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
