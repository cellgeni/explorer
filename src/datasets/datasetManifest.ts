// Dataset manifest (`explorer.json`): an optional JSON file that tells the
// viewer which platform a dataset is, where each file lives, and how to show
// it on first load. Without one, the viewer detects the platform from the
// standard file names (see datasetFactory.ts). The format is described in
// docs/dataset-manifest.md and public/schemas/explorer-manifest.v1.json.

import { isIcechunkUrl } from '../zarr/icechunkUrl'
import {
  isSegmentationFormat,
  SEGMENTATION_FORMATS,
  segmentationFormatFromName,
  type SegmentationCoordinates,
  type SegmentationFormat,
  type SegmentationSource,
} from './segmentationSource'
import { isOmeZarrImageUrl } from '../zarr/omeZarrUrl'
import { isZarrZipUrl } from '../zarr/zarrZipUrl'
import {
  ATERA_FILE_DEFAULTS,
  ATERA_OPTIONAL_FILES,
  type AteraFileRole,
} from './ateraFormat'
import {
  MERSCOPE_FILE_DEFAULTS,
  MERSCOPE_OPTIONAL_FILES,
  type MerscopeFileRole,
  type MerscopeOptionalFile,
} from './merscopeFormat'
import {
  VISIUM_FILE_DEFAULTS,
  VISIUM_MEX_LIST_FILES,
  VISIUM_OPTIONAL_FILES,
  type VisiumAnalysisFileKey,
  type VisiumFileRole,
  type VisiumMexListFile,
} from './visiumFormat'

export const DATASET_MANIFEST_FILE = 'explorer.json'
export const DATASET_MANIFEST_VERSION = 1

