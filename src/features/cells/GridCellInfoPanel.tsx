import type { GridCellDatum } from '../../rendering/deckLayers'
import {
  gridCellAssignmentLocationLabel,
  gridCellAssignmentStatusLabel,
  type GridCellAssignmentState,
} from './gridCellAssignmentModel'
import {
  expressionStatusLabel,
  type CellGeneExpressionStatus,
} from './cellGeneExpressionStatus'
import { CellExpressionProfilePanel } from './CellExpressionProfilePanel'
import type { CellExpressionProfileState } from './cellExpressionProfileModel'

interface GridCellInfoPanelProps {
  readonly cell: GridCellDatum | null
  readonly assignmentState?: GridCellAssignmentState
  readonly expressionStatus?: CellGeneExpressionStatus | undefined
  readonly expressionProfileState?: CellExpressionProfileState | undefined
  readonly onLoadExpressionProfile?: (() => void) | undefined
}

export function GridCellInfoPanel({
  cell,
  assignmentState = { status: 'idle' },
  expressionStatus,
  expressionProfileState = IDLE_CELL_EXPRESSION_PROFILE_STATE,
  onLoadExpressionProfile,
}: GridCellInfoPanelProps) {
  if (cell === null) {
    return <p className="cell-info-empty">No bin selected</p>
  }

  const hasExpression = cell.expressionCount !== undefined
  const expressionGenes = cell.expressionGenes ?? []

  return (
    <div className="cell-detail-panel">
      <dl className="cell-info-list">
        <div>
          <dt>Barcode</dt>
          <dd>{cell.id}</dd>
        </div>
        <div>
          <dt>Bin Size</dt>
          <dd>{formatMetric(cell.binSizeMicrometers, 'um')}</dd>
        </div>
        <div>
          <dt>Tissue</dt>
          <dd>{formatTissueStatus(cell.inTissue)}</dd>
        </div>
        <div>
          <dt>Array</dt>
          <dd>
            row {formatNumber(cell.row)}, col {formatNumber(cell.col)}
          </dd>
        </div>
        <div>
          <dt>Image Px</dt>
          <dd>{formatImageCoordinate(cell)}</dd>
        </div>
      </dl>

      <div className="cell-expression-panel">
        <div className="cell-expression-heading">
          <span>Cell assignment</span>
          <small>{gridCellAssignmentStatusLabel(assignmentState)}</small>
        </div>
        <GridCellAssignmentDetail state={assignmentState} />
      </div>

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
              <dd>{formatNumber(cell.expressionCount ?? 0)}</dd>
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
        selectionKind="bin"
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

function GridCellAssignmentDetail({
  state,
}: {
  readonly state: GridCellAssignmentState
}) {
  if (state.status === 'ready') {
    return (
      <dl className="cell-info-list">
        <div>
          <dt>Cell ID</dt>
          <dd>{state.assignment.cellId}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{gridCellAssignmentLocationLabel(state.assignment)}</dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd>{formatMappingRowsScope(state.assignment.rowBudget)}</dd>
        </div>
      </dl>
    )
  }

  if (state.status === 'loading') {
    return (
      <p className="cell-expression-status">
        Reading {formatMappingRowsScope(state.rowBudget)}
      </p>
    )
  }

  if (state.status === 'missing') {
    return (
      <p className="cell-expression-status">
        No cell assignment found in {formatMappingRowsScope(state.rowBudget)}
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <p className="cell-expression-status">
        {state.error.title}: {state.error.message}
      </p>
    )
  }

  if (state.status === 'unavailable') {
    return <p className="cell-expression-status">{state.reason}</p>
  }

  return <p className="cell-expression-status">No assignment loaded</p>
}

function formatMappingRowsScope(rowBudget: number | undefined): string {
  return rowBudget === undefined
    ? 'all available mapping rows'
    : `${rowBudget.toLocaleString()} mapping rows`
}

function formatImageCoordinate(cell: GridCellDatum): string {
  if (cell.fullresRow === undefined || cell.fullresCol === undefined) {
    return 'Unavailable'
  }

  return `row ${formatNumber(cell.fullresRow)}, col ${formatNumber(cell.fullresCol)}`
}

function formatTissueStatus(inTissue: boolean | undefined): string {
  if (inTissue === undefined) {
    return 'Unavailable'
  }

  return inTissue ? 'In tissue' : 'Out of tissue'
}

function formatMetric(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'Unavailable'
  }

  return `${formatNumber(value)} ${unit}`
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
  })
}
