import { withSquareMicrometers } from '../../data/units'
import type { CellBoundaryDatum } from '../../rendering/deckLayers'
import { CellExpressionProfilePanel } from './CellExpressionProfilePanel'
import type { CellExpressionProfileState } from './cellExpressionProfileModel'
import {
  expressionStatusLabel,
  type CellGeneExpressionStatus,
} from './cellGeneExpressionStatus'

// A Visium HD cell boundary: its shape, selected-gene expression and profile.
export function BoundaryCellInfoPanel({
  cell,
  expressionStatus,
  expressionProfileState = IDLE_CELL_EXPRESSION_PROFILE_STATE,
  onLoadExpressionProfile,
}: {
  readonly cell: CellBoundaryDatum
  readonly expressionStatus?: CellGeneExpressionStatus | undefined
  readonly expressionProfileState?: CellExpressionProfileState | undefined
  readonly onLoadExpressionProfile?: (() => void) | undefined
}) {
  const hasExpression = cell.expressionCount !== undefined
  const expressionGenes = cell.expressionGenes ?? []

  return (
    <div className="cell-detail-panel">
      <dl className="cell-info-list">
        <div>
          <dt>Cell ID</dt>
          <dd>{cell.id}</dd>
        </div>
        {cell.annotationLabel === undefined ? null : (
          <div>
            <dt>Annotation</dt>
            <dd>{cell.annotationLabel}</dd>
          </div>
        )}
        <div>
          <dt>Segmentation</dt>
          <dd>Cell boundary</dd>
        </div>
        <div>
          <dt>Vertices</dt>
          <dd>{cell.polygon.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Area</dt>
          <dd>{withSquareMicrometers(formatBoundaryArea(cell))}</dd>
        </div>
      </dl>

      <div className="cell-expression-panel">
        <div className="cell-expression-heading">
          <span>Selected-gene GEX</span>
          <small>
            {hasExpression ? 'Loaded' : expressionStatusLabel(expressionStatus)}
          </small>
        </div>
        {hasExpression ? (
          <dl className="cell-info-list">
            <div>
              <dt>Score</dt>
              <dd>{formatMetricNumber(cell.expressionCount ?? 0)}</dd>
            </div>
            <div>
              <dt>Genes</dt>
              <dd>
                {expressionGenes.length === 0
                  ? 'Selected genes'
                  : expressionGenes.join(', ')}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="cell-expression-status">
            {expressionStatus?.message ?? 'No expression loaded'}
          </p>
        )}
      </div>

      <CellExpressionProfilePanel
        state={expressionProfileState}
        selectionKind="cell"
        disabled={onLoadExpressionProfile === undefined}
        onLoad={onLoadExpressionProfile ?? noop}
      />
    </div>
  )
}

const IDLE_CELL_EXPRESSION_PROFILE_STATE: CellExpressionProfileState = {
  status: 'idle',
}

function noop(): void {}

function formatBoundaryArea(cell: CellBoundaryDatum): string {
  if (cell.polygon.length < 3) {
    return '0'
  }

  let area = 0

  for (let index = 0; index < cell.polygon.length; index += 1) {
    const current = cell.polygon[index]!
    const next = cell.polygon[(index + 1) % cell.polygon.length]!
    const currentX = current[0] ?? 0
    const currentY = current[1] ?? 0
    const nextX = next[0] ?? 0
    const nextY = next[1] ?? 0

    area += currentX * nextY - nextX * currentY
  }

  return formatMetricNumber(Math.abs(area) / 2)
}

function formatMetricNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
  })
}
