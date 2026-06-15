import type { GridCellDatum } from '../../rendering/deckLayers'

interface GridCellInfoPanelProps {
  readonly cell: GridCellDatum | null
}

export function GridCellInfoPanel({ cell }: GridCellInfoPanelProps) {
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
          <span>Gene expression</span>
          <small>{hasExpression ? 'Loaded' : 'Unavailable'}</small>
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
          <p className="cell-expression-status">No expression loaded</p>
        )}
      </div>
    </div>
  )
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
