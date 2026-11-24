import type { GetPickingInfoParams, PickingInfo } from '@deck.gl/core'
import { DataFilterExtension } from '@deck.gl/extensions'
import type { DataFilterExtensionProps } from '@deck.gl/extensions'
import { ScatterplotLayer } from '@deck.gl/layers'
import type { ScatterplotLayerProps } from '@deck.gl/layers'
import type { CellOverviewPoint } from '../data/hyparquetCells'
import {
  cellAreaToRadiusMicrometers,
  cellPointOutlineColor,
  colorWithFillOpacity,
  colorWithOpacity,
  DEFAULT_OVERVIEW_CELL_FILL_RGB,
} from './deckLayerColors'
import type { CellPointGeometry, CellPointLayerColors } from './cellPointStyle'
import type { OverviewCellDatum } from './deckLayerTypes'
import { attributeDescriptor, samePackedLayerData } from './packedLayerData'

export interface CellPointLayerOptions {
  readonly cellFillOpacity: number
  readonly cellBoundaryOpacity: number
  readonly filled: boolean
  readonly pickable?: boolean
  readonly radiusMaxPixels?: number
  // Multiplies each radius and both screen-pixel limits.
  readonly radiusScale?: number
  // Packed per-cell geometry, colours (opacity applied) and GPU filter values.
  readonly packed?: {
    readonly geometry: CellPointGeometry
    readonly colors: CellPointLayerColors
    readonly filterValues: Float32Array
    readonly sampleFraction: number
  }
}

// Shared so the layer's extensions stay the same between renders.
const CELL_POINT_FILTER = new DataFilterExtension({ filterSize: 2 })

type PackedCellPointLayerProps = ScatterplotLayerProps<OverviewCellDatum> &
  Partial<DataFilterExtensionProps<OverviewCellDatum>> & {
    // Cells by index, for picking: the layer data itself is packed arrays.
    readonly cells: readonly OverviewCellDatum[]
  }

class PackedCellPointLayer extends ScatterplotLayer<
  OverviewCellDatum,
  Partial<DataFilterExtensionProps<OverviewCellDatum>> & {
    readonly cells: readonly OverviewCellDatum[]
  }
> {
  static override layerName = 'PackedCellPointLayer'
  // deck.gl merges these with the ScatterplotLayer defaults.
  static override defaultProps = {
    cells: { type: 'object', value: [], compare: false },
  } as unknown as typeof ScatterplotLayer.defaultProps

  override getPickingInfo(params: GetPickingInfoParams): PickingInfo {
    const info = super.getPickingInfo(params)

    if (info.index >= 0) {
      info.object = this.props.cells[info.index]
    }

    return info
  }
}

// Smallest radii at 1x. A cell point is at least about a pixel across, so a
// sparse section stays visible at its full view, where its cells are far
// smaller than a pixel; expression points stay a little larger, to stand out
// over the cells. Kept within 2x of each other, so one Cell point size suits
// either colouring.
const CELL_RADIUS_MIN_PIXELS = 0.5
const GENE_EXPRESSION_RADIUS_MIN_PIXELS = 1
const DEFAULT_CELL_RADIUS_MAX_PIXELS = 24
const DEFAULT_GENE_EXPRESSION_RADIUS_MAX_PIXELS = 28
const OVERVIEW_FULL_VIEW_RADIUS_MAX_PIXELS = 10
const GENE_EXPRESSION_FULL_VIEW_RADIUS_MAX_PIXELS = 12
const POINT_SIZE_ZOOM_EASE_START = 1
const POINT_SIZE_ZOOM_EASE_MID = 8
const POINT_SIZE_ZOOM_EASE_END = 10
const POINT_SIZE_ZOOM_MID_CLOSE_SCALE = 0.7

// Applied as deck.gl's radiusScale uniform, so a size change re-uploads no
// attributes.
function scaledRadiusProps(
  options: CellPointLayerOptions,
  radiusMinPixels: number,
  defaultRadiusMaxPixels: number,
) {
  const scale = options.radiusScale ?? 1

  return {
    radiusUnits: 'common',
    radiusScale: scale,
    radiusMinPixels: radiusMinPixels * scale,
    radiusMaxPixels: (options.radiusMaxPixels ?? defaultRadiusMaxPixels) * scale,
  } as const
}

