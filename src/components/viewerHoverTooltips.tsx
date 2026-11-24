import { MICROMETERS } from '../data/units'
import type { Position } from '@deck.gl/core'
import type {
  GridCellDatum,
  OverviewCellDatum,
  TranscriptAggregateDatum,
  TranscriptPointDatum,
} from '../rendering/deckLayers'
import type {
  ViewerCellBoundaryHoverDetail,
  ViewerGridCellHoverDetail,
  ViewerNucleusOrdinal,
  ViewerOverviewCellHoverDetail,
  ViewerTranscriptHoverDetail,
} from './viewerCoreTypes'
import {
  transcriptAggregateCountRows,
  transcriptAggregateTitle,
} from './viewerHoverModel'
import { formatCoordinateValue, ringVertexCount } from './viewerMeasurements'

// Each tooltip writes lengths and areas in the viewer's data unit: µm, or
// "units" for a SpatialData dataset whose units are unknown (EXP-052).
export function GridCellHoverTooltip({
  detail,
  unitLabel = MICROMETERS,
}: {
  readonly detail: ViewerGridCellHoverDetail
  readonly unitLabel?: string
}) {
  const cell = detail.cell

  return (
    <div
      className="transcript-hover-tooltip grid-cell-hover-tooltip"
      style={{
        left: detail.screen.x,
        top: detail.screen.y,
      }}
      aria-hidden="true"
    >
      <p>{cell.id}</p>
      <dl>
        <div>
          <dt>Bin</dt>
          <dd>{formatGridCellBinSize(cell, unitLabel)}</dd>
        </div>
        <div>
          <dt>Array</dt>
          <dd>
            {cell.row.toLocaleString()}, {cell.col.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Image px</dt>
          <dd>{formatGridCellImageCoordinate(cell)}</dd>
        </div>
        <div>
          <dt>Tissue</dt>
          <dd>{formatGridCellTissue(cell)}</dd>
        </div>
        {cell.expressionCount === undefined ? null : (
          <div>
            <dt>Expression</dt>
            <dd>{formatCoordinateValue(cell.expressionCount)}</dd>
          </div>
        )}
        <AnnotationLabelsRow labels={detail.annotationLabels} />
      </dl>
    </div>
  )
}

export function OverviewCellHoverTooltip({
  detail,
  sourceLabel = 'Xenium',
  unitLabel = MICROMETERS,
}: {
  readonly detail: ViewerOverviewCellHoverDetail
  readonly sourceLabel?: string
  readonly unitLabel?: string
}) {
  const cell = detail.cell
  const cellCount = cell.cellCount
  const isAggregateBin = cellCount !== undefined || cell.id.startsWith('cell-bin:')

  return (
    <div
      className="transcript-hover-tooltip grid-cell-hover-tooltip overview-cell-hover-tooltip"
      style={{
        left: detail.screen.x,
        top: detail.screen.y,
      }}
      aria-hidden="true"
    >
      <p>{cell.id}</p>
      <dl>
        <div>
          <dt>{isAggregateBin ? 'Bin' : 'Cell'}</dt>
          <dd>{isAggregateBin ? 'Overview' : sourceLabel}</dd>
        </div>
        {cellCount === undefined ? null : (
          <div>
            <dt>Count</dt>
            <dd>{cellCount.toLocaleString()}</dd>
          </div>
        )}
        <div>
          <dt>X/Y</dt>
          <dd>{formatOverviewCellPosition(cell, unitLabel)}</dd>
        </div>
        {cell.transcriptCount === undefined ? null : (
          <div>
            <dt>Tx</dt>
            <dd>{cell.transcriptCount.toLocaleString()}</dd>
          </div>
        )}
        {cell.cellArea === undefined ? null : (
          <div>
            <dt>Area</dt>
            <dd>{withAreaUnit(formatCoordinateValue(cell.cellArea), unitLabel)}</dd>
          </div>
        )}
        {cell.expressionCount === undefined ? null : (
          <div>
            <dt>Expression</dt>
            <dd>{formatCoordinateValue(cell.expressionCount)}</dd>
          </div>
        )}
        {cell.expressionGenes === undefined ||
        cell.expressionGenes.length === 0 ? null : (
          <div>
            <dt>Genes</dt>
            <dd>{formatExpressionGeneList(cell.expressionGenes)}</dd>
          </div>
        )}
        <AnnotationLabelsRow labels={detail.annotationLabels} />
      </dl>
    </div>
  )
}

export function CellBoundaryHoverTooltip({
  detail,
  sourceLabel = 'Xenium',
  unitLabel = MICROMETERS,
}: {
  readonly detail: ViewerCellBoundaryHoverDetail
  readonly sourceLabel?: string
  readonly unitLabel?: string
}) {
  const boundary = detail.boundary
  const cell = detail.cell

  if (detail.nucleus !== undefined) {
    return (
      <NucleusBoundaryHoverTooltip
        detail={detail}
        nucleus={detail.nucleus}
        unitLabel={unitLabel}
      />
    )
  }

  return (
    <div
      className="transcript-hover-tooltip grid-cell-hover-tooltip cell-boundary-hover-tooltip"
      style={{
        left: detail.screen.x,
        top: detail.screen.y,
      }}
      aria-hidden="true"
    >
      <p>{boundary.id}</p>
      <dl>
        <div>
          <dt>Cell</dt>
          <dd>{cell === undefined ? 'Segmented' : sourceLabel}</dd>
        </div>
        {boundary.annotationLabel === undefined ? null : (
          <div>
            <dt>Annotation</dt>
            <dd>{boundary.annotationLabel}</dd>
          </div>
        )}
        <AnnotationLabelsRow labels={detail.annotationLabels} />
        {cell === undefined ? null : (
          <div>
            <dt>X/Y</dt>
            <dd>{formatOverviewCellPosition(cell, unitLabel)}</dd>
          </div>
        )}
        {cell?.transcriptCount === undefined ? null : (
          <div>
            <dt>Tx</dt>
            <dd>{cell.transcriptCount.toLocaleString()}</dd>
          </div>
        )}
        {cell?.cellArea === undefined ? null : (
          <div>
            <dt>Cell Area</dt>
            <dd>{withAreaUnit(formatCoordinateValue(cell.cellArea), unitLabel)}</dd>
          </div>
        )}
        <div>
          <dt>Vertices</dt>
          <dd>{ringVertexCount(boundary.polygon).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Area</dt>
          <dd>{formatBoundaryPolygonArea(boundary.polygon, unitLabel)}</dd>
        </div>
        {detail.expressionCount === undefined ? null : (
          <div>
            <dt>Expression</dt>
            <dd>{formatCoordinateValue(detail.expressionCount)}</dd>
          </div>
        )}
        {detail.expressionGenes === undefined ||
        detail.expressionGenes.length === 0 ? null : (
          <div>
            <dt>Genes</dt>
            <dd>{formatExpressionGeneList(detail.expressionGenes)}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

// A nucleus: its cell, its place among the cell's nuclei, and its outline.
function NucleusBoundaryHoverTooltip({
  detail,
  nucleus,
  unitLabel,
}: {
  readonly detail: ViewerCellBoundaryHoverDetail
  readonly nucleus: ViewerNucleusOrdinal
  readonly unitLabel: string
}) {
  const boundary = detail.boundary

  return (
    <div
      className="transcript-hover-tooltip grid-cell-hover-tooltip cell-boundary-hover-tooltip"
      style={{
        left: detail.screen.x,
        top: detail.screen.y,
      }}
      aria-hidden="true"
    >
      <p>{boundary.id}</p>
      <dl>
        <div>
          <dt>Nucleus</dt>
          <dd>
            {nucleus.ordinal === undefined || nucleus.count === undefined
              ? 'Segmented'
              : `${nucleus.ordinal.toLocaleString()} of ${nucleus.count.toLocaleString()}`}
          </dd>
        </div>
        {boundary.cellId === undefined ? null : (
          <div>
            <dt>Cell</dt>
            <dd>{boundary.cellId}</dd>
          </div>
        )}
        <div>
          <dt>Vertices</dt>
          <dd>{ringVertexCount(boundary.polygon).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Area</dt>
          <dd>{formatBoundaryPolygonArea(boundary.polygon, unitLabel)}</dd>
        </div>
      </dl>
    </div>
  )
}

function AnnotationLabelsRow({
  labels,
}: {
  readonly labels: readonly string[] | undefined
}) {
  return labels === undefined || labels.length === 0 ? null : (
    <div className="hover-tooltip-annotation-row">
      <dt>Annotations</dt>
      <dd>{formatAnnotationLabels(labels)}</dd>
    </div>
  )
}

// Each selected gene's count in a square, when it counts more than one.
function selectedGeneRows(aggregate: TranscriptAggregateDatum) {
  const features = aggregate.topFeatures ?? []

  return aggregate.selectedGeneCount === undefined || features.length < 2 ? [] : features
}

export function TranscriptHoverTooltip({
  detail,
  unitLabel = MICROMETERS,
}: {
  readonly detail: ViewerTranscriptHoverDetail
  readonly unitLabel?: string
}) {
  const aggregate = detail.aggregate

  if (aggregate !== undefined) {
    return (
      <div
        className="transcript-hover-tooltip"
        style={{
          left: detail.screen.x,
          top: detail.screen.y,
        }}
        aria-hidden="true"
      >
        <p>{transcriptAggregateTitle(aggregate)}</p>
        <dl>
          {transcriptAggregateCountRows(aggregate).map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
          {selectedGeneRows(aggregate).map((feature) => (
            <div key={feature.featureName}>
              <dt>{feature.featureName}</dt>
              <dd>{feature.count.toLocaleString()}</dd>
            </div>
          ))}
          {aggregate.binTotalCount === undefined ? null : (
            <div>
              <dt>Total</dt>
              <dd>{aggregate.binTotalCount.toLocaleString()}</dd>
            </div>
          )}
          <div>
            <dt>Level</dt>
            <dd>{aggregate.level.toLocaleString()}</dd>
          </div>
          <div>
            <dt>X/Y</dt>
            <dd>
              {formatCoordinateValue(aggregate.position[0] ?? 0)},{' '}
              {withLengthUnit(
                formatCoordinateValue(-(aggregate.position[1] ?? 0)),
                unitLabel,
              )}
            </dd>
          </div>
          <div>
            <dt>Bin</dt>
            <dd>
              {aggregate.binX.toLocaleString()}, {aggregate.binY.toLocaleString()}
            </dd>
          </div>
          {aggregate.omittedFeatureCount === undefined ? null : (
            <div>
              <dt>Hidden</dt>
              <dd>{aggregate.omittedFeatureCount.toLocaleString()} genes</dd>
            </div>
          )}
        </dl>
      </div>
    )
  }

  const transcript = detail.transcript

  if (transcript === undefined) {
    return null
  }

  const transcriptCellLabel = transcriptCellDisplayLabel(transcript)

  return (
    <div
      className="transcript-hover-tooltip"
      style={{
        left: detail.screen.x,
        top: detail.screen.y,
      }}
      aria-hidden="true"
    >
      <p>{transcript.featureName}</p>
      <dl>
        <div>
          <dt>ID</dt>
          <dd>{transcript.transcriptId ?? transcript.id}</dd>
        </div>
        {/* Atera transcripts have no FOV. */}
        {transcript.fovName === null ? null : (
          <div>
            <dt>FOV</dt>
            <dd>{transcript.fovName}</dd>
          </div>
        )}
        {transcriptCellLabel === null ? null : (
          <div>
            <dt>Cell</dt>
            <dd>{transcriptCellLabel}</dd>
          </div>
        )}
        <div>
          <dt>QV</dt>
          <dd>{formatCoordinateValue(transcript.qv)}</dd>
        </div>
        <div>
          <dt>X/Y</dt>
          <dd>
            {formatCoordinateValue(transcript.position[0] ?? 0)},{' '}
            {withLengthUnit(
              formatCoordinateValue(-(transcript.position[1] ?? 0)),
              unitLabel,
            )}
          </dd>
        </div>
        {transcript.zLocation === undefined ? null : (
          <div>
            <dt>Z</dt>
            <dd>
              {withLengthUnit(formatCoordinateValue(transcript.zLocation), unitLabel)}
            </dd>
          </div>
        )}
        {transcript.overlapsNucleus === undefined ? null : (
          <div>
            <dt>Nucleus</dt>
            <dd>{transcript.overlapsNucleus ? 'Overlap' : 'Outside'}</dd>
          </div>
        )}
        {transcript.nucleusDistance === undefined ? null : (
          <div>
            <dt>Distance</dt>
            <dd>
              {withLengthUnit(
                formatCoordinateValue(transcript.nucleusDistance),
                unitLabel,
              )}
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function transcriptCellDisplayLabel(transcript: TranscriptPointDatum): string | null {
  if (transcript.cellId !== null) {
    return transcript.cellId
  }

  return transcript.cellAssignment === 'unassigned' ? 'Unassigned' : null
}

function withLengthUnit(value: string, unitLabel: string): string {
  return `${value} ${unitLabel}`
}

function withAreaUnit(value: string, unitLabel: string): string {
  return `${value} ${unitLabel}²`
}

function formatGridCellBinSize(cell: GridCellDatum, unitLabel: string): string {
  return cell.binSizeMicrometers === undefined
    ? 'Unknown'
    : withLengthUnit(formatCoordinateValue(cell.binSizeMicrometers), unitLabel)
}

function formatOverviewCellPosition(cell: OverviewCellDatum, unitLabel: string): string {
  return withLengthUnit(
    `${formatCoordinateValue(cell.position[0] ?? 0)}, ${formatCoordinateValue(
      -(cell.position[1] ?? 0),
    )}`,
    unitLabel,
  )
}

function formatGridCellImageCoordinate(cell: GridCellDatum): string {
  if (cell.fullresRow === undefined || cell.fullresCol === undefined) {
    return 'Unknown'
  }

  return `${formatCoordinateValue(cell.fullresRow)}, ${formatCoordinateValue(
    cell.fullresCol,
  )} px`
}

function formatGridCellTissue(cell: GridCellDatum): string {
  if (cell.inTissue === undefined) {
    return 'Unknown'
  }

  return cell.inTissue ? 'In tissue' : 'Out of tissue'
}

function formatBoundaryPolygonArea(
  polygon: readonly Position[],
  unitLabel: string,
): string {
  return withAreaUnit(formatCoordinateValue(boundaryPolygonArea(polygon)), unitLabel)
}

function boundaryPolygonArea(polygon: readonly Position[]): number {
  if (polygon.length < 3) {
    return 0
  }

  let area = 0

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    const currentX = current[0] ?? 0
    const currentY = current[1] ?? 0
    const nextX = next[0] ?? 0
    const nextY = next[1] ?? 0

    area += currentX * nextY - nextX * currentY
  }

  return Math.abs(area) / 2
}

function formatExpressionGeneList(genes: readonly string[]): string {
  const shownGenes = genes.slice(0, 3)
  const omittedCount = genes.length - shownGenes.length
  const suffix = omittedCount <= 0 ? '' : ` +${omittedCount.toLocaleString()}`

  return `${shownGenes.join(', ')}${suffix}`
}

function formatAnnotationLabels(labels: readonly string[]): string {
  const shownLabels = labels.slice(0, 3)
  const omittedCount = labels.length - shownLabels.length
  const suffix = omittedCount <= 0 ? '' : ` +${omittedCount.toLocaleString()}`

  return `${shownLabels.join(', ')}${suffix}`
}
