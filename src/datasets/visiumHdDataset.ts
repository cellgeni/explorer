import type { GexResult } from '../data/gex'
import type {
  Annotation,
  DatasetMeta,
  ElementBatch,
  ImageSource,
  SpatialDataset,
  SpatialElementId,
} from './spatialDataset'

export type VisiumHdBinSizeMicrometers = 2 | 8 | 16

export interface VisiumHdBinDescriptor {
  readonly binSizeMicrometers: VisiumHdBinSizeMicrometers
  readonly outputPath: string
  readonly tissuePositionsPath: string
  readonly scalefactorsPath: string
  readonly filteredMatrixH5Path: string
}

export interface VisiumHdDatasetOptions {
  readonly baseUrl: string
  readonly bins: readonly VisiumHdBinDescriptor[]
}

export class VisiumHdDataset implements SpatialDataset<SpatialElementId> {
  readonly baseUrl: string
  readonly bins: readonly VisiumHdBinDescriptor[]

  constructor(options: VisiumHdDatasetOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.bins = options.bins
  }

  meta(): Promise<DatasetMeta> {
    return Promise.reject(visiumHdNotImplementedError('metadata loading'))
  }

  elements(): Promise<ElementBatch<SpatialElementId>> {
    return Promise.reject(visiumHdNotImplementedError('bin loading'))
  }

  matrix(): Promise<GexResult<SpatialElementId>> {
    return Promise.reject(visiumHdNotImplementedError('matrix loading'))
  }

  annotations(): Promise<readonly Annotation<SpatialElementId>[]> {
    return Promise.reject(visiumHdNotImplementedError('annotation loading'))
  }

  image(): Promise<ImageSource | null> {
    return Promise.reject(visiumHdNotImplementedError('image loading'))
  }

  transcripts(): Promise<GexResult<SpatialElementId>> {
    return Promise.reject(
      new Error('Visium HD output does not provide Xenium-style transcript records.'),
    )
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function visiumHdNotImplementedError(capability: string): Error {
  return new Error(`Visium HD ${capability} is not implemented yet.`)
}