export function createCellPointLayer(
  cells: readonly OverviewCellDatum[],
  options: CellPointLayerOptions,
): ScatterplotLayer<OverviewCellDatum> | PackedCellPointLayer {
  const common = {
    id: 'cells-overview-scatter',
    pickable: options.pickable ?? true,
    ...scaledRadiusProps(options, CELL_RADIUS_MIN_PIXELS, DEFAULT_CELL_RADIUS_MAX_PIXELS),
    stroked: options.cellBoundaryOpacity > 0,
    filled: options.filled,
    opacity: 1,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    getLineWidth: 1,
  } as const
  const packed = options.packed

  if (packed !== undefined) {
    const props: PackedCellPointLayerProps = {
      ...common,
      cells,
      data: {
        length: cells.length,
        attributes: {
          getPosition: attributeDescriptor(packed.geometry.positions, 2),
          getRadius: attributeDescriptor(packed.geometry.radii, 1),
          getFillColor: attributeDescriptor(packed.colors.fill, 4, true),
          getLineColor: attributeDescriptor(packed.colors.line, 4, true),
          getFilterValue: attributeDescriptor(packed.filterValues, 2),
        },
      } as unknown as PackedCellPointLayerProps['data'],
      // The data wrapper is rebuilt every render; only changed arrays count as
      // new data, or deck.gl would regenerate picking colours on every frame.
      dataComparator: samePackedLayerData,
      // Sampled cells by rank, and no point where an outline is drawn.
      filterRange: [
        [0, packed.sampleFraction],
        [0, 0.5],
      ],
      extensions: [CELL_POINT_FILTER],
    }

    return new PackedCellPointLayer(props)
  }

  return new ScatterplotLayer<OverviewCellDatum>({
    ...common,
    data: cells,
    getPosition: (cell) => cell.position,
    getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
    getFillColor: (cell) => colorWithFillOpacity(cell.fillColor, options.cellFillOpacity),
    getLineColor: (cell) =>
      colorWithOpacity(
        cellPointOutlineColor(cell.fillColor),
        options.cellBoundaryOpacity,
      ),
    updateTriggers: {
      getFillColor: [options.cellFillOpacity],
      getLineColor: [options.cellBoundaryOpacity],
    },
  })
}

export function createGeneExpressionScatterLayer(
  cells: readonly OverviewCellDatum[],
  options: CellPointLayerOptions,
): ScatterplotLayer<OverviewCellDatum> | null {
  if (cells.length === 0) {
    return null
  }

  return new ScatterplotLayer<OverviewCellDatum>({
    id: 'gene-expression-scatter',
    data: cells,
    pickable: false,
    ...scaledRadiusProps(
      options,
      GENE_EXPRESSION_RADIUS_MIN_PIXELS,
      DEFAULT_GENE_EXPRESSION_RADIUS_MAX_PIXELS,
    ),
    stroked: options.cellBoundaryOpacity > 0,
    filled: true,
    opacity: 1,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    getPosition: (cell) => cell.position,
    getRadius: (cell) => cell.radiusMicrometers ?? cell.radiusPixels,
    getFillColor: (cell) => colorWithFillOpacity(cell.fillColor, options.cellFillOpacity),
    getLineColor: (cell) =>
      colorWithOpacity(
        cellPointOutlineColor(cell.fillColor),
        options.cellBoundaryOpacity,
      ),
    getLineWidth: 1,
    updateTriggers: {
      getFillColor: [options.cellFillOpacity],
      getLineColor: [options.cellBoundaryOpacity],
    },
  })
}

// `pointCount` is how many cell points the full view draws; more than
// CROWDED_POINT_COUNT draw smaller there (crowdedRadiusMaxPixels).
export function overviewCellRadiusMaxPixels(
  zoomDelta: number | undefined,
  fullViewScale = 1,
  pointCount?: number,
): number {
  return crowdedRadiusMaxPixels(
    zoomDelta,
    OVERVIEW_FULL_VIEW_RADIUS_MAX_PIXELS * normalizedFullViewScale(fullViewScale),
    DEFAULT_CELL_RADIUS_MAX_PIXELS,
    pointCount,
    CELL_RADIUS_MIN_PIXELS,
  )
}

export function geneExpressionRadiusMaxPixels(
  zoomDelta: number | undefined,
  fullViewScale = 1,
  pointCount?: number,
): number {
  return crowdedRadiusMaxPixels(
    zoomDelta,
    GENE_EXPRESSION_FULL_VIEW_RADIUS_MAX_PIXELS * normalizedFullViewScale(fullViewScale),
    DEFAULT_GENE_EXPRESSION_RADIUS_MAX_PIXELS,
    pointCount,
    GENE_EXPRESSION_RADIUS_MIN_PIXELS,
  )
}

// Radius, in µm, of a cell without an area: 10 to 20 µm across, the usual
// size of a cell, larger with more transcripts.
const FALLBACK_CELL_RADIUS_MIN_MICROMETERS = 5
const FALLBACK_CELL_RADIUS_RANGE_MICROMETERS = 5

