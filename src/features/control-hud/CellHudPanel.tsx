import { EmbeddingPanel } from '../analysis/EmbeddingPanel'
import { CellInfoPanel } from '../cells/CellInfoPanel'
import type { AnalysisEmbeddingState } from '../analysis/analysisEmbeddingModel'
import type {
  CellDetailState,
  CellTranscriptDistributionState,
} from '../cells/cellDetailModel'
import type {
  AnalysisEmbedding,
  AnalysisEmbeddingKind,
} from '../../data/analysisEmbeddings'
import type { OverviewCellDatum } from '../../rendering/deckLayers'

interface CellHudPanelProps {
  readonly active: boolean
  readonly embeddingViewInputId: string
  readonly embeddingCopy: string
  readonly analysisEmbeddingState: AnalysisEmbeddingState
  readonly activeEmbedding: AnalysisEmbedding | null
  readonly selectedEmbeddingKind: AnalysisEmbeddingKind
  readonly roiCellIds: readonly string[]
  readonly selectedCell: OverviewCellDatum | null
  readonly cellDetailCopy: string
  readonly cellDetailState: CellDetailState
  readonly cellTranscriptDistributionState: CellTranscriptDistributionState
  readonly loadEnabled: boolean
  readonly onEmbeddingKindChange: (kind: AnalysisEmbeddingKind) => void
  readonly onLoadAnalysisEmbeddings: () => void
  readonly onSelectEmbeddingCell: (cellId: string) => void
}

export function CellHudPanel({
  active,
  embeddingViewInputId,
  embeddingCopy,
  analysisEmbeddingState,
  activeEmbedding,
  selectedEmbeddingKind,
  roiCellIds,
  selectedCell,
  cellDetailCopy,
  cellDetailState,
  cellTranscriptDistributionState,
  loadEnabled,
  onEmbeddingKindChange,
  onLoadAnalysisEmbeddings,
  onSelectEmbeddingCell,
}: CellHudPanelProps) {
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
            onClick={onLoadAnalysisEmbeddings}
          >
            {analysisEmbeddingState.status === 'loading'
              ? 'Loading...'
              : 'Load Embeddings'}
          </button>
        </div>
        <EmbeddingPanel
          embedding={activeEmbedding}
          roiCellIds={roiCellIds}
          selectedCellId={selectedCell?.id ?? null}
          onSelectCell={onSelectEmbeddingCell}
        />
      </section>

      <section className="analysis-section" aria-labelledby="cell-info-heading">
        <div className="section-heading-row">
          <h2 id="cell-info-heading">Cell Info</h2>
          <span
            className={
              cellDetailState.status === 'loading'
                ? 'status-chip is-loading'
                : 'status-chip'
            }
            aria-live="polite"
          >
            {cellDetailCopy}
          </span>
        </div>
        <CellInfoPanel
          key={selectedCell?.id ?? 'none'}
          cell={selectedCell}
          state={cellDetailState}
          transcriptDistributionState={cellTranscriptDistributionState}
        />
      </section>
    </div>
  )
}
