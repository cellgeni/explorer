// Dataset manifest (`explorer.json`): an optional JSON file that tells the
// viewer which platform a dataset is, where each file lives, and how to show
// it on first load. Without one, the viewer detects the platform from the
// standard file names (see datasetFactory.ts). The format is described in
// docs/dataset-manifest.md and public/schemas/explorer-manifest.v1.json.

import { isIcechunkUrl } from '../zarr/icechunkUrl'
import { isOmeZarrImageUrl } from '../zarr/omeZarrUrl'
import {
  ATERA_FILE_DEFAULTS,
  ATERA_OPTIONAL_FILES,
  type AteraFileRole,
} from './ateraFormat'
import {
  VISIUM_FILE_DEFAULTS,
  VISIUM_OPTIONAL_FILES,
  type VisiumAnalysisFileKey,
  type VisiumFileRole,
} from './visiumFormat'

export const DATASET_MANIFEST_FILE = 'explorer.json'
export const DATASET_MANIFEST_VERSION = 1

export const DATASET_MANIFEST_PLATFORMS = [
  'xenium',
  'atera',
  'visium',
  'visium-hd',
  'h5ad',
  'spatialdata',
  'image',
] as const

export type DatasetManifestPlatform = (typeof DATASET_MANIFEST_PLATFORMS)[number]

// Xenium files a manifest can relocate, with the standard XOA name the viewer
// uses when the manifest leaves one out.
export const XENIUM_MANIFEST_FILE_DEFAULTS = {
  experiment: 'experiment.xenium',
  cells: 'cells.parquet',
  cellBoundaries: 'cell_boundaries.parquet',
  transcripts: 'transcripts.parquet',
  transcriptsZarr: 'transcripts.zarr.zip',
  cellFeatureMatrix: 'cell_feature_matrix.zarr.zip',
  cellFeatureMatrixH5: 'cell_feature_matrix.h5',
  analysis: 'analysis.zarr.zip',
  genePanel: 'gene_panel.json',
} as const

// Xenium files without a single standard name: the morphology image comes from
// experiment.xenium, its `.zchunkstore` sidecar is looked for next to it, and
// projections are searched under analysis/.
export const XENIUM_MANIFEST_OPTIONAL_FILES = [
  'morphology',
  'morphologyZchunkstore',
  'umap',
  'tsne',
] as const

export const IMAGE_MANIFEST_FILES = ['image', 'zchunkstore'] as const

export const VISIUM_HD_MANIFEST_FILE_DEFAULTS = {
  featureSlice: 'feature_slice.h5',
  barcodeMappings: 'barcode_mappings.parquet',
} as const

export const VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS = {
  scalefactors: 'scalefactorsPath',
  filteredMatrix: 'filteredFeatureCellMatrixH5Path',
  rawMatrix: 'rawFeatureCellMatrixH5Path',
  cellSegmentations: 'cellSegmentationsGeojsonPath',
  nucleusSegmentations: 'nucleusSegmentationsGeojsonPath',
  nucleusInstanceMask: 'nucleusInstanceMaskTiffPath',
  graphclustCellSegmentations: 'graphclustAnnotatedCellSegmentationsGeojsonPath',
  graphclustNucleusSegmentations: 'graphclustAnnotatedNucleusSegmentationsGeojsonPath',
} as const

export const VISIUM_HD_MANIFEST_BIN_SIZES = [2, 8, 16] as const

export type XeniumManifestFileRole = keyof typeof XENIUM_MANIFEST_FILE_DEFAULTS
export type VisiumHdManifestFileRole = keyof typeof VISIUM_HD_MANIFEST_FILE_DEFAULTS
// Files the readers ask for by role. A manifest maps a role to another path;
// otherwise the default name is used.
export type DatasetFileRole = XeniumManifestFileRole | VisiumHdManifestFileRole
export type VisiumHdManifestSegmentedOutput =
  keyof typeof VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS

export const DATASET_FILE_DEFAULTS: Readonly<Record<DatasetFileRole, string>> = {
  ...XENIUM_MANIFEST_FILE_DEFAULTS,
  ...VISIUM_HD_MANIFEST_FILE_DEFAULTS,
}

