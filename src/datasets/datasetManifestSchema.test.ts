import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { manifestDefaultsToShareableState } from '../features/dataset/datasetManifestModel'
import {
  DATASET_MANIFEST_DEFAULT_KEYS,
  DATASET_MANIFEST_PLATFORMS,
  DATASET_MANIFEST_TOP_LEVEL_KEYS,
  VISIUM_HD_MANIFEST_BIN_SIZES,
  VISIUM_HD_MANIFEST_FILE_DEFAULTS,
  VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS,
  XENIUM_MANIFEST_FILE_DEFAULTS,
  XENIUM_MANIFEST_OPTIONAL_FILES,
} from './datasetManifest'
import { ATERA_FILE_DEFAULTS, ATERA_OPTIONAL_FILES } from './ateraFormat'

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
