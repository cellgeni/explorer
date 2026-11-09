import { datasetFileUrl, datasetFileUrlFor, xeniumManifestFileFor } from './datasetFiles'
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
]

const XENIUM_DEFAULT_MORPHOLOGY_PATH = 'morphology.ome.tif'

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
    if (!(error instanceof DatasetManifestError)) {
      throw error
    }

    checks.push(
      diagnosticCheck({
        id: 'dataset-manifest',
        label: 'Dataset manifest',
        url: error.manifestUrl,
        required: true,
        status: 'fail',
        message: error.message,
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

  if (detection.platform === 'h5ad') {
    checks.push(
      await checkDirectRangeFile(
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
  checks.push(await checkManifest(baseUrl, detection.manifest === undefined, options))

  for (const file of XENIUM_REQUIRED_RANGE_FILES) {
    checks.push(await checkRangeFile(baseUrl, roleFile(baseUrl, file), true, options))
  }

  for (const file of XENIUM_OPTIONAL_RANGE_FILES) {
    checks.push(await checkRangeFile(baseUrl, roleFile(baseUrl, file), false, options))
  }

  checks.push(
    await checkRangeFile(
      baseUrl,
      {
        id: 'morphology',
        label: 'Morphology image',
        path:
          xeniumManifestFileFor(baseUrl, 'morphology')?.url ??
          XENIUM_DEFAULT_MORPHOLOGY_PATH,
      },
      false,
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

async function checkManifest(
  baseUrl: string,
  required: boolean,
  options: DatasetDiagnosticsOptions,
): Promise<DatasetDiagnosticCheck> {
  const url = datasetFileUrlFor(baseUrl, 'experiment')
  const startedAt = Date.now()

  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: 'GET',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })

    if (!response.ok) {
      return diagnosticCheck({
        id: 'experiment-manifest',
        label: 'Experiment manifest',
        url,
        required,
        status: required ? 'fail' : 'warning',
        message: `HTTP ${response.status}`,
        startedAt,
      })
    }

    return diagnosticCheck({
      id: 'experiment-manifest',
      label: 'Experiment manifest',
      url,
      required,
      status: 'pass',
      message: 'Readable',
      startedAt,
    })
  } catch (cause) {
    return diagnosticCheck({
      id: 'experiment-manifest',
      label: 'Experiment manifest',
      url,
      required,
      status: required ? 'fail' : 'warning',
      message: errorMessage(cause),
      startedAt,
    })
  }
}

const ATERA_RANGE_FILES: readonly {
  readonly role: Exclude<AteraFileRole, 'experiment'>
  readonly label: string
  readonly required: boolean
}[] = [
  { role: 'cellFeatureMatrix', label: 'Cell-feature matrix', required: true },
  { role: 'cscCellFeatureMatrix', label: 'CSC cell-feature matrix', required: true },
  { role: 'cells', label: 'Cell segmentation', required: true },
  // Only the Transcripts tab reads these.
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
    checks.push(
      await checkRangeFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-tissue-hires`,
          label: `Visium HD ${suffix} high-res tissue image`,
          path: `${bin.outputPath}/spatial/tissue_hires_image.png`,
        },
        true,
        options,
      ),
    )
    checks.push(
      await checkRangeFile(
        detection.baseUrl,
        {
          id: `visium-hd-${suffix}-tissue-lowres`,
          label: `Visium HD ${suffix} low-res tissue image`,
          path: `${bin.outputPath}/spatial/tissue_lowres_image.png`,
        },
        false,
        options,
      ),
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