export const DATASET_MANIFEST_PLATFORMS = [
  'xenium',
  'atera',
  'visium',
  'visium-hd',
  'merscope',
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
  nucleusBoundaries: 'nucleus_boundaries.parquet',
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

export const IMAGE_MANIFEST_FILES = ['image', 'zchunkstore', 'segmentation'] as const

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
  // The Gene scale's range, [min, max]; null leaves that end on Auto. max may
  // be a percentile of each dataset's scores above 0, such as "p95".
  readonly geneRange?: readonly [number | null, number | string | null]
  readonly geneScoreMode?: string
  readonly cellBoundaries?: boolean
  readonly nucleusBoundaries?: boolean
  readonly channels?: readonly string[]
  readonly imageOpacity?: number
  readonly cellFillOpacity?: number
  readonly cellBoundaryOpacity?: number
  // The Cell point size multiplier; snapped to the slider's steps.
  readonly cellPointScale?: number
  readonly transcripts?: boolean
  // `3d` opens an OME-Zarr z-stack in the 3D view.
  readonly imageView?: string
  // `3d` opens cells placed in 3D in the 3D view.
  readonly cellView?: string
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
    Partial<
      Record<
        VisiumFileRole | VisiumMexListFile | VisiumAnalysisFileKey,
        DatasetManifestFile
      >
    >
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

// Vizgen MERSCOPE region output. Files without an entry use the instrument's
// names; vpt re-segmentation and GEO deposits name theirs.
export interface MerscopeDatasetManifest extends DatasetManifestBase {
  readonly platform: 'merscope'
  readonly files: Readonly<
    Partial<Record<MerscopeFileRole | MerscopeOptionalFile, DatasetManifestFile>>
  >
}

// How an AnnData table's cell coordinates relate to its image: micrometres,
// as the viewer reads AnnData coordinates, or the image's full-resolution
// pixels, as WebAtlas writes `obsm/X_spatial`.
export const DATASET_IMAGE_COORDINATES = ['micrometers', 'image-pixels'] as const

export type DatasetImageCoordinates = (typeof DATASET_IMAGE_COORDINATES)[number]

// An image shown under an AnnData dataset's cells, named by an H5AD manifest
// or a collection entry.
export interface DatasetImageAttachment {
  // As written.
  readonly path: string
  readonly url: string
  readonly coordinates: DatasetImageCoordinates
  // A segmentation drawn as cell boundaries: a label mask covering the image
  // (OME-Zarr or TIFF), or polygons (Parquet, GeoJSON, WKT).
  readonly labels?: DatasetManifestFile
  // The format of `labels` when its name does not tell it.
  readonly labelsFormat?: SegmentationFormat
  // What polygon coordinates are in; the cells' `coordinates` by default.
  readonly labelsCoordinates?: DatasetImageCoordinates
  // The obs column holding each cell's label value, or its polygon's ID.
  // Without it, the SpatialData instance key the table records, else the obs
  // names (for polygons, whichever matches most).
  readonly labelColumn?: string
}

export const H5AD_MANIFEST_FILES = ['h5ad', 'image', 'labels'] as const

export const H5AD_MANIFEST_OPTIONS = [
  'coordinates',
  'labelsFormat',
  'labelsCoordinates',
  'labelColumn',
] as const

export interface H5adDatasetManifest extends DatasetManifestBase {
  readonly platform: 'h5ad'
  readonly files: {
    // An .h5ad file, an AnnData Zarr store or an Icechunk repository.
    readonly h5ad: DatasetManifestFile
    readonly image?: DatasetManifestFile
    readonly labels?: DatasetManifestFile
  }
  readonly options: {
    readonly coordinates?: DatasetImageCoordinates
    readonly labelsFormat?: SegmentationFormat
    readonly labelsCoordinates?: DatasetImageCoordinates
    readonly labelColumn?: string
  }
}

export interface SpatialDataDatasetManifest extends DatasetManifestBase {
  readonly platform: 'spatialdata'
  readonly files: { readonly store: DatasetManifestFile }
  readonly options: {
    readonly table?: string
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
    // A segmentation to show over the image (plan 25): a label mask or
    // polygon file.
    readonly segmentation?: DatasetManifestFile
  }
  readonly options?: {
    // The segmentation's format when its name does not tell it.
    readonly segmentationFormat?: SegmentationFormat
    // What its polygon coordinates are in; image pixels by default.
    readonly segmentationCoordinates?: SegmentationCoordinates
  }
}

export type DatasetManifest =
  | XeniumDatasetManifest
  | AteraDatasetManifest
  | VisiumDatasetManifest
  | VisiumHdDatasetManifest
  | MerscopeDatasetManifest
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

// A dataset collection (datasetCollection.ts) read as a dataset manifest: a
// `.json` address, or a folder whose `explorer.json` is one. The viewer opens
// `manifestUrl` as a collection instead; the message is for other readers.
// The name stays DatasetManifestError's, which error reports go by.
export class DatasetIsCollectionError extends DatasetManifestError {
  constructor(manifestUrl: string) {
    super(
      manifestUrl,
      'this is a dataset collection; open it with collection= in the address instead of dataset=.',
    )
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

  // A collection (datasetCollection.ts) lists datasets instead of describing
  // one, and is opened with `collection=`.
  if ('datasets' in json && !('platform' in json)) {
    throw new DatasetIsCollectionError(manifestUrl)
  }

  // Before the field check: a newer version's fields are unknown here, and
  // the version is what the author can act on (EXP-215).
  if (json.version !== DATASET_MANIFEST_VERSION) {
    return fail(
      json.version === undefined
        ? `"version" is required; use ${DATASET_MANIFEST_VERSION}.`
        : `"version" ${JSON.stringify(json.version)} is not supported; this viewer reads version ${DATASET_MANIFEST_VERSION}.`,
    )
  }

  checkKeys(json, DATASET_MANIFEST_TOP_LEVEL_KEYS, '', fail)

  const platform = json.platform

  if (!isDatasetManifestPlatform(platform)) {
    return fail(
      `"platform" must be one of ${DATASET_MANIFEST_PLATFORMS.map((value) => `"${value}"`).join(', ')}.`,
    )
  }

  // The manifest's folder keeps the manifest address's query: a host that
  // grants the folder by query (an Azure SAS token) wants it on every file.
  const manifestFolderUrl = `${parentUrl(manifestUrl)}${new URL(manifestUrl).search}`
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
      [
        ...Object.keys(VISIUM_FILE_DEFAULTS),
        ...VISIUM_MEX_LIST_FILES,
        ...VISIUM_OPTIONAL_FILES,
      ],
      'files.',
      fail,
    )
    const entries: Partial<Record<string, DatasetManifestFile>> = {}

    for (const key of Object.keys(files)) {
      entries[key] = file(key)
    }

    return { ...base, platform, files: entries }
  }

  if (platform === 'merscope') {
    rejectOptions(options, platform, fail)
    checkKeys(
      files,
      [...Object.keys(MERSCOPE_FILE_DEFAULTS), ...MERSCOPE_OPTIONAL_FILES],
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
    checkKeys(files, H5AD_MANIFEST_FILES, 'files.', fail)

    if (options !== undefined) {
      checkKeys(options, H5AD_MANIFEST_OPTIONS, 'options.', fail)
    }

    const h5ad = requiredFile('h5ad')
    const attachment = parseImageAttachment(
      {
        image: optionalPath(files, 'image', 'files.', fail),
        labels: optionalPath(files, 'labels', 'files.', fail),
        coordinates: options?.coordinates,
        labelsFormat: options?.labelsFormat,
        labelsCoordinates: options?.labelsCoordinates,
        labelColumn:
          options === undefined
            ? undefined
            : optionalString(options, 'labelColumn', 'options.', fail),
      },
      {
        image: 'files.image',
        labels: 'files.labels',
        coordinates: 'options.coordinates',
        labelsFormat: 'options.labelsFormat',
        labelsCoordinates: 'options.labelsCoordinates',
        labelColumn: 'options.labelColumn',
      },
      rootUrl,
      fail,
    )

    return {
      ...base,
      platform,
      files: {
        h5ad,
        ...(attachment === undefined
          ? {}
          : { image: { path: attachment.path, url: attachment.url } }),
        ...(attachment?.labels === undefined ? {} : { labels: attachment.labels }),
      },
      options: {
        ...(attachment === undefined || options?.coordinates === undefined
          ? {}
          : { coordinates: attachment.coordinates }),
        ...(attachment?.labelsFormat === undefined
          ? {}
          : { labelsFormat: attachment.labelsFormat }),
        ...(attachment?.labelsCoordinates === undefined
          ? {}
          : { labelsCoordinates: attachment.labelsCoordinates }),
        ...(attachment?.labelColumn === undefined
          ? {}
          : { labelColumn: attachment.labelColumn }),
      },
    }
  }

  if (platform === 'image') {
    checkKeys(files, IMAGE_MANIFEST_FILES, 'files.', fail)
    const image = requiredFile('image')
    const zchunkstore = file('zchunkstore')
    const segmentation = file('segmentation')
    const imageOptions: {
      segmentationFormat?: SegmentationFormat
      segmentationCoordinates?: SegmentationCoordinates
    } = {}

    if (options !== undefined) {
      checkKeys(
        options,
        ['segmentationFormat', 'segmentationCoordinates'],
        'options.',
        fail,
      )
      const format = optionalString(options, 'segmentationFormat', 'options.', fail)
      const coordinates = optionalString(
        options,
        'segmentationCoordinates',
        'options.',
        fail,
      )

      if (format !== undefined) {
        if (isSegmentationFormat(format)) {
          imageOptions.segmentationFormat = format
        } else {
          fail(
            `"options.segmentationFormat" must be one of ${SEGMENTATION_FORMATS.map((value) => `"${value}"`).join(', ')}.`,
          )
        }
      }

      if (coordinates !== undefined) {
        if (coordinates === 'pixels' || coordinates === 'micrometers') {
          imageOptions.segmentationCoordinates = coordinates
        } else {
          fail('"options.segmentationCoordinates" must be "pixels" or "micrometers".')
        }
      }

      if (segmentation === undefined && Object.keys(imageOptions).length > 0) {
        fail(
          '"options.segmentationFormat" and "options.segmentationCoordinates" need "files.segmentation".',
        )
      }
    }

    if (
      segmentation !== undefined &&
      imageOptions.segmentationFormat === undefined &&
      segmentationFormatFromName(segmentation.url) === null
    ) {
      fail(
        '"files.segmentation" has no recognised extension; set "options.segmentationFormat".',
      )
    }

    if (
      zchunkstore !== undefined &&
      (isOmeZarrImageUrl(image.url) ||
        isIcechunkUrl(image.url) ||
        isZarrZipUrl(image.url))
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
        ...(segmentation === undefined ? {} : { segmentation }),
      },
      ...(Object.keys(imageOptions).length === 0 ? {} : { options: imageOptions }),
    }
  }

  checkKeys(files, ['store'], 'files.', fail)
  const parsedOptions: {
    table?: string
    coordinateSystem?: string
    image?: string
    micrometersPerUnit?: number
  } = {}

  if (options !== undefined) {
    checkKeys(
      options,
      ['table', 'coordinateSystem', 'image', 'micrometersPerUnit'],
      'options.',
      fail,
    )
    const table = optionalString(options, 'table', 'options.', fail)
    const coordinateSystem = optionalString(options, 'coordinateSystem', 'options.', fail)
    const image = optionalString(options, 'image', 'options.', fail)

    if (table !== undefined) {
      parsedOptions.table = table
    }

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

// An image, labels and coordinates read from `fields`; `names` say where each
// is written, for errors. `coordinates` and `labels` need an image, and the
// labels' own settings need labels.
export function parseImageAttachment(
  fields: {
    readonly image: string | undefined
    readonly labels: string | undefined
    readonly coordinates: unknown
    readonly labelsFormat: unknown
    readonly labelsCoordinates: unknown
    readonly labelColumn: string | undefined
  },
  names: {
    readonly image: string
    readonly labels: string
    readonly coordinates: string
    readonly labelsFormat: string
    readonly labelsCoordinates: string
    readonly labelColumn: string
  },
  rootUrl: string,
  fail: Fail,
): DatasetImageAttachment | undefined {
  const { image, labels, coordinates, labelsFormat, labelsCoordinates, labelColumn } =
    fields
  const withoutLabels = (
    [
      [labelsFormat, names.labelsFormat],
      [labelsCoordinates, names.labelsCoordinates],
      [labelColumn, names.labelColumn],
    ] as const
  ).find(([value]) => value !== undefined)?.[1]

  if (withoutLabels !== undefined && labels === undefined) {
    return fail(`"${withoutLabels}" needs "${names.labels}".`)
  }

  for (const [value, name] of [
    [coordinates, names.coordinates],
    [labelsCoordinates, names.labelsCoordinates],
  ] as const) {
    if (
      value !== undefined &&
      !DATASET_IMAGE_COORDINATES.includes(value as DatasetImageCoordinates)
    ) {
      return fail(
        `"${name}" must be one of ${DATASET_IMAGE_COORDINATES.map((option) => `"${option}"`).join(', ')}.`,
      )
    }
  }

  if (
    labelsFormat !== undefined &&
    (typeof labelsFormat !== 'string' || !isSegmentationFormat(labelsFormat))
  ) {
    return fail(
      `"${names.labelsFormat}" must be one of ${SEGMENTATION_FORMATS.map((option) => `"${option}"`).join(', ')}.`,
    )
  }

  if (image === undefined) {
    const without =
      coordinates !== undefined
        ? names.coordinates
        : labels !== undefined
          ? names.labels
          : undefined
    return without === undefined
      ? undefined
      : fail(`"${without}" needs "${names.image}".`)
  }

  return {
    path: image,
    url: resolve(rootUrl, image),
    coordinates: (coordinates as DatasetImageCoordinates | undefined) ?? 'micrometers',
    ...(labels === undefined
      ? {}
      : { labels: { path: labels, url: resolve(rootUrl, labels) } }),
    ...(labelsFormat === undefined
      ? {}
      : { labelsFormat: labelsFormat as SegmentationFormat }),
    ...(labelsCoordinates === undefined
      ? {}
      : { labelsCoordinates: labelsCoordinates as DatasetImageCoordinates }),
    ...(labelColumn === undefined ? {} : { labelColumn }),
  }
}

// The image an H5AD manifest pairs with its table.
export function manifestImageAttachment(
  manifest: DatasetManifest | undefined,
): DatasetImageAttachment | undefined {
  if (manifest?.platform !== 'h5ad' || manifest.files.image === undefined) {
    return undefined
  }

  const { image, labels } = manifest.files
  const { coordinates, labelsFormat, labelsCoordinates, labelColumn } = manifest.options

  return {
    ...image,
    coordinates: coordinates ?? 'micrometers',
    ...(labels === undefined ? {} : { labels }),
    ...(labelsFormat === undefined ? {} : { labelsFormat }),
    ...(labelsCoordinates === undefined ? {} : { labelsCoordinates }),
    ...(labelColumn === undefined ? {} : { labelColumn }),
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

// The segmentation an image manifest names, to import over the image.
export function manifestSegmentationSource(
  manifest: DatasetManifest | undefined,
): SegmentationSource | undefined {
  const url =
    manifest?.platform === 'image' ? manifest.files.segmentation?.url : undefined

  if (manifest?.platform !== 'image' || url === undefined) {
    return undefined
  }

  const format = manifest.options?.segmentationFormat ?? segmentationFormatFromName(url)

  return format === null
    ? undefined
    : {
        url,
        format,
        coordinates: manifest.options?.segmentationCoordinates ?? 'pixels',
      }
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
const DEFAULT_STRING_KEYS = [
  'colorCellsBy',
  'geneColorScale',
  'geneScoreMode',
  'imageView',
  'cellView',
] as const
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

const DEFAULT_POSITIVE_NUMBER_KEYS = ['cellPointScale'] as const

export const DATASET_MANIFEST_DEFAULT_KEYS = [
  ...DEFAULT_STRING_LIST_KEYS,
  ...DEFAULT_STRING_KEYS,
  ...DEFAULT_BOOLEAN_KEYS,
  ...DEFAULT_OPACITY_KEYS,
  ...DEFAULT_POSITIVE_NUMBER_KEYS,
  'geneRange',
] as const

// The field checks below are shared with the collection parser
// (datasetCollection.ts), so both formats report errors the same way.
export type Fail = (message: string) => never

export function parseSource(
  value: unknown,
  fail: Fail,
): DatasetManifestSource | undefined {
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

export function parseDefaults(
  value: unknown,
  fail: Fail,
): DatasetManifestDefaults | undefined {
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

  for (const key of DEFAULT_POSITIVE_NUMBER_KEYS) {
    const entry = value[key]

    if (entry === undefined) {
      continue
    }

    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) {
      fail(`"defaults.${key}" must be a number above 0.`)
    }

    defaults[key] = entry
  }

  if (value.geneRange !== undefined) {
    defaults.geneRange = parseGeneRange(value.geneRange, fail)
  }

  return defaults as DatasetManifestDefaults
}

// "p95": above 0, up to 100, as the viewer's links write it.
const GENE_RANGE_PERCENTILE_PATTERN = /^p(\d+(?:\.\d+)?)$/

function parseGeneRange(
  value: unknown,
  fail: Fail,
): readonly [number | null, number | string | null] {
  const isScore = (end: unknown): end is number | null =>
    end === null || (typeof end === 'number' && Number.isFinite(end))
  const isPercentile = (end: unknown): end is string => {
    if (typeof end !== 'string') return false
    const percentile = Number(GENE_RANGE_PERCENTILE_PATTERN.exec(end)?.[1])
    return percentile > 0 && percentile <= 100
  }

  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !isScore(value[0]) ||
    !(isScore(value[1]) || isPercentile(value[1])) ||
    // An Auto bottom is 0.
    (typeof value[1] === 'number' && value[1] <= (value[0] ?? 0))
  ) {
    return fail(
      '"defaults.geneRange" must be [min, max]: numbers, or null for an Auto end, with max above min (above 0 when min is null). max may also be a percentile of the scores above 0, from "p1" to "p100", such as "p95".',
    )
  }

  return [value[0], value[1]]
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

export function checkKeys(
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

export function optionalString(
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

export function optionalPath(
  record: Readonly<Record<string, unknown>>,
  key: string,
  prefix: string,
  fail: Fail,
): string | undefined {
  const value = optionalString(record, key, prefix, fail)

  if (value === undefined) {
    return undefined
  }

  // The URL parser drops tabs and line breaks, so "da\tta:" would pass the
  // scheme check below as a relative path and then read as "data:".
  if (hasControlCharacter(value)) {
    return fail(
      `"${prefix}${key}" must not contain control characters such as tabs or line breaks.`,
    )
  }

  if (isAbsoluteUrl(value) && !/^https?:\/\//i.test(value)) {
    return fail(`"${prefix}${key}" must be a relative path or an http(s) URL.`)
  }

  if (!isParsableUrl(value)) {
    return fail(`"${prefix}${key}" is not a valid URL or path.`)
  }

  const relative = value.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
  // "./run:1/a" keeps its "./": without it, "run:" reads as a scheme.
  return !isAbsoluteUrl(value) && isAbsoluteUrl(relative) ? `./${relative}` : relative
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }

  return false
}

// A URL, or a path that resolves to one against any http(s) folder.
function isParsableUrl(value: string): boolean {
  try {
    new URL(value, 'https://placeholder.invalid/folder/')
    return true
  } catch {
    return false
  }
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

// Relative paths resolve inside the base folder. A query on the base, such as
// a token that grants the folder, is kept on the files it resolves.
function resolve(baseUrl: string, path: string): string {
  if (isAbsoluteUrl(path)) {
    return path
  }

  const folder = new URL(baseUrl)
  const query = folder.search
  folder.search = ''
  folder.hash = ''
  folder.pathname = `${trimTrailingSlashes(folder.pathname)}/`
  const resolved = new URL(path, folder)

  if (resolved.search === '' && resolved.origin === folder.origin) {
    resolved.search = query
  }

  return resolved.toString()
}

export function parentUrl(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/[^/]*$/, '')
  return trimTrailingSlashes(parsed.toString())
}

export function trimTrailingSlashes(url: string): string {
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