// Display settings applied when the dataset first loads. Values in a shared
// URL take precedence. Enumerated values are checked when they are applied,
// against the same lists the controls use.
export interface DatasetManifestDefaults {
  readonly genes?: readonly string[]
  readonly colorCellsBy?: string
  readonly geneColorScale?: string
  readonly geneScoreMode?: string
  readonly cellBoundaries?: boolean
  readonly nucleusBoundaries?: boolean
  readonly channels?: readonly string[]
  readonly imageOpacity?: number
  readonly cellFillOpacity?: number
  readonly cellBoundaryOpacity?: number
  readonly transcripts?: boolean
}

// Where the data comes from, shown in the info drawer so viewers can find,
// cite, and check the licence of the original deposit.
export interface DatasetManifestSource {
  readonly repository?: string
  readonly accession?: string
  readonly url?: string
  readonly license?: string
  readonly citation?: string
}

// A manifest file entry: the path as written, and the URL it resolves to.
export interface DatasetManifestFile {
  readonly path: string
  readonly url: string
}

export interface VisiumHdManifestBin {
  readonly size: (typeof VISIUM_HD_MANIFEST_BIN_SIZES)[number]
  readonly path: string
  readonly tissuePositions?: string
  readonly scalefactors?: string
  readonly filteredMatrix?: string
}

interface DatasetManifestBase {
  readonly url: string
  // Base URL for relative paths: the manifest's folder, or `root`.
  readonly rootUrl: string
  readonly name?: string
  readonly description?: string
  readonly source?: DatasetManifestSource
  readonly defaults?: DatasetManifestDefaults
}

export interface XeniumDatasetManifest extends DatasetManifestBase {
  readonly platform: 'xenium'
  readonly files: Readonly<
    Partial<
      Record<
        XeniumManifestFileRole | (typeof XENIUM_MANIFEST_OPTIONAL_FILES)[number],
        DatasetManifestFile
      >
    >
  >
}

// Atera files use their own roles: the bundle shares few names with Xenium
// output, and the ones it shares (experiment, cells) are different files.
export interface AteraDatasetManifest extends DatasetManifestBase {
  readonly platform: 'atera'
  readonly files: Readonly<
    Partial<
      Record<AteraFileRole | (typeof ATERA_OPTIONAL_FILES)[number], DatasetManifestFile>
    >
  >
}

// Standard Visium (v1/v2) Space Ranger output. Analysis files have no single
// standard name; without an entry the Space Ranger 1.x and 2.0+ paths are
// tried.
export interface VisiumDatasetManifest extends DatasetManifestBase {
  readonly platform: 'visium'
  readonly files: Readonly<
    Partial<Record<VisiumFileRole | VisiumAnalysisFileKey, DatasetManifestFile>>
  >
}

export interface VisiumHdDatasetManifest extends DatasetManifestBase {
  readonly platform: 'visium-hd'
  readonly files: Readonly<Partial<Record<VisiumHdManifestFileRole, DatasetManifestFile>>>
  // Paths are as written, relative to `rootUrl` unless absolute.
  readonly bins?: readonly VisiumHdManifestBin[]
  readonly segmentedOutputs?: Readonly<
    Partial<Record<VisiumHdManifestSegmentedOutput, string>>
  >
  readonly options: {
    readonly binSize?: (typeof VISIUM_HD_MANIFEST_BIN_SIZES)[number]
  }
}

export interface H5adDatasetManifest extends DatasetManifestBase {
  readonly platform: 'h5ad'
  readonly files: { readonly h5ad: DatasetManifestFile }
}

export interface SpatialDataDatasetManifest extends DatasetManifestBase {
  readonly platform: 'spatialdata'
  readonly files: { readonly store: DatasetManifestFile }
  readonly options: {
    readonly coordinateSystem?: string
    readonly image?: string
    readonly micrometersPerUnit?: number
  }
}

export interface ImageDatasetManifest extends DatasetManifestBase {
  readonly platform: 'image'
  readonly files: {
    readonly image: DatasetManifestFile
    readonly zchunkstore?: DatasetManifestFile
  }
}

export type DatasetManifest =
  | XeniumDatasetManifest
  | AteraDatasetManifest
  | VisiumDatasetManifest
  | VisiumHdDatasetManifest
  | H5adDatasetManifest
  | SpatialDataDatasetManifest
  | ImageDatasetManifest

