import {
  dropSharedH5WorkerFile,
  openH5WorkerFileFromUrl,
  type H5WorkerFactory,
  type H5WorkerFile,
} from './h5WorkerFile'
import { waitForSharedLoad, type SharedLoad } from '../utils/sharedLoad'
import type { CellFeatureMatrixReadOptions, GexResult } from './gexTypes'
import {
  createVisiumFeatureSliceCache,
  elapsedMs,
  emptyCellsFor,
  gexFromVisiumFeatureSliceLoadedH5,
  normalizeSelectedGeneList,
  throwIfAborted,
  type H5FileLike,
  type VisiumFeatureSliceCache,
  type VisiumFeatureSliceMetadata,
  type VisiumFeatureSliceTarget,
} from './visiumFeatureSliceH5'

export {
  featureSliceBinningScale,
  parseVisiumFeatureSliceMetadata,
  type VisiumFeatureSliceMetadata,
  type VisiumFeatureSliceTarget,
  type VisiumFeatureSliceTransform,
} from './visiumFeatureSliceH5'

export type VisiumFeatureSliceBackend = 'full-file' | 'lazy-range-worker'

export interface VisiumFeatureSliceReadOptions extends CellFeatureMatrixReadOptions {
  readonly binSizeMicrometers: number
  readonly fetcher?: typeof fetch
  readonly backend?: VisiumFeatureSliceBackend
  readonly workerFactory?: H5WorkerFactory
}

export class FeatureSliceFullFileBudgetExceededError extends Error {
  override readonly name = 'FeatureSliceFullFileBudgetExceededError'

  constructor(
    readonly url: string,
    readonly byteLength: number,
    readonly maxBytes: number,
  ) {
    super(
      `Feature Slice H5 is ${formatByteCount(
        byteLength,
      )}, exceeding the interactive full-file budget of ${formatByteCount(maxBytes)}.`,
    )
  }
}

const featureSliceCache = new Map<string, SharedLoad<VisiumFeatureSliceCache>>()
const featureSliceFileCache = new Map<string, SharedLoad<H5WorkerFile>>()

export async function gexFromVisiumFeatureSliceH5<ElementId extends string>(
  url: string,
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
  genes: readonly string[],
  options: VisiumFeatureSliceReadOptions,
): Promise<GexResult<ElementId>> {
  const selectedGenes = normalizeSelectedGeneList(genes)

  if (targets.length === 0 || selectedGenes.length === 0) {
    return {
      geneNames: selectedGenes,
      cells: emptyCellsFor(targets),
    }
  }

  if ((options.backend ?? 'full-file') === 'lazy-range-worker') {
    return gexFromVisiumFeatureSliceRangeWorker(url, targets, selectedGenes, options)
  }

  const metadataStartedAt = Date.now()
  const matrix = await loadVisiumFeatureSliceH5(url, options)
  options.onStageTiming?.({
    stage: 'matrix-read',
    label: 'Feature Slice H5 metadata',
    durationMs: elapsedMs(metadataStartedAt),
    detail: `${matrix.featureNames.length.toLocaleString()} features`,
  })
  throwIfAborted(options.signal)

  return gexFromVisiumFeatureSliceLoadedH5(matrix, targets, selectedGenes, options)
}

export interface VisiumFeatureSliceMetadataReadOptions {
  readonly signal?: AbortSignal
  readonly workerFactory?: H5WorkerFactory
}

// The file's metadata, read by range in the worker that later serves its gene
// reads, so the file is opened once.
export async function readVisiumFeatureSliceH5Metadata(
  url: string,
  options: VisiumFeatureSliceMetadataReadOptions = {},
): Promise<VisiumFeatureSliceMetadata> {
  const file = await openFeatureSliceFile(url, options)
  throwIfAborted(options.signal)

  try {
    return await file.featureSliceMetadata(options.signal)
  } catch (error) {
    if (!isAbortError(error)) {
      dropSharedH5WorkerFile(featureSliceFileCache, url, file)
    }

    throw error
  }
}

