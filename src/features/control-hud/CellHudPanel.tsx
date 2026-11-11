import { EmbeddingPanel } from '../analysis/EmbeddingPanel'
import { BoundaryCellInfoPanel } from '../cells/BoundaryCellInfoPanel'
import { CellInfoPanel, type CellInfoPanelVariant } from '../cells/CellInfoPanel'
import { GridCellInfoPanel } from '../cells/GridCellInfoPanel'
import type { CellGeneExpressionStatus } from '../cells/cellGeneExpressionStatus'
import {
  analysisEmbeddingOptionsForState,
  type AnalysisEmbeddingState,
} from '../analysis/analysisEmbeddingModel'
import type {
  CellDetailState,
  CellTranscriptDistributionState,
} from '../cells/cellDetailModel'
import type { CellExpressionProfileState } from '../cells/cellExpressionProfileModel'
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
  readonly selectedExpressionProfileState?: CellExpressionProfileState | undefined
  readonly selectedCellAnnotationLabels: readonly string[]
  readonly selectedCellInfoVariant?: CellInfoPanelVariant
  readonly cellDetailCopy: string
  readonly cellDetailState: CellDetailState
  readonly cellTranscriptDistributionState: CellTranscriptDistributionState
  readonly cellTranscriptDistributionVisible?: boolean
  readonly loadEnabled: boolean
  readonly onEmbeddingKindChange: (kind: AnalysisEmbeddingKind) => void
  readonly onLoadAnalysisEmbeddings: () => void
  readonly onClearSelectedCell: () => void
  readonly onClearSelectedGridCell: () => void
  readonly onClearSelectedBoundaryCell: () => void
  readonly onSelectEmbeddingCell: (cellId: string) => void
  readonly onLoadSelectedExpressionProfile?: (() => void) | undefined
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
  selectedExpressionProfileState,
  selectedCellAnnotationLabels,
  selectedCellInfoVariant = 'default',
  cellDetailCopy,
  cellDetailState,
  cellTranscriptDistributionState,
  cellTranscriptDistributionVisible = true,
  loadEnabled,
  onEmbeddingKindChange,
  onLoadAnalysisEmbeddings,
  onClearSelectedCell,
  onClearSelectedGridCell,
  onClearSelectedBoundaryCell,
  onSelectEmbeddingCell,
  onLoadSelectedExpressionProfile,
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
  const embeddingOptions = analysisEmbeddingOptionsForState(analysisEmbeddingState)
  const selectedEmbeddingValue = activeEmbedding?.kind ?? selectedEmbeddingKind

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
          <h2 id="embedding-heading">Embeddings</h2>
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
            value={selectedEmbeddingValue}
            disabled={embeddingOptions.length === 0}
            title="Embedding view"
            onChange={(event) => {
              onEmbeddingKindChange(event.currentTarget.value as AnalysisEmbeddingKind)
            }}
          >
            {embeddingOptions.length > 0 ? (
              embeddingOptions.map((embeddingOption) => (
                <option key={embeddingOption.kind} value={embeddingOption.kind}>
                  {embeddingOption.label}
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
            title="Load embeddings"
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
              expressionProfileState={selectedExpressionProfileState}
              onLoadExpressionProfile={onLoadSelectedExpressionProfile}
            />
          ) : (
            <GridCellInfoPanel
              key={selectedGridCell?.id ?? 'none'}
              cell={selectedGridCell}
              assignmentState={selectedGridCellAssignmentState}
              expressionStatus={selectedGridCellExpressionStatus}
              expressionProfileState={selectedExpressionProfileState}
              onLoadExpressionProfile={onLoadSelectedExpressionProfile}
            />
          )
        ) : (
          <CellInfoPanel
            key={selectedCell?.id ?? 'none'}
            cell={selectedCell}
            annotationLabels={selectedCellAnnotationLabels}
            state={cellDetailState}
            transcriptDistributionState={cellTranscriptDistributionState}
            transcriptDistributionVisible={cellTranscriptDistributionVisible}
            variant={selectedCellInfoVariant}
          />
        )}
      </section>
    </div>
  )
}
