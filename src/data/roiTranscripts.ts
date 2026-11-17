import { datasetFileLabelFor, datasetFileUrlFor } from './datasetFiles'
import { assertHttpRangeSupport } from './rangeSupport'
import { normalizeRoiSelection, roiSelectionContains } from './roiSelection'
import { cachedXeniumTranscriptDataset } from './xeniumDatasetCache'
import type { BBox, DataPoint } from './coords'
import type { DatasetRangeValidator } from './datasetOverview'
import type { RoiSelectionInput } from './roiSelection'
import type { TranscriptPoint, TranscriptViewportResult } from './transcriptOverlay'
import type { DatasetTranscript, XeniumDataset } from '../datasets/xeniumDataset'

export const ROI_TRANSCRIPT_EXPORT_LIMIT = 100_000
const DEFAULT_ROI_TRANSCRIPT_MIN_QV = 20

export interface LoadDatasetRoiTranscriptsOptions {
  readonly getDataset?: (baseUrl: string) => XeniumDataset | Promise<XeniumDataset>
  readonly validateRangeSupport?: DatasetRangeValidator
  readonly signal?: AbortSignal
  readonly limit?: number
  readonly minQv?: number
}

export async function loadDatasetRoiTranscripts(
  baseUrl: string,
  selectionInput: RoiSelectionInput,
  options: LoadDatasetRoiTranscriptsOptions = {},
): Promise<readonly DatasetTranscript[]> {
  const validateRangeSupport = options.validateRangeSupport ?? assertHttpRangeSupport

  await validateRangeSupport(datasetFileUrlFor(baseUrl, 'transcripts'), {
    label: datasetFileLabelFor(baseUrl, 'transcripts'),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  const dataset =
    options.getDataset === undefined
      ? await cachedXeniumTranscriptDataset(baseUrl)
      : await options.getDataset(baseUrl)
  throwIfAborted(options.signal)

  const selection = normalizeRoiSelection(selectionInput)
  const queryOptions = {
    limit: options.limit ?? ROI_TRANSCRIPT_EXPORT_LIMIT,
    minQv: options.minQv ?? DEFAULT_ROI_TRANSCRIPT_MIN_QV,
  }
  const transcripts =
    selection.kind === 'box'
      ? await dataset.transcriptsInBbox(selection.bbox, queryOptions)
      : await dataset.transcriptsForSelection(selection, queryOptions)
  throwIfAborted(options.signal)

  return transcripts
}

// Reads the named genes' transcripts in a box, as Atera's per-gene reader
// does (`AteraDataset.transcriptViewport`).
export type PerGeneTranscriptReader = (
  bbox: BBox,
  options: {
    readonly featureNames: readonly string[]
    readonly pointLimit: number
    readonly groupLimit: number
    readonly minQv: number
    readonly contains?: (point: DataPoint) => boolean
    readonly signal?: AbortSignal
  },
) => Promise<TranscriptViewportResult>

export interface LoadPerGeneRoiTranscriptsOptions {
  readonly featureNames: readonly string[]
  readonly signal?: AbortSignal
  readonly limit?: number
  readonly minQv?: number
}

// ROI transcripts from a dataset that stores them per gene (Atera). Only the
// selected genes are exported: every gene would mean reading every row of
// each tile the ROI touches.
export async function loadPerGeneRoiTranscripts(
  readTranscripts: PerGeneTranscriptReader,
  selectionInput: RoiSelectionInput,
  options: LoadPerGeneRoiTranscriptsOptions,
): Promise<readonly DatasetTranscript[]> {
  if (options.featureNames.length === 0) {
    throw new Error(
      'Select genes to export their transcripts. This dataset stores transcripts by gene, so the export covers the selected genes.',
    )
  }

  const selection = normalizeRoiSelection(selectionInput)
  const result = await readTranscripts(selection.bbox, {
    featureNames: options.featureNames,
    pointLimit: options.limit ?? ROI_TRANSCRIPT_EXPORT_LIMIT,
    groupLimit: 1,
    minQv: options.minQv ?? DEFAULT_ROI_TRANSCRIPT_MIN_QV,
    ...(selection.kind === 'box'
      ? {}
      : { contains: (point: DataPoint) => roiSelectionContains(selection, point) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  return result.points.map(datasetTranscriptFromPoint)
}

function datasetTranscriptFromPoint(point: TranscriptPoint): DatasetTranscript {
  return {
    cellId: point.cellId,
    featureName: point.featureName,
    position: point.position,
    zLocation: point.zLocation,
    qv: point.qv,
    overlapsNucleus: point.overlapsNucleus,
    isGene: point.isGene,
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason
  }

  const error = new Error('ROI transcript request aborted.')
  error.name = 'AbortError'
  return error
}