export class DatasetManifestError extends Error {
  readonly manifestUrl: string

  constructor(manifestUrl: string, message: string, options?: ErrorOptions) {
    super(`${manifestLabel(manifestUrl)}: ${message}`, options)
    this.name = 'DatasetManifestError'
    this.manifestUrl = manifestUrl
  }
}

// True when a URL names a manifest directly rather than a dataset folder.
// Zarr metadata documents also end in `.json` but are handled as Zarr.
export function isDatasetManifestUrl(url: string): boolean {
  let pathname: string

  try {
    pathname = new URL(url).pathname
  } catch {
    return false
  }

  return /\.json$/i.test(pathname) && !/(?:^|\/)zarr\.json$/i.test(pathname)
}

// A document found by probing a folder counts as a manifest when it is a JSON
// object that declares a platform or version. Hosts that answer every path
// with an HTML page or `{}` are then treated as having no manifest.
export function looksLikeDatasetManifest(json: unknown): boolean {
  return isRecord(json) && ('platform' in json || 'version' in json)
}

export function parseDatasetManifest(
  json: unknown,
  manifestUrl: string,
): DatasetManifest {
  const fail = (message: string): never => {
    throw new DatasetManifestError(manifestUrl, message)
  }

  if (!isRecord(json)) {
    return fail('expected a JSON object.')
  }

  checkKeys(json, DATASET_MANIFEST_TOP_LEVEL_KEYS, '', fail)

  if (json.version !== DATASET_MANIFEST_VERSION) {
    return fail(
      json.version === undefined
        ? `"version" is required; use ${DATASET_MANIFEST_VERSION}.`
        : `"version" ${JSON.stringify(json.version)} is not supported; this viewer reads version ${DATASET_MANIFEST_VERSION}.`,
    )
  }

  const platform = json.platform

  if (!isDatasetManifestPlatform(platform)) {
    return fail(
      `"platform" must be one of ${DATASET_MANIFEST_PLATFORMS.map((value) => `"${value}"`).join(', ')}.`,
    )
  }

  const manifestFolderUrl = parentUrl(manifestUrl)
  const root = optionalPath(json, 'root', '', fail)
  const rootUrl =
    root === undefined
      ? manifestFolderUrl
      : trimTrailingSlashes(resolve(manifestFolderUrl, root))
  const name = optionalString(json, 'name', '', fail)
  const description = optionalString(json, 'description', '', fail)
  const source = parseSource(json.source, fail)
  const defaults = parseDefaults(json.defaults, fail)
  const base: DatasetManifestBase = {
    url: manifestUrl,
    rootUrl,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(source === undefined ? {} : { source }),
    ...(defaults === undefined ? {} : { defaults }),
  }
  const files = optionalRecord(json, 'files', '', fail) ?? {}
  const options = optionalRecord(json, 'options', '', fail)
  const file = (key: string): DatasetManifestFile | undefined => {
    const path = optionalPath(files, key, 'files.', fail)
    return path === undefined ? undefined : { path, url: resolve(rootUrl, path) }
  }
  const requiredFile = (key: string): DatasetManifestFile =>
    file(key) ?? fail(`"files.${key}" is required for platform "${platform}".`)

  if (platform === 'xenium') {
    rejectOptions(options, platform, fail)
    checkKeys(
      files,
      [...Object.keys(XENIUM_MANIFEST_FILE_DEFAULTS), ...XENIUM_MANIFEST_OPTIONAL_FILES],
      'files.',
      fail,
    )
    const entries: Partial<Record<string, DatasetManifestFile>> = {}

    for (const key of Object.keys(files)) {
      entries[key] = file(key)
    }

    return { ...base, platform, files: entries }
  }

  if (platform === 'atera') {
    rejectOptions(options, platform, fail)
    checkKeys(
      files,
      [...Object.keys(ATERA_FILE_DEFAULTS), ...ATERA_OPTIONAL_FILES],
      'files.',
      fail,
    )
    const entries: Partial<Record<string, DatasetManifestFile>> = {}

    for (const key of Object.keys(files)) {
      entries[key] = file(key)
    }

    return { ...base, platform, files: entries }
  }

  if (platform === 'visium') {
    rejectOptions(options, platform, fail)
    checkKeys(
      files,
      [...Object.keys(VISIUM_FILE_DEFAULTS), ...VISIUM_OPTIONAL_FILES],
      'files.',
      fail,
    )
    const entries: Partial<Record<string, DatasetManifestFile>> = {}

    for (const key of Object.keys(files)) {
      entries[key] = file(key)
    }

    return { ...base, platform, files: entries }
  }

  if (platform === 'visium-hd') {
    checkKeys(
      files,
      [...Object.keys(VISIUM_HD_MANIFEST_FILE_DEFAULTS), 'bins', 'segmentedOutputs'],
      'files.',
      fail,
    )
    const entries: Partial<Record<string, DatasetManifestFile>> = {}

    for (const key of Object.keys(VISIUM_HD_MANIFEST_FILE_DEFAULTS)) {
      const entry = file(key)

      if (entry !== undefined) {
        entries[key] = entry
      }
    }

    const bins = parseVisiumHdBins(files.bins, fail)
    const segmentedOutputs = parseVisiumHdSegmentedOutputs(files.segmentedOutputs, fail)
    const parsedOptions: { binSize?: VisiumHdManifestBin['size'] } = {}

    if (options !== undefined) {
      checkKeys(options, ['binSize'], 'options.', fail)

      if (options.binSize !== undefined) {
        parsedOptions.binSize = parseBinSize(options.binSize, 'options.binSize', fail)
      }
    }

    if (
      parsedOptions.binSize !== undefined &&
      bins !== undefined &&
      !bins.some((bin) => bin.size === parsedOptions.binSize)
    ) {
      fail(`"options.binSize" ${parsedOptions.binSize} is not one of the listed bins.`)
    }

    return {
      ...base,
      platform,
      files: entries,
      ...(bins === undefined ? {} : { bins }),
      ...(segmentedOutputs === undefined ? {} : { segmentedOutputs }),
      options: parsedOptions,
    }
  }

  if (platform === 'h5ad') {
    rejectOptions(options, platform, fail)
    checkKeys(files, ['h5ad'], 'files.', fail)
    return { ...base, platform, files: { h5ad: requiredFile('h5ad') } }
  }

  if (platform === 'image') {
    rejectOptions(options, platform, fail)
    checkKeys(files, IMAGE_MANIFEST_FILES, 'files.', fail)
    const image = requiredFile('image')
    const zchunkstore = file('zchunkstore')

    if (
      zchunkstore !== undefined &&
      (isOmeZarrImageUrl(image.url) || isIcechunkUrl(image.url))
    ) {
      fail(
        '"files.zchunkstore" is only for TIFF images; remove it for an OME-Zarr image.',
      )
    }

    return {
      ...base,
      platform,
      files: {
        image,
        ...(zchunkstore === undefined ? {} : { zchunkstore }),
      },
    }
  }

  checkKeys(files, ['store'], 'files.', fail)
  const parsedOptions: {
    coordinateSystem?: string
    image?: string
    micrometersPerUnit?: number
  } = {}

  if (options !== undefined) {
    checkKeys(
      options,
      ['coordinateSystem', 'image', 'micrometersPerUnit'],
      'options.',
      fail,
    )
    const coordinateSystem = optionalString(options, 'coordinateSystem', 'options.', fail)
    const image = optionalString(options, 'image', 'options.', fail)

    if (coordinateSystem !== undefined) {
      parsedOptions.coordinateSystem = coordinateSystem
    }

    if (image !== undefined) {
      parsedOptions.image = image
    }

    if (options.micrometersPerUnit !== undefined) {
      if (!isPositiveNumber(options.micrometersPerUnit)) {
        fail('"options.micrometersPerUnit" must be a positive number.')
      }

      parsedOptions.micrometersPerUnit = options.micrometersPerUnit as number
    }
  }

  return {
    ...base,
    platform,
    files: { store: requiredFile('store') },
    options: parsedOptions,
  }
}

