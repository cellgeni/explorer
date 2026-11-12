import { EMBEDDING_CANDIDATES, analysisEmbeddingLabel } from './analysisEmbeddings'
import {
  datasetFileLabelFor,
  datasetFileUrl,
  datasetFileUrlFor,
  xeniumManifestFileFor,
} from './datasetFiles'
import { likelyMissingFileError, noteReadableResponse } from './hostResponses'
import { morphologyImagePathsFromExperiment } from './morphologyImage'
import { assertHttpRangeSupport } from './rangeSupport'
import {
  detectSpatialDataset,
  type SpatialDatasetDetection,
} from '../datasets/datasetFactory'
import type { Platform } from '../datasets/spatialDataset'
import {
  DatasetManifestError,
  type DatasetFileRole,
  type DatasetManifest,
} from '../datasets/datasetManifest'
import type { VisiumHdSegmentedOutputPaths } from '../datasets/visiumHdSegmentationModel'
import {
  VISIUM_ANALYSIS_FILE_CANDIDATES,
  VISIUM_MATRIX_MAX_BYTES,
} from '../datasets/visiumFormat'
import {
  openSpatialDataStore,
  readSpatialDataCatalog,
  selectSpatialDataView,
  type SpatialDataCatalog,
  type SpatialDataStore,
  type SpatialDataView,
} from '../datasets/spatialDataCatalog'
import { isStringArrayMetadata, zarrChunkKeys } from '../zarr/zarrStores'
import type {
  VisiumHdBinDescriptor,
  VisiumHdBinSizeMicrometers,
} from '../datasets/visiumHdDataset'
import type { RangeSupportFetcher } from './rangeSupport'
import {
  ATERA_FILE_DEFAULTS,
  parseAteraExperiment,
  type AteraExperiment,
  type AteraFileRole,
} from '../datasets/ateraFormat'

export type DatasetDiagnosticStatus = 'pass' | 'warning' | 'fail'
export type DatasetDiagnosticPlatform = Platform | 'unknown'

export interface DatasetDiagnosticCheck {
  readonly id: string
  readonly label: string
  readonly url: string
  readonly required: boolean
  readonly status: DatasetDiagnosticStatus
  readonly message: string
  readonly durationMs: number
}

export interface DatasetDiagnosticsReport {
  readonly baseUrl: string
  readonly platform: DatasetDiagnosticPlatform
  readonly startedAt: string
  readonly completedAt: string
  readonly checks: readonly DatasetDiagnosticCheck[]
}

export interface DatasetDiagnosticsOptions {
  readonly fetcher?: RangeSupportFetcher
  readonly signal?: AbortSignal
  readonly visiumHdBinSizeMicrometers?: VisiumHdBinSizeMicrometers
  readonly rangeValidator?: (
    url: string,
    options: {
      readonly fetcher?: RangeSupportFetcher
      readonly label?: string
      readonly signal?: AbortSignal
    },
  ) => Promise<void>
  readonly detectDataset?: (
    baseUrl: string,
    options: {
      readonly fetcher?: RangeSupportFetcher
      readonly signal?: AbortSignal
    },
  ) => Promise<SpatialDatasetDetection>
}

interface DatasetRoleFile {
  readonly id: string
  readonly label: string
  readonly role: DatasetFileRole
}

const XENIUM_REQUIRED_RANGE_FILES: readonly DatasetRoleFile[] = [
  { id: 'cells-parquet', label: 'Overview cells', role: 'cells' },
]

const XENIUM_OPTIONAL_RANGE_FILES: readonly DatasetRoleFile[] = [
  { id: 'cell-boundaries', label: 'Cell boundaries', role: 'cellBoundaries' },
  { id: 'transcripts', label: 'Transcripts', role: 'transcripts' },
  { id: 'transcripts-zarr', label: 'Transcript native LOD', role: 'transcriptsZarr' },
  { id: 'feature-matrix', label: 'Feature matrix', role: 'cellFeatureMatrix' },
  // ROI gene statistics fall back to it when the Zarr matrix cannot be read.
  { id: 'feature-matrix-h5', label: 'Feature matrix H5', role: 'cellFeatureMatrixH5' },
  // Cluster groups for the Annotations section.
  { id: 'analysis', label: 'Analysis clusters', role: 'analysis' },
]

// Read whole; without it the gene list comes from transcripts.zarr.zip.
const XENIUM_GENE_PANEL_FILE: DatasetRoleFile = {
  id: 'gene-panel',
  label: 'Gene panel',
  role: 'genePanel',
}

const VISIUM_HD_ROOT_RANGE_FILES: readonly DatasetRoleFile[] = [
  { id: 'visium-hd-feature-slice', label: 'Feature Slice H5', role: 'featureSlice' },
  {
    id: 'visium-hd-barcode-mappings',
    label: 'Barcode mappings',
    role: 'barcodeMappings',
  },
]

const VISIUM_HD_SEGMENTED_READABLE_FILES = [
  {
    id: 'visium-hd-segmented-scalefactors',
    label: 'Visium HD segmented scalefactors',
    path: 'segmented_outputs/spatial/scalefactors_json.json',
    output: 'scalefactorsPath',
  },
] as const satisfies readonly VisiumHdSegmentedFile[]

