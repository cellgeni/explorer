import {
  dropSharedH5WorkerFile,
  openH5WorkerFileFromUrl,
  type H5WorkerFactory,
  type H5WorkerFile,
} from './h5WorkerFile'
import { waitForSharedLoad, type SharedLoad } from '../utils/sharedLoad'
import type { CellFeatureMatrixReadOptions, GexResult } from './gexTypes'
import { closeSharedFile, releaseWithDatasets } from './datasetResources'
import {
  elapsedMs,
  emptyCellsFor,
  normalizeSelectedGeneList,
  type VisiumFeatureSliceMetadata,
  type VisiumFeatureSliceTarget,
} from './visiumFeatureSliceH5'
import { isAbortError, throwIfAborted } from '../utils/abort'

export {
  featureSliceBinningScale,
  parseVisiumFeatureSliceMetadata,
  type VisiumFeatureSliceMetadata,
  type VisiumFeatureSliceTarget,
  type VisiumFeatureSliceTransform,
} from './visiumFeatureSliceH5'

// The file is read by range in an H5 file worker. A full-file read, which
// only tests used, was removed with O19.
export interface VisiumFeatureSliceReadOptions extends CellFeatureMatrixReadOptions {
  readonly binSizeMicrometers: number
  readonly workerFactory?: H5WorkerFactory
}

// Each file stays open in its H5 file worker while a dataset that reads it is
// held (released with it, O19), read by range, so a gene or bin read once is
// not fetched again.
const featureSliceFileCache = new Map<string, SharedLoad<H5WorkerFile>>()
releaseWithDatasets(featureSliceFileCache, closeSharedFile)

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

  return gexFromVisiumFeatureSliceRangeWorker(url, targets, selectedGenes, options)
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