// The `.zchunkstore` sidecar a manifest names for the dataset's TIFF image.
export function manifestZchunkStoreUrl(
  manifest: DatasetManifest | undefined,
): string | undefined {
  if (manifest?.platform === 'xenium' || manifest?.platform === 'atera') {
    return manifest.files.morphologyZchunkstore?.url
  }

  if (manifest?.platform === 'image') {
    return manifest.files.zchunkstore?.url
  }

  return undefined
}

// Resolve a manifest path against a base URL. Absolute URLs pass through.
export function resolveManifestPath(baseUrl: string, path: string): string {
  return resolve(baseUrl, path)
}

export function isAbsoluteUrl(path: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(path)
}

export const DATASET_MANIFEST_TOP_LEVEL_KEYS = [
  '$schema',
  'version',
  'platform',
  'name',
  'description',
  'source',
  'root',
  'files',
  'options',
  'defaults',
] as const

export const DATASET_MANIFEST_SOURCE_KEYS = [
  'repository',
  'accession',
  'url',
  'license',
  'citation',
] as const

const DEFAULT_STRING_LIST_KEYS = ['genes', 'channels'] as const
const DEFAULT_STRING_KEYS = ['colorCellsBy', 'geneColorScale', 'geneScoreMode'] as const
const DEFAULT_BOOLEAN_KEYS = [
  'cellBoundaries',
  'nucleusBoundaries',
  'transcripts',
] as const
const DEFAULT_OPACITY_KEYS = [
  'imageOpacity',
  'cellFillOpacity',
  'cellBoundaryOpacity',
] as const

