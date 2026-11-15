import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DATASET_COLLECTION_DEFAULT_KEYS,
  DATASET_COLLECTION_ENTRY_KEYS,
  DATASET_COLLECTION_TOP_LEVEL_KEYS,
  MAX_COLLECTION_DATASETS,
  parseDatasetCollection,
} from './datasetCollection'
import {
  DATASET_IMAGE_COORDINATES,
  DATASET_MANIFEST_SOURCE_KEYS,
} from './datasetManifest'

// The JSON Schema in public/ is for editors; the parser is what the viewer
// enforces. These checks keep their field lists and values in step.
interface SchemaNode {
  readonly properties?: Readonly<Record<string, SchemaNode>>
  readonly items?: SchemaNode
  readonly enum?: readonly unknown[]
  readonly maxItems?: number
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

  it('offers the same default values as the dataset manifest', () => {
    for (const key of DATASET_COLLECTION_DEFAULT_KEYS) {
      expect(schema.$defs?.defaults?.properties?.[key]?.enum).toEqual(
        manifestSchema.$defs?.defaults?.properties?.[key]?.enum,
      )
    }
  })
})

// The collections in docs/collections/ are opened from their raw GitHub URLs.
describe('documented collections', () => {
  const folder = join(process.cwd(), 'docs/collections')
  const files = readdirSync(folder).filter((file) => file.endsWith('.json'))

  it.each(files)('%s is a valid collection with absolute dataset URLs', (file) => {
    const collection = parseDatasetCollection(
      JSON.parse(readFileSync(join(folder, file), 'utf8')),
      `https://raw.githubusercontent.com/cellgeni/explorer/main/docs/collections/${file}`,
    )

    expect(collection.name).toBeDefined()

    for (const entry of collection.datasets) {
      expect(entry.url).not.toContain('raw.githubusercontent.com')
    }
  })
})
