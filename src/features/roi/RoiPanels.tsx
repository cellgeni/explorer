import type { CSSProperties } from 'react'
import {
  magicLensElementLabel,
  magicLensEmptyGeneMessage,
  magicLensPrimaryMetricLabel,
  magicLensScopeLabel,
  type MagicLensState,
} from './magicLensModel'
import type { RoiGeneStatsState } from './roiModel'

export function MagicLensPanel({ state }: { readonly state: MagicLensState }) {
  if (state.status === 'idle') {
    return null
  }

  if (state.status === 'loading') {
    return (
      <p className="magic-lens-status" aria-live="polite">
        Scanning {magicLensScopeLabel(state.scope).toLowerCase()}
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <p className="magic-lens-status" aria-live="polite">
        {state.error.title}
      </p>
    )
  }

  const maxCount = Math.max(
    ...state.summary.topGenes.map((geneSummary) => geneSummary.count),
    1,
  )

  return (
    <section className="magic-lens-results" aria-label="Magic lens results">
      <dl className="magic-lens-summary-list">
        <div>
          <dt>Scope</dt>
          <dd>{magicLensScopeLabel(state.scope)}</dd>
        </div>
        <div>
          <dt>{magicLensPrimaryMetricLabel(state.summary)}</dt>
          <dd>
            {state.summary.transcriptCount.toLocaleString()}
            {state.summary.hitLimit ? '+' : ''}
          </dd>
        </div>
        <div>
          <dt>{magicLensElementLabel(state.summary)}</dt>
          <dd>{state.summary.cellCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Genes</dt>
          <dd>{state.summary.geneCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd>{state.summary.selectedGeneTranscriptCount.toLocaleString()}</dd>
        </div>
      </dl>

      {state.summary.topGenes.length === 0 ? (
        <p className="magic-lens-status">{magicLensEmptyGeneMessage(state.summary)}</p>
      ) : (
        <section
          className="magic-lens-gene-panel"
          aria-label="Magic lens gene distribution"
        >
          <div className="magic-lens-gene-heading">
            <span>Top lens genes</span>
            <small>{state.summary.topGenes.length.toLocaleString()}</small>
          </div>
          <ol className="magic-lens-gene-list">
            {state.summary.topGenes.map((geneSummary) => (
              <li
                key={geneSummary.gene}
                className={geneSummary.selected ? 'is-selected' : undefined}
                style={
                  {
                    '--magic-lens-gene-width': `${Math.max(
                      4,
                      (geneSummary.count / maxCount) * 100,
                    )}%`,
                  } as CSSProperties
                }
              >
                <div className="magic-lens-gene-row">
                  <span>{geneSummary.gene}</span>
                  <strong>{geneSummary.count.toLocaleString()}</strong>
                </div>
                <div className="magic-lens-gene-bar" aria-hidden="true" />
                <small>{formatPercent(geneSummary.percentTotal)} total</small>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  )
}

export function RoiGeneStatsPanel({
  copy,
  state,
}: {
  readonly copy: string
  readonly state: RoiGeneStatsState
}) {
  if (state.status === 'idle') {
    return null
  }

  if (state.status === 'loading') {
    return (
      <p className="roi-gene-status" aria-live="polite">
        {copy}
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <p className="roi-gene-status" aria-live="polite">
        {copy}
      </p>
    )
  }

  if (state.stats.genes.length === 0) {
    return (
      <p className="roi-gene-status" aria-live="polite">
        No detected ROI gene expression
      </p>
    )
  }

  const maxCount = Math.max(...state.stats.genes.map((gene) => gene.count), 1)

  return (
    <section className="roi-gene-panel" aria-label="ROI gene distribution">
      <div className="roi-gene-heading">
        <span>Top ROI genes</span>
        <small>
          {state.stats.hitCellLimit
            ? `${state.stats.sampledCellCount.toLocaleString()} sampled`
            : `${state.stats.sampledCellCount.toLocaleString()} cells`}
        </small>
      </div>
      <ol className="roi-gene-list">
        {state.stats.genes.map((gene) => (
          <li
            key={gene.gene}
            style={
              {
                '--roi-gene-width': `${Math.max(4, (gene.count / maxCount) * 100)}%`,
              } as CSSProperties
            }
          >
            <div className="roi-gene-row">
              <span>{gene.gene}</span>
              <strong>{gene.count.toLocaleString()}</strong>
            </div>
            <div className="roi-gene-bar" aria-hidden="true" />
            <small>
              {formatPercent(gene.percentTotal)} total ·{' '}
              {formatPercent(gene.percentCells)} cells · {formatNumber(gene.meanPerCell)}
              /cell
            </small>
          </li>
        ))}
      </ol>
    </section>
  )
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? '0'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function formatPercent(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}