// The file stays open in its H5 file worker for the session, read by range,
// so a gene or bin read once is not fetched again.
async function gexFromVisiumFeatureSliceRangeWorker<ElementId extends string>(
  url: string,
  targets: readonly VisiumFeatureSliceTarget<ElementId>[],
  selectedGenes: readonly string[],
  options: VisiumFeatureSliceReadOptions,
): Promise<GexResult<ElementId>> {
  const startedAt = Date.now()
  const file = await openFeatureSliceFile(url, options)
  throwIfAborted(options.signal)
  let result: GexResult<ElementId>

  try {
    result = await file.featureSlice(
      targets,
      selectedGenes,
      options.binSizeMicrometers,
      options.signal,
    )
  } catch (error) {
    if (!isAbortError(error)) {
      dropSharedH5WorkerFile(featureSliceFileCache, url, file)
    }

    throw error
  }

  options.onStageTiming?.({
    stage: 'matrix-read',
    label: 'Feature Slice H5 range read',
    durationMs: elapsedMs(startedAt),
    detail: `${selectedGenes.length.toLocaleString()} genes, ${targets.length.toLocaleString()} bins`,
  })
  return result
}

function openFeatureSliceFile(
  url: string,
  options: VisiumFeatureSliceMetadataReadOptions,
): Promise<H5WorkerFile> {
  return waitForSharedLoad(
    featureSliceFileCache,
    url,
    (signal) =>
      openH5WorkerFileFromUrl(url, 'feature_slice.h5', {
        signal,
        ...(options.workerFactory === undefined
          ? {}
          : { workerFactory: options.workerFactory }),
      }),
    options.signal,
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function loadVisiumFeatureSliceH5(
  url: string,
  options: VisiumFeatureSliceReadOptions,
): Promise<VisiumFeatureSliceCache> {
  // Shared by every caller and cancelled only when they all cancel (15.5-E).
  return waitForSharedLoad(
    featureSliceCache,
    url,
    (signal) => loadVisiumFeatureSliceH5Uncached(url, { ...options, signal }),
    options.signal,
  )
}

async function loadVisiumFeatureSliceH5Uncached(
  url: string,
  options: VisiumFeatureSliceReadOptions,
): Promise<VisiumFeatureSliceCache> {
  if (options.maxFullFileBytes !== undefined) {
    await assertFeatureSliceFullFileReadWithinBudget(
      url,
      options.maxFullFileBytes,
      options.fetcher,
      options.signal,
    )
  }

  const h5wasm = (await import('h5wasm')).default
  const { FS } = await h5wasm.ready
  throwIfAborted(options.signal)

  const response = await (options.fetcher ?? fetch)(url, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })

  if (!response.ok) {
    throw new Error(`feature_slice.h5 returned HTTP ${response.status}.`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  throwIfAborted(options.signal)

  const fileName = `/visium-feature-slice-${hashString(url)}.h5`
  try {
    FS.unlink(fileName)
  } catch {
    // The file is only present when this URL was loaded in a previous app session.
  }

  FS.writeFile(fileName, bytes)

  try {
    const file = new h5wasm.File(fileName, 'r') as H5FileLike
    return createVisiumFeatureSliceCache(file)
  } catch (error) {
    try {
      FS.unlink(fileName)
    } catch {
      // Best-effort cleanup; the original error is more useful.
    }

    throw error
  }
}

async function assertFeatureSliceFullFileReadWithinBudget(
  url: string,
  maxBytes: number,
  fetcher: typeof fetch | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new RangeError(`Feature Slice full-file budget must be non-negative.`)
  }

  const response = await (fetcher ?? fetch)(url, {
    method: 'HEAD',
    ...(signal === undefined ? {} : { signal }),
  })

  if (!response.ok) {
    throw new Error(`feature_slice.h5 HEAD returned HTTP ${response.status}.`)
  }

  const contentLength = response.headers.get('content-length')

  if (contentLength === null) {
    throw new Error(
      'Feature Slice H5 size is not exposed through Content-Length, so the interactive full-file read budget cannot be verified.',
    )
  }

  const byteLength = Number(contentLength)

  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new Error(`Feature Slice H5 returned invalid Content-Length ${contentLength}.`)
  }

  if (byteLength > maxBytes) {
    throw new FeatureSliceFullFileBudgetExceededError(url, byteLength, maxBytes)
  }
}

function hashString(value: string): string {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash.toString(16)
}

function formatByteCount(byteLength: number): string {
  if (byteLength >= 1024 * 1024 * 1024) {
    return `${(byteLength / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  if (byteLength >= 1024 * 1024) {
    return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
  }

  if (byteLength >= 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`
  }

  return `${byteLength.toLocaleString()} B`
}
