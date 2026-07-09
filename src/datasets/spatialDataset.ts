import type {
  BBox,
  DataPoint,
  DataVector,
  Micrometers,
  UnitsDescriptor,
} from '../data/coords'
import type { CellId } from '../data/cellid'
import type { GexResult, Selection, TranscriptScope } from '../data/gex'
import type { AnalysisAnnotationQueryOptions } from '../data/analysisAnnotations'
import type { ImagePyramidLoader } from '../data/imagePyramid'

export type Platform = 'xenium' | 'visium' | 'visium-hd' | 'h5ad' | 'image'
export type SpatialElementId = string

export interface SpatialGridBasis {
  readonly origin: DataPoint
  readonly rowStep: DataVector
  readonly colStep: DataVector
}

export interface SpatialGrid {
  readonly id: string
  readonly binSizeMicrometers: Micrometers
  readonly basis: SpatialGridBasis
  readonly bounds?: {
    readonly minRow: number
    readonly maxRow: number
    readonly minCol: number
    readonly maxCol: number
  }
}

export type ElementGeometry =
  | { readonly kind: 'polygon'; readonly rings: readonly (readonly DataPoint[])[] }
  | {
      readonly kind: 'circle'
      readonly center: DataPoint
      readonly diameter: Micrometers
    }
  | { readonly kind: 'square'; readonly origin: DataPoint; readonly size: Micrometers }
  | {
      readonly kind: 'grid-cell'
      readonly gridId: string
      readonly row: number
      readonly col: number
    }

export interface SpatialElement<ElementId extends SpatialElementId = SpatialElementId> {
  readonly id: ElementId
  readonly geometry: ElementGeometry
  readonly metadata?: SpatialElementMetadata
}

export interface SpatialElementMetadata {
  readonly segmentation?: SpatialElementSegmentationMetadata
}

export interface SpatialElementSegmentationMetadata {
  readonly kind: 'cell' | 'nucleus'
  readonly annotation?: SpatialElementSegmentationAnnotation
}

export interface SpatialElementSegmentationAnnotation {
  readonly label?: string
  readonly color?: string
  readonly fillColor?: string
  readonly lineColor?: string
}

export interface GridCellBatch<ElementId extends SpatialElementId = SpatialElementId> {
  readonly kind: 'grid-cells'
  readonly gridId: string
  readonly ids: readonly ElementId[]
  readonly rows: Int32Array
  readonly cols: Int32Array
}

export interface ElementBatch<ElementId extends SpatialElementId = SpatialElementId> {
  readonly elements: readonly SpatialElement<ElementId>[]
  readonly gridCells?: readonly GridCellBatch<ElementId>[]
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

export interface SegmentationInfo {
  readonly id: string
  readonly kind: 'cell' | 'nucleus'
  readonly label: string
  readonly sourceKind: 'geojson' | 'tiff'
  readonly path: string
  readonly annotated?: boolean
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
  readonly grids?: readonly SpatialGrid[]
  readonly segmentations?: readonly SegmentationInfo[]
}

export type ImageSource =
  | { readonly kind: 'pyramid'; readonly loader: ImagePyramidLoader }
  | {
      readonly kind: 'flat'
      readonly url: string
      readonly scaleFactor: number
      readonly size?: readonly [number, number]
    }

export interface Annotation<ElementId extends SpatialElementId = CellId> {
  readonly id: string
  readonly label: string
  readonly cellIds: readonly ElementId[]
}

export interface SpatialDataset<ElementId extends SpatialElementId = SpatialElementId> {
  meta(): Promise<DatasetMeta>
  elements(bbox: BBox): Promise<ElementBatch<ElementId>>
  matrix(ids: readonly ElementId[]): Promise<GexResult<ElementId>>
  annotations(
    options?: AnalysisAnnotationQueryOptions,
  ): Promise<readonly Annotation<ElementId>[]>
  image(): Promise<ImageSource | null>
  transcripts?(
    selection: Selection,
    scope: TranscriptScope,
    minQv: number,
  ): Promise<GexResult<ElementId>>
}
