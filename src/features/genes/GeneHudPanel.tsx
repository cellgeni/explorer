import {
  CellColorControls,
  ExpressionDetailControl,
  GeneExpressionControls,
  GenePicker,
} from '../sections/CellsSectionBlocks'
import type { CellsSectionModel } from '../sections/cellsSectionModel'

interface GeneHudPanelProps {
  readonly active: boolean
  readonly cells: CellsSectionModel
}

// The Genes tab: the Cells section's gene and colour blocks.
export function GeneHudPanel({ active, cells }: GeneHudPanelProps) {
  const { colour, genes } = cells

  return (
    <div
      id="hud-panel-genes"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-genes"
      hidden={!active}
    >
      <section className="analysis-section" aria-labelledby="analysis-heading">
        <div className="section-heading-row">
          <h2 id="analysis-heading">Analysis</h2>
          <span
            className={colour.isLoading ? 'status-chip is-loading' : 'status-chip'}
            aria-live="polite"
          >
            {colour.headerCopy}
          </span>
        </div>

        <GenePicker genes={genes} />
        <GeneExpressionControls colour={colour} />
        <ExpressionDetailControl colour={colour} />
        <CellColorControls colour={colour} />

        <p className="analysis-status" aria-live="polite">
          {colour.statusCopy}
        </p>
      </section>
    </div>
  )
}
