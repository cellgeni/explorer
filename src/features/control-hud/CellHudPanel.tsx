import { EmbeddingPanel } from '../analysis/EmbeddingPanel'
import { CellInfoPanel } from '../cells/CellInfoPanel'
import { GridCellInfoPanel } from '../cells/GridCellInfoPanel'
import {
  expressionStatusLabel,
  type CellGeneExpressionStatus,
} from '../cells/cellGeneExpressionStatus'
import type { AnalysisEmbeddingState } from '../analysis/analysisEmbeddingModel'
import type {
  CellDetailState,
  CellTranscriptDistributionState,
} from '../cells/cellDetailModel'
import type { GridCellAssignmentState } from '../cells/gridCellAssignmentModel'
import type {
  AnalysisEmbedding,
  AnalysisEmbeddingKind,
} from '../../data/analysisEmbeddings'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewCellDatum,
} from '../../rendering/deckLayers'
import type { AnnotationColorStyle } from '../../rendering/cellStyling'

interface CellHudPanelProps {
  readonly active: boolean
  readonly embeddingViewInputId: string
  readonly embeddingCopy: string
  readonly analysisEmbeddingState: AnalysisEmbeddingState
  readonly activeEmbedding: AnalysisEmbedding | null
  readonly annotationStyles: readonly AnnotationColorStyle[]
  readonly selectedEmbeddingKind: AnalysisEmbeddingKind
  readonly roiCellIds: readonly string[]
  readonly isVisiumHdDataset: boolean
  readonly selectedCell: OverviewCellDatum | null
  readonly selectedGridCell: GridCellDatum | null
  readonly selectedGridCellAssignmentState: GridCellAssignmentState
  readonly selectedGridCellExpressionStatus?: CellGeneExpressionStatus | undefined
  readonly selectedBoundaryCell: CellBoundaryDatum | null
  readonly selectedBoundaryCellExpressionStatus?: CellGeneExpressionStatus | undefined
  readonly selectedCellAnnotationLabels: readonly string[]
  readonly cellDetailCopy: string
  readonly cellDetailState: CellDetailState
  readonly cellTranscriptDistributionState: CellTranscriptDistributionState
  readonly loadEnabled: boolean
  readonly onEmbeddingKindChange: (kind: AnalysisEmbeddingKind) => void
  readonly onLoadAnalysisEmbeddings: () => void
  readonly onClearSelectedCell: () => void
  readonly onClearSelectedGridCell: () => void
  readonly onClearSelectedBoundaryCell: () => void
  readonly onSelectEmbeddingCell: (cellId: string) => void
}

