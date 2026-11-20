import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { manifestDefaultsToShareableState } from '../features/dataset/datasetManifestModel'
import {
  DATASET_MANIFEST_DEFAULT_KEYS,
  DATASET_MANIFEST_PLATFORMS,
  DATASET_MANIFEST_SOURCE_KEYS,
  DATASET_MANIFEST_TOP_LEVEL_KEYS,
  DATASET_IMAGE_COORDINATES,
  DatasetManifestError,
  H5AD_MANIFEST_FILES,
  H5AD_MANIFEST_OPTIONS,
  IMAGE_MANIFEST_FILES,
  VISIUM_HD_MANIFEST_BIN_SIZES,
  VISIUM_HD_MANIFEST_FILE_DEFAULTS,
  VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS,
  XENIUM_MANIFEST_FILE_DEFAULTS,
  XENIUM_MANIFEST_OPTIONAL_FILES,
  parseDatasetManifest,
} from './datasetManifest'
import { ATERA_FILE_DEFAULTS, ATERA_OPTIONAL_FILES } from './ateraFormat'
import { MERSCOPE_FILE_DEFAULTS, MERSCOPE_OPTIONAL_FILES } from './merscopeFormat'
import {
  VISIUM_FILE_DEFAULTS,
  VISIUM_MEX_LIST_FILES,
  VISIUM_OPTIONAL_FILES,
} from './visiumFormat'

// The JSON Schema in public/ is for editors; the parser is what the viewer
// enforces. These checks keep their field lists and values in step.
const schema = JSON.parse(
  readFileSync(join(process.cwd(), 'public/schemas/explorer-manifest.v1.json'), 'utf8'),
) as SchemaNode

interface SchemaNode {
  readonly properties?: Readonly<Record<string, SchemaNode>>
  readonly items?: SchemaNode
  readonly enum?: readonly unknown[]
  readonly $defs?: Readonly<Record<string, SchemaNode>>
  readonly allOf?: readonly SchemaNode[]
  readonly if?: SchemaNode
  readonly then?: SchemaNode
  readonly const?: unknown
}

function keys(node: SchemaNode | undefined): readonly string[] {
  return Object.keys(node?.properties ?? {}).sort()
}

function definition(name: string): SchemaNode | undefined {
  return schema.$defs?.[name]
}

describe('dataset manifest JSON Schema', () => {
  it('lists the top-level fields and platforms the parser accepts', () => {
    expect(keys(schema)).toEqual([...DATASET_MANIFEST_TOP_LEVEL_KEYS].sort())
    expect(schema.properties?.platform?.enum).toEqual([...DATASET_MANIFEST_PLATFORMS])
    expect(keys(definition('source'))).toEqual([...DATASET_MANIFEST_SOURCE_KEYS].sort())
  })

  it('lists the platform files the parser accepts', () => {
    expect(keys(definition('xeniumFiles'))).toEqual(
      [
        ...Object.keys(XENIUM_MANIFEST_FILE_DEFAULTS),
        ...XENIUM_MANIFEST_OPTIONAL_FILES,
      ].sort(),
    )
    expect(keys(definition('ateraFiles'))).toEqual(
      [...Object.keys(ATERA_FILE_DEFAULTS), ...ATERA_OPTIONAL_FILES].sort(),
    )
    const imagePlatform = schema.allOf?.find(
      (node) => node.if?.properties?.platform?.const === 'image',
    )
    expect(keys(imagePlatform?.then?.properties?.files)).toEqual(
      [...IMAGE_MANIFEST_FILES].sort(),
    )
    const h5adPlatform = schema.allOf?.find(
      (node) => node.if?.properties?.platform?.const === 'h5ad',
    )
    expect(keys(h5adPlatform?.then?.properties?.files)).toEqual(
      [...H5AD_MANIFEST_FILES].sort(),
    )
    expect(keys(h5adPlatform?.then?.properties?.options)).toEqual(
      [...H5AD_MANIFEST_OPTIONS].sort(),
    )
    expect(
      h5adPlatform?.then?.properties?.options?.properties?.coordinates?.enum,
    ).toEqual(DATASET_IMAGE_COORDINATES)
    expect(keys(definition('visiumFiles'))).toEqual(
      [
        ...Object.keys(VISIUM_FILE_DEFAULTS),
        ...VISIUM_MEX_LIST_FILES,
        ...VISIUM_OPTIONAL_FILES,
      ].sort(),
    )
    expect(keys(definition('merscopeFiles'))).toEqual(
      [...Object.keys(MERSCOPE_FILE_DEFAULTS), ...MERSCOPE_OPTIONAL_FILES].sort(),
    )
    expect(keys(definition('visiumHdFiles'))).toEqual(
      [
        ...Object.keys(VISIUM_HD_MANIFEST_FILE_DEFAULTS),
        'bins',
        'segmentedOutputs',
      ].sort(),
    )
    expect(keys(definition('visiumHdFiles')?.properties?.segmentedOutputs)).toEqual(
      Object.keys(VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS).sort(),
    )
    expect(
      definition('visiumHdFiles')?.properties?.bins?.items?.properties?.size?.enum,
    ).toEqual([...VISIUM_HD_MANIFEST_BIN_SIZES])
  })

  it('lists the defaults the parser accepts, with values the controls offer', () => {
    const defaults = definition('defaults')
    expect(keys(defaults)).toEqual([...DATASET_MANIFEST_DEFAULT_KEYS].sort())

    for (const key of ['colorCellsBy', 'geneColorScale', 'geneScoreMode'] as const) {
      const values = defaults?.properties?.[key]?.enum ?? []
      expect(values.length).toBeGreaterThan(0)

      for (const value of values) {
        expect(
          manifestDefaultsToShareableState({ [key]: String(value) }).ignored,
        ).toEqual([])
      }
    }
  })
})