// Often tens of MB, so checked with HEAD; the reader also sizes them with HEAD
// before streaming them.
const VISIUM_HD_SEGMENTED_HEAD_FILES = [
  {
    id: 'visium-hd-cell-segmentations',
    label: 'Visium HD cell segmentations GeoJSON',
    path: 'segmented_outputs/cell_segmentations.geojson',
    output: 'cellSegmentationsGeojsonPath',
  },
  {
    id: 'visium-hd-nucleus-segmentations',
    label: 'Visium HD nucleus segmentations GeoJSON',
    path: 'segmented_outputs/nucleus_segmentations.geojson',
    output: 'nucleusSegmentationsGeojsonPath',
  },
  {
    id: 'visium-hd-graphclust-cell-segmentations',
    label: 'Visium HD graphclust cell segmentations GeoJSON',
    path: 'segmented_outputs/graphclust_annotated_cell_segmentations.geojson',
    output: 'graphclustAnnotatedCellSegmentationsGeojsonPath',
  },
  {
    id: 'visium-hd-graphclust-nucleus-segmentations',
    label: 'Visium HD graphclust nucleus segmentations GeoJSON',
    path: 'segmented_outputs/graphclust_annotated_nucleus_segmentations.geojson',
    output: 'graphclustAnnotatedNucleusSegmentationsGeojsonPath',
  },
] as const satisfies readonly VisiumHdSegmentedFile[]

const VISIUM_HD_SEGMENTED_RANGE_FILES = [
  {
    id: 'visium-hd-filtered-feature-cell-matrix',
    label: 'Visium HD filtered feature-cell matrix',
    path: 'segmented_outputs/filtered_feature_cell_matrix.h5',
    output: 'filteredFeatureCellMatrixH5Path',
  },
  {
    id: 'visium-hd-raw-feature-cell-matrix',
    label: 'Visium HD raw feature-cell matrix',
    path: 'segmented_outputs/raw_feature_cell_matrix.h5',
    output: 'rawFeatureCellMatrixH5Path',
  },
  {
    id: 'visium-hd-nucleus-instance-mask',
    label: 'Visium HD nucleus instance mask',
    path: 'segmented_outputs/nucleus_instance_mask.tiff',
    output: 'nucleusInstanceMaskTiffPath',
  },
] as const satisfies readonly VisiumHdSegmentedFile[]

interface VisiumHdSegmentedFile {
  readonly id: string
  readonly label: string
  readonly path: string
  readonly output: keyof VisiumHdSegmentedOutputPaths
}

