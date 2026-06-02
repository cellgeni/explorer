import type { BBox, DataPoint, Micrometers, UnitsDescriptor } from '../data/coords'
import type { CellId } from '../data/cellid'
import type { GexResult, Selection, TranscriptScope } from '../data/gex'
import type { TiffPyramidLoader } from '../tiff/loader'
import type { AnalysisAnnotationQueryOptions } from '../data/analysisAnnotations'

export type Platform = 'xenium' | 'visium' | 'visium-hd'

export type ElementGeometry =
  | { readonly kind: 'polygon'; readonly rings: readonly (readonly DataPoint[])[] }
  | {
      readonly kind: 'circle'
      readonly center: DataPoint
      readonly diameter: Micrometers
    }
  | { readonly kind: 'square'; readonly origin: DataPoint; readonly size: Micrometers }

export interface SpatialElement {
  readonly id: string
  readonly geometry: ElementGeometry
}

export interface ElementBatch {
  readonly elements: readonly SpatialElement[]
}

export interface ChannelInfo {
  readonly id: string
  readonly index?: number
  readonly name: string
  readonly color?: readonly [number, number, number]
  readonly contrast?: {
    readonly min: number
    readonly max: number
  }
  readonly fileName?: string
  readonly purpose?: string
}

export interface DatasetMeta {
  readonly platform: Platform
  readonly units: UnitsDescriptor
  readonly extent: BBox
  readonly capabilities: {
    readonly transcripts: boolean
    readonly cellBoundaries: boolean
    readonly pyramidImage: boolean
    readonly multiChannel: boolean
  }
  readonly channels?: readonly ChannelInfo[]
}

export type ImageSource =
  | { readonly kind: 'pyramid'; readonly loader: TiffPyramidLoader }
  | {
      readonly kind: 'flat'
      readonly url: string
      readonly scaleFactor: number
      readonly size: readonly [number, number]
    }

export interface Annotation {
  readonly id: string
  readonly label: string
  readonly cellIds: readonly CellId[]
}

export interface SpatialDataset {
  meta(): Promise<DatasetMeta>
  elements(bbox: BBox): Promise<ElementBatch>
  matrix(ids: readonly CellId[]): Promise<GexResult>
  annotations(options?: AnalysisAnnotationQueryOptions): Promise<readonly Annotation[]>
  image(): Promise<ImageSource | null>
  transcripts?(
    selection: Selection,
    scope: TranscriptScope,
    minQv: number,
  ): Promise<GexResult>
}