// Editors run the schema's rules, so they may pass a file the viewer refuses
// but must not flag one it opens (EXP-031). The patterns run here as an
// editor's would, against the parser.
describe('dataset manifest JSON Schema rules', () => {
  function opens(json: object): boolean {
    try {
      parseDatasetManifest(
        { version: 1, ...json },
        'https://example.test/runs/sample-1/explorer.json',
      )
      return true
    } catch (error) {
      if (error instanceof DatasetManifestError) return false
      throw error
    }
  }

  // The node at a path of keys, from the schema or a platform's rules.
  function at(path: readonly (string | number)[], root: unknown = schema): unknown {
    return path.reduce<unknown>(
      (node, key) => (node as Record<string | number, unknown> | undefined)?.[key],
      root,
    )
  }

  function pattern(path: readonly (string | number)[], root?: unknown): RegExp {
    const source = at(path, root)
    expect(typeof source).toBe('string')
    return new RegExp(source as string)
  }

  function platformRules(platform: string): unknown {
    const rule = (schema.allOf ?? []).find(
      (node) => node.if?.properties?.platform?.const === platform,
    )
    return at(['then', 'allOf'], rule)
  }

  it('refuses a blank string wherever the parser does', () => {
    // The parser trims every string it reads and refuses a blank one.
    const strings: Record<string, unknown>[] = []
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return
      const record = node as Record<string, unknown>
      if (record.type === 'string' && record.minLength === 1) strings.push(record)
      Object.values(record).forEach(walk)
    }
    walk(schema)

    expect(strings.length).toBeGreaterThan(10)
    for (const node of strings) {
      expect(typeof node.pattern).toBe('string')
      const nonBlank = new RegExp(node.pattern as string)
      expect(nonBlank.test(' \t ')).toBe(false)
      expect(nonBlank.test(' a ')).toBe(true)
    }
    expect(opens({ platform: 'xenium', name: '  ' })).toBe(false)
  })

  it('allows the gene range percentiles the parser does', () => {
    const percentile = pattern([
      '$defs',
      'defaults',
      'properties',
      'geneRange',
      'prefixItems',
      1,
      'anyOf',
      1,
      'pattern',
    ])

    for (const value of [
      'p0',
      'p0.0',
      'p0.5',
      'p00.5',
      'p.5',
      'p1',
      'p1.',
      'p007',
      'p95',
      'p99.99',
      'p100',
      'p100.0',
      'p0100',
      'p100.5',
      'p101',
      'p150',
      'P95',
    ]) {
      expect(percentile.test(value), value).toBe(
        opens({ platform: 'xenium', defaults: { geneRange: [null, value] } }),
      )
    }
  })

  it('asks for a segmentation format only where the parser needs one', () => {
    const recognised = pattern(
      [1, 'if', 'properties', 'files', 'properties', 'segmentation', 'not', 'pattern'],
      platformRules('image'),
    )
    const opensWithout = (segmentation: string) =>
      opens({ platform: 'image', files: { image: 'i.ome.tif', segmentation } })

    for (const name of [
      'masks.tif',
      'MASKS.TIFF',
      'masks.ome.tif',
      'masks.zarr',
      'masks.zarr/',
      'masks/.zattrs',
      'store/zarr.json',
      'cells.geojson',
      'cells.json.gz',
      'cells.GeoJSON?download=1',
      'cells.parquet',
      'cells.geoparquet',
      'cells.pq',
      'cells.wkt',
      'cells.csv.gz',
      'CELLS.TXT',
      'cells.tsv#top',
      'https://example.test/cells.csv',
      'cells.csv?f=a.tif.x',
    ]) {
      expect(opensWithout(name), name).toBe(true)
      expect(recognised.test(name), name).toBe(true)
    }
    for (const name of ['masks.dat', 'masks', 'cells.json.zip', 'cells.dat?f=a.csv']) {
      expect(opensWithout(name), name).toBe(false)
      expect(recognised.test(name), name).toBe(false)
    }
  })

  it('refuses a zchunkstore only with an image the parser reads as Zarr', () => {
    const zarrImage = pattern(
      [2, 'if', 'properties', 'files', 'properties', 'image', 'pattern'],
      platformRules('image'),
    )
    const opensWith = (image: string) =>
      opens({ platform: 'image', files: { image, zchunkstore: 'i.zchunkstore' } })

    for (const image of [
      'img.ome.zarr',
      'img.ome.zarr/',
      'img.zarr/0',
      'store.zarr/zarr.json',
      'img/.zattrs',
      'img.icechunk/',
      'img.ome.zarr.zip',
      'img.ome.zarr.zip/',
      'https://example.test/img.zarr',
    ]) {
      expect(zarrImage.test(image), image).toBe(true)
      expect(opensWith(image), image).toBe(false)
    }
    for (const image of ['img.ome.tif', 'img.tif?u=a.zarr/0', 'IMG.OME.TIF']) {
      expect(zarrImage.test(image), image).toBe(false)
      expect(opensWith(image), image).toBe(true)
    }
  })

  it('checks options.binSize and each bin size once, for every size', () => {
    const sizes = [...VISIUM_HD_MANIFEST_BIN_SIZES]
    const listed = platformRules('visium-hd') as readonly unknown[]
    expect(
      listed.map((rule) =>
        at(['if', 'properties', 'options', 'properties', 'binSize', 'const'], rule),
      ),
    ).toEqual(sizes)
    const once = definition('visiumHdFiles')?.properties?.bins as
      | { readonly allOf?: readonly unknown[] }
      | undefined
    expect(
      once?.allOf?.map((rule) => at(['contains', 'properties', 'size', 'const'], rule)),
    ).toEqual(sizes)
  })
})