export async function runDatasetDiagnostics(
  baseUrl: string,
  options: DatasetDiagnosticsOptions = {},
): Promise<DatasetDiagnosticsReport> {
  const startedAt = new Date()
  const checks: DatasetDiagnosticCheck[] = []
  const detectionStartedAt = Date.now()
  let detection: SpatialDatasetDetection

  try {
    detection = await (options.detectDataset ?? detectSpatialDataset)(baseUrl, {
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    // Checked by name, so diagnostics do not load the Icechunk reader.
    const icechunkError =
      error instanceof Error && error.name === 'IcechunkRepositoryUnavailableError'
        ? (error as Error & { readonly url: string })
        : null

    if (!(error instanceof DatasetManifestError) && icechunkError === null) {
      throw error
    }

    checks.push(
      error instanceof DatasetManifestError
        ? diagnosticCheck({
            id: 'dataset-manifest',
            label: 'Dataset manifest',
            url: error.manifestUrl,
            required: true,
            status: 'fail',
            message: error.message,
            startedAt: detectionStartedAt,
          })
        : diagnosticCheck({
            id: 'icechunk-repository',
            label: 'Icechunk repository',
            url: icechunkError?.url ?? baseUrl,
            required: true,
            status: 'fail',
            message: icechunkError?.message ?? '',
            startedAt: detectionStartedAt,
          }),
    )

    return {
      baseUrl,
      platform: 'unknown',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      checks,
    }
  }

  checks.push(detectionDiagnosticCheck(detection, detectionStartedAt))

  if (detection.platform !== 'unknown' && detection.manifest !== undefined) {
    checks.push(manifestDiagnosticCheck(detection.manifest, detectionStartedAt))
  }

  if (detection.platform === 'visium-hd') {
    checks.push(...(await runVisiumHdDiagnostics(detection, options)))

    return {
      baseUrl,
      platform: detection.platform,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      checks,
    }
  }

  if (detection.platform === 'visium') {
    checks.push(...(await runVisiumDiagnostics(detection, options)))

    return {
      baseUrl,
      platform: detection.platform,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      checks,
    }
  }

  if (detection.platform === 'h5ad') {
    checks.push(
      detection.source === 'icechunk'
        ? await checkIcechunkAnnData(detection.h5adUrl, options)
        : await checkDirectRangeFile(
            detection.h5adUrl,
            'h5ad-file',
            'H5AD file',
            true,
            options,
          ),
    )

    return {
      baseUrl,
      platform: detection.platform,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      checks,
    }
  }

  if (detection.platform === 'atera') {
    checks.push(...(await runAteraDiagnostics(detection, options)))

    return {
      baseUrl,
      platform: detection.platform,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      checks,
    }
  }

  if (detection.platform === 'spatialdata') {
    checks.push(...(await runSpatialDataDiagnostics(detection, options)))

    return {
      baseUrl,
      platform: detection.platform,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      checks,
    }
  }

  if (detection.platform === 'unknown') {
    return {
      baseUrl,
      platform: 'unknown',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      checks,
    }
  }

  // With a dataset manifest, experiment.xenium only supplies the pixel size
  // and, when the manifest names no image, the morphology image paths.
  const experiment = await checkManifest(
    baseUrl,
    detection.manifest === undefined,
    options,
  )
  checks.push(experiment.check)

  for (const file of XENIUM_REQUIRED_RANGE_FILES) {
    checks.push(await checkRangeFile(baseUrl, roleFile(baseUrl, file), true, options))
  }

  for (const file of XENIUM_OPTIONAL_RANGE_FILES) {
    checks.push(await checkRangeFile(baseUrl, roleFile(baseUrl, file), false, options))
  }

  checks.push(
    await checkReadableFile(
      baseUrl,
      roleFile(baseUrl, XENIUM_GENE_PANEL_FILE),
      false,
      options,
    ),
  )
  checks.push(...(await checkXeniumEmbeddings(baseUrl, options)))
  checks.push(await checkXeniumMorphologyImage(baseUrl, experiment.json, options))

  return {
    baseUrl,
    platform: detection.platform,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    checks,
  }
}

export function summarizeDatasetDiagnostics(report: DatasetDiagnosticsReport): string {
  const failed = report.checks.filter((check) => check.status === 'fail').length
  const warnings = report.checks.filter((check) => check.status === 'warning').length

  if (failed > 0) {
    return `${failed} failed, ${warnings} warnings`
  }

  if (warnings > 0) {
    return `${warnings} warnings`
  }

  return 'All checks passed'
}

function roleFile(
  baseUrl: string,
  file: DatasetRoleFile,
): { readonly id: string; readonly label: string; readonly path: string } {
  return { id: file.id, label: file.label, path: datasetFileUrlFor(baseUrl, file.role) }
}

function manifestDiagnosticCheck(
  manifest: DatasetManifest,
  startedAt: number,
): DatasetDiagnosticCheck {
  return diagnosticCheck({
    id: 'dataset-manifest',
    label: 'Dataset manifest',
    url: manifest.url,
    required: true,
    status: 'pass',
    message:
      manifest.name === undefined
        ? `Valid ${manifest.platform} manifest`
        : `Valid ${manifest.platform} manifest: ${manifest.name}`,
    startedAt,
  })
}

// Checks experiment.xenium and returns its JSON, which names the morphology
// images; `json` is undefined when it cannot be read.
async function checkManifest(
  baseUrl: string,
  required: boolean,
  options: DatasetDiagnosticsOptions,
): Promise<{ readonly check: DatasetDiagnosticCheck; readonly json: unknown }> {
  const url = datasetFileUrlFor(baseUrl, 'experiment')
  const startedAt = Date.now()
  const check = (status: DatasetDiagnosticStatus, message: string) =>
    diagnosticCheck({
      id: 'experiment-manifest',
      label: 'Experiment manifest',
      url,
      required,
      status,
      message,
      startedAt,
    })
  const failed = required ? 'fail' : 'warning'

  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: 'GET',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    if (!response.ok) {
      discardBody(response)
      return { check: check(failed, `HTTP ${response.status}`), json: undefined }
    }

    let json: unknown

    try {
      json = await response.json()
    } catch (cause) {
      return {
        check: check(failed, `Not valid JSON: ${errorMessage(cause)}`),
        json: undefined,
      }
    }

    return { check: check('pass', 'Readable'), json }
  } catch (cause) {
    return { check: check(failed, errorMessage(cause)), json: undefined }
  }
}

// The projections the Analysis section loads: the manifest's `umap` or
// `tsne` file, else the first standard path that exists. The CSVs are read
// whole, so HEAD shows whether they can be fetched without downloading them.
async function checkXeniumEmbeddings(
  baseUrl: string,
  options: DatasetDiagnosticsOptions,
): Promise<readonly DatasetDiagnosticCheck[]> {
  const checks: DatasetDiagnosticCheck[] = []

  for (const kind of ['umap', 'tsne'] as const) {
    const named = xeniumManifestFileFor(baseUrl, kind)
    const paths =
      named === undefined
        ? EMBEDDING_CANDIDATES.filter((candidate) => candidate.kind === kind).map(
            (candidate) => candidate.path,
          )
        : [named.url]

    checks.push(
      await checkFirstHeadFile(
        baseUrl,
        { id: `${kind}-projection`, label: `${analysisEmbeddingLabel(kind)} projection` },
        paths,
        options,
      ),
    )
  }

  return checks
}

// The first of `paths` that HEAD can read, as the viewer loads the first that
// exists. When none can, the first path's failure. Optional.
async function checkFirstHeadFile(
  baseUrl: string,
  file: { readonly id: string; readonly label: string },
  paths: readonly string[],
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const startedAt = Date.now()
  let firstFailure: DatasetDiagnosticCheck | undefined

  for (const path of paths) {
    const check = await checkHeadFile(baseUrl, { ...file, path }, false, options)

    if (check.status === 'pass') {
      return check
    }

    firstFailure ??= check
  }

  return diagnosticCheck({
    id: file.id,
    label: file.label,
    url: firstFailure?.url ?? baseUrl,
    required: false,
    status: 'warning',
    message:
      paths.length > 1
        ? `${firstFailure?.message ?? 'Not found'}; ${paths.slice(1).join(', ')} also could not be read`
        : (firstFailure?.message ?? 'Not found'),
    startedAt,
  })
}

// The image the viewer opens (loadMorphologyImage): the manifest's, else the
// first image experiment.xenium names that can be read. Paths the folder
// listing leaves out fail their Range probe without a request, as the viewer
// skips them.
async function checkXeniumMorphologyImage(
  baseUrl: string,
  experiment: unknown,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const id = 'morphology'
  const label = 'Morphology image'
  const startedAt = Date.now()
  const named = xeniumManifestFileFor(baseUrl, 'morphology')
  const candidates =
    named !== undefined
      ? [named.url]
      : experiment === undefined
        ? []
        : morphologyImagePathsFromExperiment(experiment)

  if (candidates.length === 0) {
    const experimentFile = datasetFileLabelFor(baseUrl, 'experiment')

    return diagnosticCheck({
      id,
      label,
      url: datasetFileUrlFor(baseUrl, 'experiment'),
      required: false,
      status: 'warning',
      message:
        experiment === undefined
          ? `${experimentFile} could not be read, so the viewer has no image path.`
          : `${experimentFile} names no OME-TIFF morphology image.`,
      startedAt,
    })
  }

  const failures: { readonly path: string; readonly check: DatasetDiagnosticCheck }[] = []

  for (const path of candidates) {
    const check = await checkRangeFile(baseUrl, { id, label, path }, false, options)

    if (check.status !== 'pass') {
      failures.push({ path, check })
      continue
    }

    const firstFailure = failures[0]

    return firstFailure === undefined
      ? check
      : diagnosticCheck({
          id,
          label,
          url: check.url,
          required: false,
          status: 'warning',
          message: `Byte-range readable. The viewer opens this image because ${failures
            .map((failure) => failure.path)
            .join(', ')}, named first in ${datasetFileLabelFor(
            baseUrl,
            'experiment',
          )}, could not be read: ${firstFailure.check.message}`,
          startedAt,
        })
  }

  // The viewer reports the preferred image's failure.
  const [first, ...rest] = failures

  return diagnosticCheck({
    id,
    label,
    url: first?.check.url ?? baseUrl,
    required: false,
    status: 'warning',
    message:
      rest.length === 0
        ? (first?.check.message ?? 'Not found')
        : `${first?.check.message ?? 'Not found'}; ${rest
            .map((failure) => failure.path)
            .join(', ')} also could not be read`,
    startedAt,
  })
}

const ATERA_RANGE_FILES: readonly {
  readonly role: Exclude<AteraFileRole, 'experiment'>
  readonly label: string
  readonly required: boolean
}[] = [
  { role: 'cellFeatureMatrix', label: 'Cell-feature matrix', required: true },
  { role: 'cscCellFeatureMatrix', label: 'CSC cell-feature matrix', required: true },
  { role: 'cells', label: 'Cell segmentation', required: true },
  // Only the Transcripts section reads these.
  { role: 'binnedTranscripts', label: 'Binned transcripts', required: false },
  { role: 'transcripts', label: 'Transcripts', required: false },
]

// File locations follow the viewer: the dataset manifest, then
// experiment.spatial's `explorer_files`, then the standard names.
async function runAteraDiagnostics(
  detection: Extract<SpatialDatasetDetection, { readonly platform: 'atera' }>,
  options: DatasetDiagnosticsOptions,
): Promise<readonly DatasetDiagnosticCheck[]> {
  const manifestFiles =
    detection.manifest?.platform === 'atera' ? detection.manifest.files : {}
  const fileUrl = (role: AteraFileRole, experiment: AteraExperiment | null): string =>
    manifestFiles[role]?.url ??
    datasetFileUrl(
      detection.baseUrl,
      experiment?.files[role] ?? ATERA_FILE_DEFAULTS[role],
    )
  const experimentUrl = fileUrl('experiment', null)
  const startedAt = Date.now()
  let experiment: AteraExperiment | null = null
  const checks: DatasetDiagnosticCheck[] = []

  try {
    const response = await (options.fetcher ?? fetch)(experimentUrl, {
      method: 'GET',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    experiment = parseAteraExperiment(await response.json())
    checks.push(
      diagnosticCheck({
        id: 'experiment-manifest',
        label: 'Experiment manifest',
        url: experimentUrl,
        required: true,
        status: 'pass',
        message: [
          experiment.panelName,
          experiment.cellCount === undefined
            ? undefined
            : `${experiment.cellCount.toLocaleString()} cells`,
          experiment.micrometersPerPixel === undefined
            ? undefined
            : `${experiment.micrometersPerPixel} µm/px`,
        ]
          .filter((part) => part !== undefined)
          .join('; '),
        startedAt,
      }),
    )
  } catch (cause) {
    checks.push(
      diagnosticCheck({
        id: 'experiment-manifest',
        label: 'Experiment manifest',
        url: experimentUrl,
        required: true,
        status: 'fail',
        message: errorMessage(cause),
        startedAt,
      }),
    )
  }

  for (const file of ATERA_RANGE_FILES) {
    checks.push(
      await checkDirectRangeFile(
        fileUrl(file.role, experiment),
        file.role,
        file.label,
        file.required,
        options,
      ),
    )
  }

  const morphologyUrl =
    manifestFiles.morphology?.url ??
    (experiment?.morphologyPath === undefined
      ? undefined
      : datasetFileUrl(detection.baseUrl, experiment.morphologyPath))

  if (morphologyUrl !== undefined) {
    checks.push(
      await checkDirectRangeFile(
        morphologyUrl,
        'morphology',
        'Morphology image',
        false,
        options,
      ),
    )
  }

  return checks
}

async function runSpatialDataDiagnostics(
  detection: Extract<SpatialDatasetDetection, { readonly platform: 'spatialdata' }>,
  options: DatasetDiagnosticsOptions,
): Promise<readonly DatasetDiagnosticCheck[]> {
  const url = detection.spatialDataUrl
  const startedAt = Date.now()
  let store: SpatialDataStore
  let catalog: SpatialDataCatalog
  let view: SpatialDataView

  try {
    const opened = await openSpatialDataStore(url, {
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    })
    store = opened.store
    catalog = await readSpatialDataCatalog(store, opened.zarrFormat)
    view = selectSpatialDataView(catalog)
  } catch (cause) {
    return [
      diagnosticCheck({
        id: 'spatialdata-metadata',
        label: 'SpatialData metadata',
        url,
        required: true,
        status: 'fail',
        message: errorMessage(cause),
        startedAt,
      }),
    ]
  }

  const checks: DatasetDiagnosticCheck[] = [
    diagnosticCheck({
      id: 'spatialdata-metadata',
      label: 'SpatialData metadata',
      url,
      required: true,
      status: 'pass',
      message: `Coordinate system ${view.coordinateSystem}; image ${
        view.image?.element.name ?? 'none'
      }; table ${view.table?.name ?? 'none'}`,
      startedAt,
    }),
  ]

  if (view.table === undefined) {
    checks.push(
      diagnosticCheck({
        id: 'spatialdata-table',
        label: 'SpatialData table',
        url,
        required: false,
        status: 'warning',
        message: 'No AnnData table; cells, genes, and annotations are unavailable.',
        startedAt: Date.now(),
      }),
    )
  }

  if (view.table !== undefined) {
    checks.push(await checkSpatialDataTableChunks(url, store, catalog, view, options))
  }

  if (view.image !== undefined) {
    checks.push(await checkSpatialDataImageChunk(url, store, view, options))
  }

  for (const entry of view.regionShapes) {
    checks.push(
      await checkRangeFile(
        url,
        {
          id: `spatialdata-shapes-${entry.element.name}`,
          label: `SpatialData shapes ${entry.element.name}`,
          path: `${entry.element.path}/shapes.parquet`,
        },
        true,
        options,
      ),
    )
  }

  return checks
}

const SPATIALDATA_MAX_CHECKED_CHUNKS = 2_000
const SPATIALDATA_CHUNK_CHECK_CONCURRENCY = 8

interface ChunkProbe {
  readonly key: string
  readonly status: number | 'error'
  readonly stringArray: boolean
}

// Zarr reads absent chunks as fill values, so an interrupted upload loads
// without errors but with empty columns. HEAD every table chunk to find them.
async function checkSpatialDataTableChunks(
  url: string,
  store: SpatialDataStore,
  catalog: SpatialDataCatalog,
  view: SpatialDataView,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const startedAt = Date.now()
  const tablePath = view.table?.path ?? ''
  const targets: { readonly key: string; readonly stringArray: boolean }[] = []

  for (const node of catalog.nodes) {
    if (node.kind !== 'array' || !node.path.startsWith(`${tablePath}/`)) {
      continue
    }

    const metadata = await readZarrArrayMetadata(store, node.path)

    if (metadata === null) {
      continue
    }

    const stringArray = isStringArrayMetadata(metadata)

    for (const chunkKey of zarrChunkKeys(metadata, {
      limit: SPATIALDATA_MAX_CHECKED_CHUNKS,
    })) {
      targets.push({ key: `${node.path}/${chunkKey}`, stringArray })
    }
  }

  const checked = targets.slice(0, SPATIALDATA_MAX_CHECKED_CHUNKS)
  const probes = await probeChunks(url, checked, options)
  const failed = probes.filter((probe) => probe.status !== 200 && probe.status !== 206)
  const blocking = failed.filter((probe) => probe.status !== 404 || probe.stringArray)
  const scope =
    checked.length < targets.length
      ? `first ${checked.length.toLocaleString()} of ${targets.length.toLocaleString()}`
      : checked.length.toLocaleString()

  return diagnosticCheck({
    id: 'spatialdata-table-chunks',
    label: `SpatialData table ${view.table?.name ?? ''} chunks`,
    url: datasetFileUrl(url, tablePath),
    required: true,
    status: failed.length === 0 ? 'pass' : blocking.length > 0 ? 'fail' : 'warning',
    message:
      failed.length === 0
        ? `All ${scope} table chunks readable`
        : `${failed.length.toLocaleString()} of ${scope} table chunks missing or unreadable: ${describeChunkProbes(failed)}${
            blocking.length === 0
              ? '. Numeric chunks read as fill values; this is only expected when the writer skipped empty chunks.'
              : ''
          }`,
    startedAt,
  })
}

async function checkSpatialDataImageChunk(
  url: string,
  store: SpatialDataStore,
  view: SpatialDataView,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const startedAt = Date.now()
  const element = view.image?.element
  const multiscales =
    element?.attrs.multiscales ?? recordValue(element?.attrs.ome)?.multiscales
  const datasets = Array.isArray(multiscales)
    ? recordValue(multiscales[0])?.datasets
    : undefined
  const coarsest = Array.isArray(datasets)
    ? recordValue(datasets.at(-1))?.path
    : undefined
  const levelPath =
    element === undefined || typeof coarsest !== 'string'
      ? undefined
      : `${element.path}/${coarsest}`
  const metadata =
    levelPath === undefined ? null : await readZarrArrayMetadata(store, levelPath)
  const chunkKey =
    metadata === null ? undefined : zarrChunkKeys(metadata, { limit: 1 })[0]
  const label = `SpatialData image ${element?.name ?? ''}`

  if (levelPath === undefined || chunkKey === undefined) {
    return diagnosticCheck({
      id: 'spatialdata-image-chunk',
      label,
      url,
      required: false,
      status: 'warning',
      message: 'Image multiscale metadata could not be read.',
      startedAt,
    })
  }

  const [probe] = await probeChunks(
    url,
    [{ key: `${levelPath}/${chunkKey}`, stringArray: false }],
    options,
  )
  const ok = probe?.status === 200 || probe?.status === 206

  return diagnosticCheck({
    id: 'spatialdata-image-chunk',
    label,
    url: datasetFileUrl(url, `${levelPath}/${chunkKey}`),
    required: false,
    status: ok ? 'pass' : probe?.status === 404 ? 'warning' : 'fail',
    message: ok
      ? 'Coarsest level chunk readable'
      : probe === undefined
        ? 'Not checked'
        : `Coarsest level chunk ${describeChunkProbes([probe])}`,
    startedAt,
  })
}

async function probeChunks(
  url: string,
  targets: readonly { readonly key: string; readonly stringArray: boolean }[],
  options: DatasetDiagnosticsOptions,
): Promise<readonly ChunkProbe[]> {
  const results: ChunkProbe[] = new Array<ChunkProbe>(targets.length)
  let next = 0

  const worker = async () => {
    while (next < targets.length) {
      const index = next
      next += 1
      const target = targets[index]

      if (target === undefined) {
        continue
      }

      try {
        const response = await (options.fetcher ?? fetch)(
          datasetFileUrl(url, target.key),
          {
            method: 'HEAD',
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          },
        )
        results[index] = { ...target, status: response.status }
      } catch {
        results[index] = { ...target, status: 'error' }
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(SPATIALDATA_CHUNK_CHECK_CONCURRENCY, targets.length) },
      worker,
    ),
  )
  return results
}

function describeChunkProbes(probes: readonly ChunkProbe[]): string {
  const shown = probes
    .slice(0, 4)
    .map((probe) =>
      probe.status === 'error'
        ? `${probe.key} (request failed)`
        : `${probe.key} (HTTP ${probe.status})`,
    )
    .join(', ')

  return probes.length > 4
    ? `${shown}, and ${(probes.length - 4).toLocaleString()} more`
    : shown
}

async function readZarrArrayMetadata(
  store: SpatialDataStore,
  path: string,
): Promise<Record<string, unknown> | null> {
  for (const key of [`/${path}/.zarray`, `/${path}/zarr.json`] as const) {
    const bytes = await store.get(key)

    if (bytes !== undefined) {
      return recordValue(JSON.parse(new TextDecoder().decode(bytes)))
    }
  }

  return null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

// Standard Visium files are read whole, so no Range support is needed. The
// matrix and images are checked with HEAD to avoid downloading them.
async function runVisiumDiagnostics(
  detection: Extract<SpatialDatasetDetection, { readonly platform: 'visium' }>,
  options: DatasetDiagnosticsOptions,
): Promise<readonly DatasetDiagnosticCheck[]> {
  const { baseUrl, files } = detection
  const checks: DatasetDiagnosticCheck[] = [
    await checkReadableFile(
      baseUrl,
      {
        id: 'visium-positions',
        label: 'Visium tissue positions',
        path: files.tissuePositions,
      },
      true,
      options,
    ),
    await checkReadableFile(
      baseUrl,
      {
        id: 'visium-scalefactors',
        label: 'Visium scale factors',
        path: files.scalefactors,
      },
      true,
      options,
    ),
    await checkHeadFile(
      baseUrl,
      {
        id: 'visium-matrix',
        label: 'Visium filtered matrix',
        path: files.filteredMatrix,
      },
      true,
      options,
      VISIUM_MATRIX_MAX_BYTES,
    ),
  ]
  const images = [
    {
      id: 'visium-tissue-hires',
      label: 'Visium high-res tissue image',
      path: files.hiresImage,
    },
    {
      id: 'visium-tissue-lowres',
      label: 'Visium low-res tissue image',
      path: files.lowresImage,
    },
  ]

  for (const image of images) {
    checks.push(
      image.path === undefined
        ? diagnosticCheck({
            id: image.id,
            label: image.label,
            url: baseUrl,
            required: false,
            status: 'warning',
            message: 'Not found',
            startedAt: Date.now(),
          })
        : await checkHeadFile(baseUrl, { ...image, path: image.path }, false, options),
    )
  }

  for (const key of ['clusters', 'umap'] as const) {
    const named = files.analysis?.[key]
    const candidates =
      named === undefined ? VISIUM_ANALYSIS_FILE_CANDIDATES[key] : [named]
    let check: DatasetDiagnosticCheck | null = null

    for (const path of candidates) {
      check = await checkReadableFile(
        baseUrl,
        {
          id: `visium-${key}`,
          label:
            key === 'clusters' ? 'Visium graph-based clusters' : 'Visium UMAP projection',
          path,
        },
        false,
        options,
      )

      if (check.status === 'pass') {
        break
      }
    }

    if (check !== null) {
      checks.push(check)
    }
  }

  return checks
}

// HEAD, reporting the size; fails a file over `maxBytes`.
async function checkHeadFile(
  baseUrl: string,
  file: { readonly id: string; readonly label: string; readonly path: string },
  required: boolean,
  options: DatasetDiagnosticsOptions,
  maxBytes?: number,
): Promise<DatasetDiagnosticCheck> {
  const url = datasetFileUrl(baseUrl, file.path)
  const startedAt = Date.now()

  try {
    let response: Response

    try {
      response = await (options.fetcher ?? fetch)(url, {
        method: 'HEAD',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (cause) {
      // A host that hides its error responses (EBI FTP) makes a missing file
      // look like a network failure.
      throw likelyMissingFileError(file.label, url, cause) ?? cause
    }

    noteReadableResponse(url, response.status)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const length = Number(response.headers.get('Content-Length'))
    const size =
      Number.isFinite(length) && length > 0
        ? `${(length / (1024 * 1024)).toFixed(1)} MB`
        : null

    if (maxBytes !== undefined && Number.isFinite(length) && length > maxBytes) {
      return diagnosticCheck({
        id: file.id,
        label: file.label,
        url,
        required,
        status: required ? 'fail' : 'warning',
        message: `${size ?? ''} is above the ${(maxBytes / (1024 * 1024)).toFixed(0)} MB browser load limit`,
        startedAt,
      })
    }

    return diagnosticCheck({
      id: file.id,
      label: file.label,
      url,
      required,
      status: 'pass',
      message: size === null ? 'Readable' : `Readable (${size})`,
      startedAt,
    })
  } catch (cause) {
    return diagnosticCheck({
      id: file.id,
      label: file.label,
      url,
      required,
      status: required ? 'fail' : 'warning',
      message: errorMessage(cause),
      startedAt,
    })
  }
}

async function runVisiumHdDiagnostics(
  detection: Extract<SpatialDatasetDetection, { readonly platform: 'visium-hd' }>,
  options: DatasetDiagnosticsOptions,
): Promise<readonly DatasetDiagnosticCheck[]> {
  const checks: DatasetDiagnosticCheck[] = []
  const selectedBin = selectedVisiumHdBin(detection, options.visiumHdBinSizeMicrometers)

  if (selectedBin.status === 'missing') {
    checks.push(
      diagnosticCheck({
        id: `visium-hd-${options.visiumHdBinSizeMicrometers}um-selected-bin`,
        label: `Visium HD ${options.visiumHdBinSizeMicrometers}um selected mode`,
        url: detection.baseUrl,
        required: true,
        status: 'fail',
        message: 'Selected binned output was not detected.',
        startedAt: Date.now(),
      }),
    )
  }

  for (const bin of selectedBin.bins) {
    const suffix = `${bin.binSizeMicrometers}um`

    checks.push(
      await checkRangeFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-positions`,
          label: `Visium HD ${suffix} positions`,
          path: bin.tissuePositionsPath,
        },
        true,
        options,
      ),
    )
    checks.push(
      await checkReadableFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-scalefactors`,
          label: `Visium HD ${suffix} scalefactors`,
          path: bin.scalefactorsPath,
        },
        true,
        options,
      ),
    )
    checks.push(
      await checkRangeFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-matrix`,
          label: `Visium HD ${suffix} filtered matrix`,
          path: bin.filteredMatrixH5Path,
        },
        true,
        options,
      ),
    )
    // The gene list (readVisiumHdFeatureGenePanel) and, for 2 µm, the bins
    // themselves (readVisiumHdFilteredMatrixBarcodes) are read whole from
    // these, so HEAD shows whether they can be fetched.
    checks.push(
      await checkHeadFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-features`,
          label: `Visium HD ${suffix} features`,
          path: `${bin.outputPath}/filtered_feature_bc_matrix/features.tsv.gz`,
        },
        true,
        options,
      ),
    )

    if (bin.binSizeMicrometers === 2) {
      checks.push(
        await checkHeadFile(
          detection.baseUrl,
          {
            id: `visium-hd-${suffix}-barcodes`,
            label: `Visium HD ${suffix} barcodes`,
            path: `${bin.outputPath}/filtered_feature_bc_matrix/barcodes.tsv.gz`,
          },
          true,
          options,
        ),
      )
    }

    checks.push(
      ...(await checkVisiumHdTissueImages(detection.baseUrl, bin, suffix, options)),
    )
    checks.push(
      await checkRangeFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-umap-projection`,
          label: `Visium HD ${suffix} UMAP projection`,
          path: `${bin.outputPath}/analysis/umap/gene_expression_2_components/projection.csv`,
        },
        false,
        options,
      ),
    )
  }

  for (const file of VISIUM_HD_ROOT_RANGE_FILES) {
    checks.push(
      await checkRangeFile(
        detection.baseUrl,
        roleFile(detection.baseUrl, file),
        false,
        options,
      ),
    )
  }

  if (hasSegmentedOutputSignal(detection)) {
    for (const file of VISIUM_HD_SEGMENTED_READABLE_FILES) {
      checks.push(
        await checkReadableFile(
          detection.baseUrl,
          segmentedFile(detection, file),
          false,
          options,
        ),
      )
    }

    for (const file of VISIUM_HD_SEGMENTED_HEAD_FILES) {
      checks.push(
        await checkHeadFile(
          detection.baseUrl,
          segmentedFile(detection, file),
          false,
          options,
        ),
      )
    }

    for (const file of VISIUM_HD_SEGMENTED_RANGE_FILES) {
      checks.push(
        await checkRangeFile(
          detection.baseUrl,
          segmentedFile(detection, file),
          false,
          options,
        ),
      )
    }
  }

  return checks
}

// The viewer shows the high-res tissue image, else the low-res one, so each is
// optional but a tier with neither fails. Browsers load the PNGs whole, so
// HEAD is enough.
async function checkVisiumHdTissueImages(
  baseUrl: string,
  bin: VisiumHdBinDescriptor,
  suffix: string,
  options: DatasetDiagnosticsOptions,
): Promise<readonly DatasetDiagnosticCheck[]> {
  const startedAt = Date.now()
  const hires = await checkHeadFile(
    baseUrl,
    {
      id: `visium-hd-${suffix}-tissue-hires`,
      label: `Visium HD ${suffix} high-res tissue image`,
      path: `${bin.outputPath}/spatial/tissue_hires_image.png`,
    },
    false,
    options,
  )
  const lowres = await checkHeadFile(
    baseUrl,
    {
      id: `visium-hd-${suffix}-tissue-lowres`,
      label: `Visium HD ${suffix} low-res tissue image`,
      path: `${bin.outputPath}/spatial/tissue_lowres_image.png`,
    },
    false,
    options,
  )

  if (hires.status === 'pass') {
    return [hires, lowres]
  }

  if (lowres.status === 'pass') {
    return [
      {
        ...hires,
        message: `${hires.message}. The viewer shows the low-res image instead.`,
      },
      lowres,
    ]
  }

  return [
    hires,
    lowres,
    diagnosticCheck({
      id: `visium-hd-${suffix}-tissue-image`,
      label: `Visium HD ${suffix} tissue image`,
      url: hires.url,
      required: true,
      status: 'fail',
      message: 'Neither the high-res nor the low-res tissue image can be read.',
      startedAt,
    }),
  ]
}

// The detected path (from the manifest or the probe), else the standard one.
function segmentedFile(
  detection: Extract<SpatialDatasetDetection, { readonly platform: 'visium-hd' }>,
  file: VisiumHdSegmentedFile,
): { readonly id: string; readonly label: string; readonly path: string } {
  return {
    id: file.id,
    label: file.label,
    path: detection.segmentedOutputs?.[file.output] ?? file.path,
  }
}

function hasSegmentedOutputSignal(
  detection: Extract<SpatialDatasetDetection, { readonly platform: 'visium-hd' }>,
): boolean {
  return (
    detection.segmentedScalefactorsPath !== undefined ||
    detection.segmentedOutputs !== undefined
  )
}

function selectedVisiumHdBin(
  detection: Extract<SpatialDatasetDetection, { readonly platform: 'visium-hd' }>,
  binSizeMicrometers: VisiumHdBinSizeMicrometers | undefined,
):
  | { readonly status: 'all'; readonly bins: readonly VisiumHdBinDescriptor[] }
  | { readonly status: 'selected'; readonly bins: readonly VisiumHdBinDescriptor[] }
  | { readonly status: 'missing'; readonly bins: readonly [] } {
  if (binSizeMicrometers === undefined) {
    return { status: 'all', bins: detection.bins }
  }

  const selectedBin = detection.bins.find(
    (bin) => bin.binSizeMicrometers === binSizeMicrometers,
  )

  return selectedBin === undefined
    ? { status: 'missing', bins: [] }
    : { status: 'selected', bins: [selectedBin] }
}

async function checkRangeFile(
  baseUrl: string,
  file: { readonly id: string; readonly label: string; readonly path: string },
  required: boolean,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const url = datasetFileUrl(baseUrl, file.path)
  const startedAt = Date.now()

  try {
    await (options.rangeValidator ?? assertHttpRangeSupport)(url, {
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      label: file.label,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    return diagnosticCheck({
      id: file.id,
      label: file.label,
      url,
      required,
      status: 'pass',
      message: 'Byte-range readable',
      startedAt,
    })
  } catch (cause) {
    return diagnosticCheck({
      id: file.id,
      label: file.label,
      url,
      required,
      status: required ? 'fail' : 'warning',
      message: errorMessage(cause),
      startedAt,
    })
  }
}

async function checkDirectRangeFile(
  url: string,
  id: string,
  label: string,
  required: boolean,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const startedAt = Date.now()

  try {
    await (options.rangeValidator ?? assertHttpRangeSupport)(url, {
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      label,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    return diagnosticCheck({
      id,
      label,
      url,
      required,
      status: 'pass',
      message: 'Byte-range readable',
      startedAt,
    })
  } catch (cause) {
    return diagnosticCheck({
      id,
      label,
      url,
      required,
      status: required ? 'fail' : 'warning',
      message: errorMessage(cause),
      startedAt,
    })
  }
}

// GET for small files read whole. Only the status is used, so the body is
// cancelled rather than downloaded.
async function checkReadableFile(
  baseUrl: string,
  file: { readonly id: string; readonly label: string; readonly path: string },
  required: boolean,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const url = datasetFileUrl(baseUrl, file.path)
  const startedAt = Date.now()

  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: 'GET',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    discardBody(response)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return diagnosticCheck({
      id: file.id,
      label: file.label,
      url,
      required,
      status: 'pass',
      message: 'Readable',
      startedAt,
    })
  } catch (cause) {
    return diagnosticCheck({
      id: file.id,
      label: file.label,
      url,
      required,
      status: required ? 'fail' : 'warning',
      message: errorMessage(cause),
      startedAt,
    })
  }
}

// Reads the first chunk of `/X`, which for virtual references is a Range
// request to the referenced file, so a host without CORS or Range shows here.
async function checkIcechunkAnnData(
  url: string,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const startedAt = Date.now()
  const id = 'icechunk-repository'
  const label = 'Icechunk repository'

  try {
    const [{ openIcechunkRepository }, { icechunkCompanionFileUrl }, zarr] =
      await Promise.all([
        import('../zarr/icechunkStore'),
        import('../zarr/icechunkUrl'),
        import('zarrita'),
      ])
    const repository = await openIcechunkRepository(url, {
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      virtualChunkUrl: icechunkCompanionFileUrl(url),
    })
    const matrixPath = repository.nodes.some(
      (node) => node.path === 'X/data' && node.kind === 'array',
    )
      ? 'X/data'
      : 'X'
    const matrix = await zarr.open.v3(zarr.root(repository.store).resolve(matrixPath), {
      kind: 'array',
    })
    await matrix.getChunk(
      matrix.shape.map(() => 0),
      options.signal === undefined ? undefined : { signal: options.signal },
    )

    return diagnosticCheck({
      id,
      label,
      url,
      required: true,
      status: 'pass',
      message: `${repository.nodes.length.toLocaleString()} groups and arrays; read the first chunk of /${matrixPath}`,
      startedAt,
    })
  } catch (cause) {
    return diagnosticCheck({
      id,
      label,
      url,
      required: true,
      status: 'fail',
      message: errorMessage(cause),
      startedAt,
    })
  }
}

function diagnosticCheck(options: {
  readonly id: string
  readonly label: string
  readonly url: string
  readonly required: boolean
  readonly status: DatasetDiagnosticStatus
  readonly message: string
  readonly startedAt: number
}): DatasetDiagnosticCheck {
  return {
    id: options.id,
    label: options.label,
    url: options.url,
    required: options.required,
    status: options.status,
    message: options.message,
    durationMs: Math.max(0, Date.now() - options.startedAt),
  }
}

function detectionDiagnosticCheck(
  detection: SpatialDatasetDetection,
  startedAt: number,
): DatasetDiagnosticCheck {
  const label = 'Dataset layout'

  if (detection.platform === 'unknown') {
    return diagnosticCheck({
      id: 'dataset-layout',
      label,
      url: detection.baseUrl,
      required: true,
      status: 'fail',
      message: 'Unsupported dataset layout',
      startedAt,
    })
  }

  return diagnosticCheck({
    id: 'dataset-layout',
    label,
    url: detection.baseUrl,
    required: true,
    status: 'pass',
    message:
      detection.platform === 'visium-hd'
        ? `Detected Visium HD (${detection.bins
            .map((bin) => `${bin.binSizeMicrometers} µm`)
            .join(', ')})`
        : detection.platform === 'visium'
          ? 'Detected Visium (Space Ranger)'
          : detection.platform === 'h5ad'
            ? 'Detected H5AD'
            : detection.platform === 'spatialdata'
              ? 'Detected SpatialData'
              : detection.platform === 'atera'
                ? 'Detected Atera'
                : 'Detected Xenium',
    startedAt,
  })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

// Stops downloading a body that will not be read. Cancelling rejects only
// when the download has already failed, which does not change the check.
function discardBody(response: Response): void {
  response.body?.cancel().catch(() => undefined)
}