export function CellHudPanel({
  active,
  embeddingViewInputId,
  embeddingCopy,
  analysisEmbeddingState,
  activeEmbedding,
  annotationStyles,
  selectedEmbeddingKind,
  roiCellIds,
  isVisiumHdDataset,
  selectedCell,
  selectedGridCell,
  selectedGridCellAssignmentState,
  selectedGridCellExpressionStatus,
  selectedBoundaryCell,
  selectedBoundaryCellExpressionStatus,
  selectedCellAnnotationLabels,
  cellDetailCopy,
  cellDetailState,
  cellTranscriptDistributionState,
  loadEnabled,
  onEmbeddingKindChange,
  onLoadAnalysisEmbeddings,
  onClearSelectedCell,
  onClearSelectedGridCell,
  onClearSelectedBoundaryCell,
  onSelectEmbeddingCell,
}: CellHudPanelProps) {
  const visiumSelectionKind =
    selectedBoundaryCell !== null ? 'cell' : selectedGridCell !== null ? 'bin' : null
  const detailHeading =
    isVisiumHdDataset && selectedBoundaryCell === null ? 'Bin Info' : 'Cell Info'
  const detailCopy = isVisiumHdDataset
    ? visiumSelectionKind === null
      ? 'No selection'
      : visiumSelectionKind === 'cell'
        ? 'Selected cell'
        : 'Selected bin'
    : cellDetailCopy
  const embeddingElementLabel = isVisiumHdDataset ? 'bins' : 'cells'
  const selectedEmbeddingElementId = isVisiumHdDataset
    ? (selectedGridCell?.id ?? null)
    : (selectedCell?.id ?? null)

  return (
    <div
      id="hud-panel-cell"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-cell"
      hidden={!active}
    >
      <section className="analysis-section" aria-labelledby="embedding-heading">
        <div className="section-heading-row">
          <h2 id="embedding-heading">UMAP/tSNE</h2>
          <span
            className={
              analysisEmbeddingState.status === 'loading'
                ? 'status-chip is-loading'
                : 'status-chip'
            }
            aria-live="polite"
          >
            {embeddingCopy}
          </span>
        </div>
        <div className="embedding-controls">
          <label htmlFor={embeddingViewInputId}>Embedding view</label>
          <select
            id={embeddingViewInputId}
            value={activeEmbedding?.kind ?? selectedEmbeddingKind}
            disabled={
              analysisEmbeddingState.status !== 'ready' ||
              analysisEmbeddingState.embeddings.length === 0
            }
            title="Embedding view"
            onChange={(event) => {
              onEmbeddingKindChange(event.currentTarget.value as AnalysisEmbeddingKind)
            }}
          >
            {analysisEmbeddingState.status === 'ready' &&
            analysisEmbeddingState.embeddings.length > 0 ? (
              analysisEmbeddingState.embeddings.map((embedding) => (
                <option key={embedding.kind} value={embedding.kind}>
                  {embedding.label}
                </option>
              ))
            ) : (
              <>
                <option value="umap">UMAP</option>
                <option value="tsne">t-SNE</option>
              </>
            )}
          </select>
          <button
            type="button"
            className="secondary-action"
            disabled={!loadEnabled || analysisEmbeddingState.status === 'loading'}
            title="Load analysis embeddings"
            onClick={onLoadAnalysisEmbeddings}
          >
            {analysisEmbeddingState.status === 'loading'
              ? 'Loading...'
              : 'Load Embeddings'}
          </button>
        </div>
        <EmbeddingPanel
          embedding={activeEmbedding}
          annotationStyles={annotationStyles}
          roiElementIds={roiCellIds}
          selectedElementId={selectedEmbeddingElementId}
          elementLabel={embeddingElementLabel}
          onSelectElement={onSelectEmbeddingCell}
        />
      </section>

      <section className="analysis-section" aria-labelledby="cell-info-heading">
        <div className="section-heading-row">
          <h2 id="cell-info-heading">{detailHeading}</h2>
          <div className="section-heading-actions">
            <span
              className={
                !isVisiumHdDataset && cellDetailState.status === 'loading'
                  ? 'status-chip is-loading'
                  : 'status-chip'
              }
              aria-live="polite"
            >
              {detailCopy}
            </span>
            {isVisiumHdDataset ? (
              selectedBoundaryCell !== null ? (
                <button
                  type="button"
                  className="secondary-action"
                  title="Clear selected cell"
                  onClick={onClearSelectedBoundaryCell}
                >
                  Clear Cell
                </button>
              ) : selectedGridCell === null ? null : (
                <button
                  type="button"
                  className="secondary-action"
                  title="Clear selected bin"
                  onClick={onClearSelectedGridCell}
                >
                  Clear Bin
                </button>
              )
            ) : selectedCell === null ? null : (
              <button
                type="button"
                className="secondary-action"
                title="Clear selected cell"
                onClick={onClearSelectedCell}
              >
                Clear Cell
              </button>
            )}
          </div>
        </div>
        {isVisiumHdDataset ? (
          selectedBoundaryCell !== null ? (
            <BoundaryCellInfoPanel
              key={selectedBoundaryCell.id}
              cell={selectedBoundaryCell}
              expressionStatus={selectedBoundaryCellExpressionStatus}
            />
          ) : (
            <GridCellInfoPanel
              key={selectedGridCell?.id ?? 'none'}
              cell={selectedGridCell}
              assignmentState={selectedGridCellAssignmentState}
              expressionStatus={selectedGridCellExpressionStatus}
            />
          )
        ) : (
          <CellInfoPanel
            key={selectedCell?.id ?? 'none'}
            cell={selectedCell}
            annotationLabels={selectedCellAnnotationLabels}
            state={cellDetailState}
            transcriptDistributionState={cellTranscriptDistributionState}
          />
        )}
      </section>
    </div>
  )
}

function BoundaryCellInfoPanel({
  cell,
  expressionStatus,
}: {
  readonly cell: CellBoundaryDatum
  readonly expressionStatus?: CellGeneExpressionStatus | undefined
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
          <dd>{formatBoundaryArea(cell)} um^2</dd>
        </div>
      </dl>

      <div className="cell-expression-panel">
        <div className="cell-expression-heading">
          <span>Gene expression</span>
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
    </div>
  )
}

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