export function overviewCellsToLayerData(
  cells: readonly CellOverviewPoint[],
): readonly OverviewCellDatum[] {
  if (cells.length === 0) {
    return []
  }

  let maxTranscriptCount = 1

  for (const cell of cells) {
    maxTranscriptCount = Math.max(maxTranscriptCount, cell.transcriptCount)
  }

  return cells.map((cell, index) => {
    const intensity = Math.sqrt(Math.max(cell.transcriptCount, 0) / maxTranscriptCount)
    const radiusMicrometers = cellAreaToRadiusMicrometers(cell.cellArea)

    return {
      id: cell.cellId ?? `overview-cell-${index}`,
      position: [cell.position.x, -cell.position.y, 0],
      ...(cell.z === undefined ? {} : { z: cell.z }),
      radiusPixels:
        FALLBACK_CELL_RADIUS_MIN_MICROMETERS +
        intensity * FALLBACK_CELL_RADIUS_RANGE_MICROMETERS,
      ...(radiusMicrometers === undefined ? {} : { radiusMicrometers }),
      fillColor: [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 150 + Math.round(intensity * 90)],
      transcriptCount: cell.transcriptCount,
      ...(cell.cellArea === undefined ? {} : { cellArea: cell.cellArea }),
      ...(cell.nucleusCount === undefined ? {} : { nucleusCount: cell.nucleusCount }),
      ...(cell.segmentationMethod === undefined
        ? {}
        : { segmentationMethod: cell.segmentationMethod }),
      ...(cell.metadata === undefined ? {} : { metadata: cell.metadata }),
      ...(cell.readMetadata === undefined ? {} : { readMetadata: cell.readMetadata }),
    }
  })
}

export function cellsWithoutVisibleBoundaryIds(
  cells: readonly OverviewCellDatum[],
  boundaryCellIds: ReadonlySet<string>,
): readonly OverviewCellDatum[] {
  if (cells.length === 0 || boundaryCellIds.size === 0) {
    return cells
  }

  return cells.filter((cell) => !boundaryCellIds.has(cell.id))
}

// Up to this many points keep the full-view size. Points of a larger dataset
// are packed closer on screen, by the square root of their number, so they are
// drawn smaller to match: overlapping points cost GPU fill on every frame, and
// a million cells at the usual size made each frame of a pan take 0.2 s.
const CROWDED_POINT_COUNT = 20_000

// The point size cap for `pointCount` points: smaller at the full view than
// zoomResponsiveRadiusMaxPixels for a crowded dataset, then twice as large per
// zoom level, as the points spread apart, until it reaches the usual cap. Never
// below `minPixels`, the layer's smallest radius.
function crowdedRadiusMaxPixels(
  zoomDelta: number | undefined,
  fullViewPixels: number,
  closeViewPixels: number,
  pointCount: number | undefined,
  minPixels: number,
): number {
  const usual = zoomResponsiveRadiusMaxPixels(zoomDelta, fullViewPixels, closeViewPixels)

  if (
    zoomDelta === undefined ||
    !Number.isFinite(zoomDelta) ||
    pointCount === undefined ||
    !(pointCount > CROWDED_POINT_COUNT)
  ) {
    return usual
  }

  const crowded =
    fullViewPixels *
    Math.sqrt(CROWDED_POINT_COUNT / pointCount) *
    2 ** Math.max(zoomDelta, 0)

  return Math.max(minPixels, Math.min(usual, roundToTenth(crowded)))
}

function zoomResponsiveRadiusMaxPixels(
  zoomDelta: number | undefined,
  fullViewPixels: number,
  closeViewPixels: number,
): number {
  if (zoomDelta === undefined || !Number.isFinite(zoomDelta)) {
    return closeViewPixels
  }

  const midViewPixels = Math.max(
    fullViewPixels,
    closeViewPixels * POINT_SIZE_ZOOM_MID_CLOSE_SCALE,
  )

  if (zoomDelta <= POINT_SIZE_ZOOM_EASE_MID) {
    const progress = smoothstep(
      clamp01(
        (zoomDelta - POINT_SIZE_ZOOM_EASE_START) /
          (POINT_SIZE_ZOOM_EASE_MID - POINT_SIZE_ZOOM_EASE_START),
      ),
    )

    return roundToTenth(fullViewPixels + (midViewPixels - fullViewPixels) * progress)
  }

  const progress = smoothstep(
    clamp01(
      (zoomDelta - POINT_SIZE_ZOOM_EASE_MID) /
        (POINT_SIZE_ZOOM_EASE_END - POINT_SIZE_ZOOM_EASE_MID),
    ),
  )

  return roundToTenth(midViewPixels + (closeViewPixels - midViewPixels) * progress)
}

function normalizedFullViewScale(scale: number): number {
  return Number.isFinite(scale) ? Math.max(0.1, scale) : 1
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10
}

export function hasGeneExpressionStyle(cell: OverviewCellDatum): boolean {
  return cell.expressionCount !== undefined || cell.expressionGenes !== undefined
}
