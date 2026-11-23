import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DATASET_COLLECTION_DEFAULT_KEYS,
  DATASET_COLLECTION_ENTRY_KEYS,
  DATASET_COLLECTION_TOP_LEVEL_KEYS,
  DatasetCollectionError,
  MAX_COLLECTION_DATASETS,
  parseDatasetCollection,
} from './datasetCollection'
import {
  DATASET_IMAGE_COORDINATES,
  DATASET_MANIFEST_SOURCE_KEYS,
  parseDatasetManifest,
} from './datasetManifest'

// The JSON Schema in public/ is for editors; the parser is what the viewer
// enforces. These checks keep their field lists and values in step.
interface SchemaNode {
  readonly properties?: Readonly<Record<string, SchemaNode>>
  readonly items?: SchemaNode
  readonly enum?: readonly unknown[]
  readonly maxItems?: number
  readonly uniqueItems?: boolean
  readonly $defs?: Readonly<Record<string, SchemaNode>>
}

function readSchema(file: string): SchemaNode {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'public/schemas', file), 'utf8'),
  ) as SchemaNode
}

const schema = readSchema('explorer-collection.v1.json')
const manifestSchema = readSchema('explorer-manifest.v1.json')

function keys(node: SchemaNode | undefined): readonly string[] {
  return Object.keys(node?.properties ?? {}).sort()
}

describe('dataset collection JSON Schema', () => {
  it('lists the fields the parser accepts', () => {
    expect(keys(schema)).toEqual([...DATASET_COLLECTION_TOP_LEVEL_KEYS].sort())
    expect(keys(schema.$defs?.dataset)).toEqual([...DATASET_COLLECTION_ENTRY_KEYS].sort())
    expect(keys(schema.$defs?.source)).toEqual([...DATASET_MANIFEST_SOURCE_KEYS].sort())
    expect(keys(schema.$defs?.defaults)).toEqual(
      [...DATASET_COLLECTION_DEFAULT_KEYS].sort(),
    )
    expect(schema.properties?.datasets?.maxItems).toBe(MAX_COLLECTION_DATASETS)
    expect(schema.$defs?.dataset?.properties?.coordinates?.enum).toEqual(
      DATASET_IMAGE_COORDINATES,
    )
  })

  // Editors may pass a collection the viewer refuses, such as one naming a
  // dataset twice in two spellings, but must not flag one it opens (EXP-031).
  it('refuses blank strings and repeated entries, as the parser does', () => {
    const strings: Record<string, unknown>[] = []
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return
      const record = node as Record<string, unknown>
      if (record.type === 'string' && record.minLength === 1) strings.push(record)
      Object.values(record).forEach(walk)
    }
    walk(schema)

    expect(strings.length).toBeGreaterThan(5)
    for (const node of strings) {
      expect(typeof node.pattern).toBe('string')
      const nonBlank = new RegExp(node.pattern as string)
      expect(nonBlank.test(' \t ')).toBe(false)
      expect(nonBlank.test(' a ')).toBe(true)
    }

    expect(schema.properties?.datasets?.uniqueItems).toBe(true)
    expect(() =>
      parseDatasetCollection(
        { version: 1, datasets: [{ dataset: 'a' }, { dataset: 'a' }] },
        'https://example.test/collection.json',
      ),
    ).toThrow(DatasetCollectionError)
  })

  it('offers the same default values as the dataset manifest', () => {
    for (const key of DATASET_COLLECTION_DEFAULT_KEYS) {
      expect(schema.$defs?.defaults?.properties?.[key]).toEqual(
        manifestSchema.$defs?.defaults?.properties?.[key],
      )
    }
  })
})

// The collections in docs/collections/ are opened from their raw GitHub URLs,
// so their datasets must be on data hosts, or be dataset manifests in this
// repository that point at the data there.
describe('documented collections', () => {
  const rawMain = 'https://raw.githubusercontent.com/cellgeni/explorer/main/'
  const folder = join(process.cwd(), 'docs/collections')
  const files = readdirSync(folder).filter((file) => file.endsWith('.json'))

  it.each(files)('%s is a valid collection with readable dataset URLs', (file) => {
    const collection = parseDatasetCollection(
      JSON.parse(readFileSync(join(folder, file), 'utf8')),
      `${rawMain}docs/collections/${file}`,
    )

    expect(collection.name).toBeDefined()

    for (const entry of collection.datasets) {
      if (!entry.url.startsWith(rawMain)) {
        expect(entry.url).not.toContain('raw.githubusercontent.com')
        continue
      }

      const path = entry.url.slice(rawMain.length)
      const manifest = parseDatasetManifest(
        JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')),
        entry.url,
      )

      for (const manifestFile of Object.values(manifest.files)) {
        expect(manifestFile.url, `${path} points at its data`).not.toContain(
          'raw.githubusercontent.com',
        )
      }
    }
  })
})
