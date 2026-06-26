import type { Position } from '@deck.gl/core'
import type {
  GridCellDatum,
  OverviewCellDatum,
  TranscriptPointDatum,
} from '../rendering/deckLayers'
import type {
  ViewerCellBoundaryHoverDetail,
  ViewerGridCellHoverDetail,
  ViewerOverviewCellHoverDetail,
  ViewerTranscriptHoverDetail,
} from './viewerCoreTypes'
import { formatCoordinateValue } from './viewerMeasurements'

export function GridCellHoverTooltip({
  detail,
}: {
  readonly detail: ViewerGridCellHoverDetail
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
          <dd>{formatGridCellBinSize(cell)}</dd>
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
      </dl>
    </div>
  )
}

export function OverviewCellHoverTooltip({
  detail,
}: {
  readonly detail: ViewerOverviewCellHoverDetail
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
          <dd>{isAggregateBin ? 'Overview' : 'Xenium'}</dd>
        </div>
        {cellCount === undefined ? null : (
          <div>
            <dt>Count</dt>
            <dd>{cellCount.toLocaleString()}</dd>
          </div>
        )}
        <div>
          <dt>X/Y</dt>
          <dd>{formatOverviewCellPosition(cell)}</dd>
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
            <dd>{formatCoordinateValue(cell.cellArea)} um^2</dd>
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
      </dl>
    </div>
  )
}

export function CellBoundaryHoverTooltip({
  detail,
}: {
  readonly detail: ViewerCellBoundaryHoverDetail
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
          <dt>Cell</dt>
          <dd>Segmented</dd>
        </div>
        {boundary.annotationLabel === undefined ? null : (
          <div>
            <dt>Annotation</dt>
            <dd>{boundary.annotationLabel}</dd>
          </div>
        )}
        <div>
          <dt>Vertices</dt>
          <dd>{boundary.polygon.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Area</dt>
          <dd>{formatBoundaryPolygonArea(boundary.polygon)}</dd>
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

export function TranscriptHoverTooltip({
  detail,
}: {
  readonly detail: ViewerTranscriptHoverDetail
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
        <p>
          {aggregate.featureName === undefined
            ? 'Transcript density bin'
            : aggregate.featureName}
        </p>
        <dl>
          <div>
            <dt>Count</dt>
            <dd>{aggregate.count.toLocaleString()}</dd>
          </div>
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
              {formatCoordinateValue(-(aggregate.position[1] ?? 0))} um
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
        <div>
          <dt>FOV</dt>
          <dd>{transcript.fovName ?? 'Unassigned'}</dd>
        </div>
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
            {formatCoordinateValue(-(transcript.position[1] ?? 0))} um
          </dd>
        </div>
        {transcript.zLocation === undefined ? null : (
          <div>
            <dt>Z</dt>
            <dd>{formatCoordinateValue(transcript.zLocation)} um</dd>
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
            <dd>{formatCoordinateValue(transcript.nucleusDistance)} um</dd>
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

function formatGridCellBinSize(cell: GridCellDatum): string {
  return cell.binSizeMicrometers === undefined
    ? 'Unknown'
    : `${formatCoordinateValue(cell.binSizeMicrometers)} μm`
}

function formatOverviewCellPosition(cell: OverviewCellDatum): string {
  return `${formatCoordinateValue(cell.position[0] ?? 0)}, ${formatCoordinateValue(
    -(cell.position[1] ?? 0),
  )} um`
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

function formatBoundaryPolygonArea(polygon: readonly Position[]): string {
  return `${formatCoordinateValue(boundaryPolygonArea(polygon))} um^2`
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