export const DATASET_MANIFEST_DEFAULT_KEYS = [
  ...DEFAULT_STRING_LIST_KEYS,
  ...DEFAULT_STRING_KEYS,
  ...DEFAULT_BOOLEAN_KEYS,
  ...DEFAULT_OPACITY_KEYS,
] as const

type Fail = (message: string) => never

function parseSource(value: unknown, fail: Fail): DatasetManifestSource | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    return fail('"source" must be an object.')
  }

  checkKeys(value, DATASET_MANIFEST_SOURCE_KEYS, 'source.', fail)
  const source: Partial<Record<(typeof DATASET_MANIFEST_SOURCE_KEYS)[number], string>> =
    {}

  for (const key of DATASET_MANIFEST_SOURCE_KEYS) {
    const entry = optionalString(value, key, 'source.', fail)

    if (entry !== undefined) {
      source[key] = entry
    }
  }

  if (source.url !== undefined && !/^https?:\/\/[^/]/i.test(source.url)) {
    fail('"source.url" must be an http(s) URL.')
  }

  return source
}

function parseDefaults(value: unknown, fail: Fail): DatasetManifestDefaults | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    return fail('"defaults" must be an object.')
  }

  checkKeys(value, DATASET_MANIFEST_DEFAULT_KEYS, 'defaults.', fail)
  const defaults: Record<string, unknown> = {}

  for (const key of DEFAULT_STRING_LIST_KEYS) {
    const entry = value[key]

    if (entry === undefined) {
      continue
    }

    if (
      !Array.isArray(entry) ||
      !entry.every((item) => typeof item === 'string' && item.trim() !== '')
    ) {
      fail(`"defaults.${key}" must be an array of non-empty strings.`)
    }

    defaults[key] = (entry as readonly string[]).map((item) => item.trim())
  }

  for (const key of DEFAULT_STRING_KEYS) {
    const entry = optionalString(value, key, 'defaults.', fail)

    if (entry !== undefined) {
      defaults[key] = entry
    }
  }

  for (const key of DEFAULT_BOOLEAN_KEYS) {
    const entry = value[key]

    if (entry === undefined) {
      continue
    }

    if (typeof entry !== 'boolean') {
      fail(`"defaults.${key}" must be true or false.`)
    }

    defaults[key] = entry
  }

  for (const key of DEFAULT_OPACITY_KEYS) {
    const entry = value[key]

    if (entry === undefined) {
      continue
    }

    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 1) {
      fail(`"defaults.${key}" must be a number from 0 to 1.`)
    }

    defaults[key] = entry
  }

  return defaults as DatasetManifestDefaults
}

