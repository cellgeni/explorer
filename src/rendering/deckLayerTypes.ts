import type { BinaryAttribute, Color, Position } from '@deck.gl/core'
import type {
  TranscriptAggregateFeatureSummary,
  TranscriptCellAssignment,
} from '../data/transcriptOverlay'

export interface OverviewCellDatum {
  readonly id: string
  readonly position: Position
  readonly radiusPixels: number
  readonly radiusMicrometers?: number
  readonly fillColor: Color
  readonly cellCount?: number
  readonly transcriptCount?: number
  readonly cellArea?: number
  readonly binSizeMicrometers?: number
  readonly nucleusCount?: number
  readonly segmentationMethod?: string
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
}

export interface OverviewViewState {
  readonly target: [number, number, number]
  readonly zoom: number
  readonly minZoom: number
  readonly maxZoom: number
}

export interface CellBoundaryDatum {
  readonly id: string
  readonly annotationLabel?: string
  readonly polygon: readonly Position[]
  readonly fillColor: Color
  readonly lineColor: Color
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
}

export interface GridCellDatum {
  readonly id: string
  readonly gridId: string
  readonly row: number
  readonly col: number
  readonly binSizeMicrometers?: number
  readonly inTissue?: boolean
  readonly fullresRow?: number
  readonly fullresCol?: number
  readonly polygon: readonly Position[]
  readonly fillColor: Color
  readonly lineColor: Color
  readonly expressionCount?: number
  readonly expressionGenes?: readonly string[]
}

export interface GridCellLayerDataOptions {
  readonly metadata?: readonly GridCellLayerBatchMetadata[]
}

export interface GridCellLayerBatchMetadata {
  readonly binSizeMicrometers?: number
  readonly inTissue?: ArrayLike<number>
  readonly fullresRows?: ArrayLike<number>
  readonly fullresCols?: ArrayLike<number>
}

export interface CellBoundaryLayerGeometryOptions {
  readonly includeFill?: boolean
}

export interface BoundaryElementsToLayerDataOptions {
  readonly fillColor?: Color
  readonly lineColor?: Color
}

export interface CellBoundaryPathGeometryData {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly attributes: {
    readonly getPath: BinaryAttribute
  }
}

export interface CellBoundaryFillGeometryData {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly attributes: {
    readonly getPolygon: BinaryAttribute
  }
}

export interface CellBoundaryLayerGeometry {
  readonly pathLayerData: CellBoundaryPathGeometryData
  readonly fillLayerData: CellBoundaryFillGeometryData
  readonly pathCellIds: readonly string[]
  readonly fillCellIds: readonly string[]
  readonly pathLineColors: readonly Color[]
  readonly fillColors: readonly Color[]
  readonly boundaryCellIds: ReadonlySet<string>
}

export interface CellBoundaryLayerStyle {
  readonly fillColorByCellId: ReadonlyMap<string, Color>
  readonly lineColorByCellId: ReadonlyMap<string, Color>
}

export interface CellBoundaryPathLayerData {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly geometryKey: CellBoundaryPathGeometryData
  readonly attributes: Record<string, BinaryAttribute>
}

export interface CellBoundaryFillLayerData {
  readonly length: number
  readonly startIndices: Uint32Array
  readonly geometryKey: CellBoundaryFillGeometryData
  readonly attributes: Record<string, BinaryAttribute>
}

export interface TranscriptPointDatum {
  readonly id: string
  readonly transcriptId?: string
  readonly position: Position
  readonly featureName: string
  readonly fovName: string | null
  readonly cellId: string | null
  readonly cellAssignment?: TranscriptCellAssignment
  readonly qv: number
  readonly zLocation?: number
  readonly overlapsNucleus?: boolean
  readonly isGene?: boolean
  readonly nucleusDistance?: number
  readonly fillColor: Color
}

export interface TranscriptAggregateDatum {
  readonly id: string
  readonly position: Position
  readonly source?: 'cell-summary' | 'native-zarr'
  readonly glyphType?: 'density' | 'feature-circle'
  readonly level: number
  readonly binX: number
  readonly binY: number
  readonly count: number
  readonly radiusMicrometers: number
  readonly binSizeMicrometers?: number
  readonly binTotalCount?: number
  readonly selectedGeneCount?: number
  readonly omittedFeatureCount?: number
  readonly omittedTranscriptCount?: number
  readonly topFeatures?: readonly TranscriptAggregateFeatureSummary[]
  readonly featureName?: string
  readonly fovName?: string
  readonly fillColor: Color
}

export interface OverviewLayerOptions {
  readonly cellFillOpacity?: number
  readonly cellBoundaryOpacity?: number
  readonly cellBoundaryFillEnabled?: boolean
  readonly cellBoundaryPickable?: boolean
  readonly nucleusBoundaries?: readonly CellBoundaryDatum[]
  readonly nucleusBoundaryOpacity?: number
  readonly gridCells?: readonly GridCellDatum[]
  readonly gridCellOpacity?: number
  readonly cellBoundaryGeometry?: CellBoundaryLayerGeometry
  readonly cellBoundaryStyle?: CellBoundaryLayerStyle
  readonly geneExpressionActive?: boolean
  readonly geneExpressionOverlayElements?: readonly OverviewCellDatum[]
  readonly transcriptAggregateBins?: readonly TranscriptAggregateDatum[]
  readonly transcriptPoints?: readonly TranscriptPointDatum[]
  readonly transcriptOpacity?: number
  readonly transcriptPointSize?: number
}

export type GeneExpressionColorScale =
  | 'gold'
  | 'magma'
  | 'viridis'
  | 'plasma'
  | 'cividis'
  | 'teal'
  | 'rose'
  | 'glasbey'
export type GeneExpressionScoreMode = 'sum' | 'mean' | 'z-score'
export type TranscriptDensityColorScale =
  | 'thermal'
  | 'magma'
  | 'viridis'
  | 'cividis'
  | 'teal'
export type TranscriptPointColorMode = 'feature' | 'quality'

export interface GeneExpressionColorScaleOption {
  readonly id: GeneExpressionColorScale
  readonly label: string
}

export interface TranscriptDensityColorScaleOption {
  readonly id: TranscriptDensityColorScale
  readonly label: string
}

export interface TranscriptPointColorModeOption {
  readonly id: TranscriptPointColorMode
  readonly label: string
}

export interface GeneExpressionScoreModeOption {
  readonly id: GeneExpressionScoreMode
  readonly label: string
}

export interface GeneExpressionLayerDataOptions {
  readonly scaleMax?: number
}

export interface GeneExpressionElementStyleOptions {
  readonly binMicrometers?: number
  readonly styleUnmatchedCells?: boolean
}

export interface GeneExpressionElementStyleIndex {
  readonly expressionByElementId: ReadonlyMap<string, OverviewCellDatum>
  readonly expressionByBinKey?: ReadonlyMap<string, OverviewCellDatum>
  readonly binMicrometers?: number
}

export interface TranscriptAggregateLayerDataOptions {
  readonly scaleMax?: number
}

export type ColorStop = readonly [number, number, number, number]

export interface GeneExpressionBinStyle {
  count: number
  maxAlpha: number
  sumRed: number
  sumGreen: number
  sumBlue: number
  sumExpressionCount: number
  hasExpressionCount: boolean
  expressionGenes: readonly string[] | undefined
}