function parseVisiumHdBins(
  value: unknown,
  fail: Fail,
): readonly VisiumHdManifestBin[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value) || value.length === 0) {
    return fail('"files.bins" must be a non-empty array.')
  }

  const seen = new Set<number>()

  return value.map((entry: unknown, index) => {
    const prefix = `files.bins[${index}].`

    if (!isRecord(entry)) {
      return fail(`"files.bins[${index}]" must be an object.`)
    }

    checkKeys(
      entry,
      ['size', 'path', 'tissuePositions', 'scalefactors', 'filteredMatrix'],
      prefix,
      fail,
    )
    const size = parseBinSize(entry.size, `${prefix}size`, fail)

    if (seen.has(size)) {
      fail(`"files.bins" lists the ${size} µm bin more than once.`)
    }

    seen.add(size)
    const path =
      optionalPath(entry, 'path', prefix, fail) ?? fail(`"${prefix}path" is required.`)
    const tissuePositions = optionalPath(entry, 'tissuePositions', prefix, fail)
    const scalefactors = optionalPath(entry, 'scalefactors', prefix, fail)
    const filteredMatrix = optionalPath(entry, 'filteredMatrix', prefix, fail)

    return {
      size,
      path,
      ...(tissuePositions === undefined ? {} : { tissuePositions }),
      ...(scalefactors === undefined ? {} : { scalefactors }),
      ...(filteredMatrix === undefined ? {} : { filteredMatrix }),
    }
  })
}

function parseVisiumHdSegmentedOutputs(
  value: unknown,
  fail: Fail,
): Readonly<Partial<Record<VisiumHdManifestSegmentedOutput, string>>> | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    return fail('"files.segmentedOutputs" must be an object.')
  }

  const keys = Object.keys(VISIUM_HD_MANIFEST_SEGMENTED_OUTPUTS)
  checkKeys(value, keys, 'files.segmentedOutputs.', fail)
  const outputs: Partial<Record<string, string>> = {}

  for (const key of keys) {
    const path = optionalPath(value, key, 'files.segmentedOutputs.', fail)

    if (path !== undefined) {
      outputs[key] = path
    }
  }

  return outputs
}

function parseBinSize(
  value: unknown,
  label: string,
  fail: Fail,
): VisiumHdManifestBin['size'] {
  if (!VISIUM_HD_MANIFEST_BIN_SIZES.some((size) => size === value)) {
    return fail(`"${label}" must be one of ${VISIUM_HD_MANIFEST_BIN_SIZES.join(', ')}.`)
  }

  return value as VisiumHdManifestBin['size']
}

function rejectOptions(
  options: Readonly<Record<string, unknown>> | undefined,
  platform: DatasetManifestPlatform,
  fail: Fail,
): void {
  if (options !== undefined && Object.keys(options).length > 0) {
    fail(`"options" is not used for platform "${platform}".`)
  }
}

function checkKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  prefix: string,
  fail: Fail,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      fail(
        `unknown field "${prefix}${key}". Expected one of: ${allowed
          .filter((candidate) => !candidate.startsWith('$'))
          .join(', ')}.`,
      )
    }
  }
}

function optionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  prefix: string,
  fail: Fail,
): string | undefined {
  const value = record[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return fail(`"${prefix}${key}" must be a non-empty string.`)
  }

  return value.trim()
}

function optionalPath(
  record: Readonly<Record<string, unknown>>,
  key: string,
  prefix: string,
  fail: Fail,
): string | undefined {
  const value = optionalString(record, key, prefix, fail)

  if (value === undefined) {
    return undefined
  }

  if (isAbsoluteUrl(value) && !/^https?:\/\//i.test(value)) {
    return fail(`"${prefix}${key}" must be a relative path or an http(s) URL.`)
  }

  return value.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
}

function optionalRecord(
  record: Readonly<Record<string, unknown>>,
  key: string,
  prefix: string,
  fail: Fail,
): Readonly<Record<string, unknown>> | undefined {
  const value = record[key]

  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    return fail(`"${prefix}${key}" must be an object.`)
  }

  return value
}

function resolve(baseUrl: string, path: string): string {
  if (isAbsoluteUrl(path)) {
    return path
  }

  return new URL(path, `${trimTrailingSlashes(baseUrl)}/`).toString()
}

function parentUrl(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/[^/]*$/, '')
  return trimTrailingSlashes(parsed.toString())
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

function manifestLabel(url: string): string {
  try {
    return (
      new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? DATASET_MANIFEST_FILE
    )
  } catch {
    return DATASET_MANIFEST_FILE
  }
}

function isDatasetManifestPlatform(value: unknown): value is DatasetManifestPlatform {
  return DATASET_MANIFEST_PLATFORMS.some((platform) => platform === value)
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
