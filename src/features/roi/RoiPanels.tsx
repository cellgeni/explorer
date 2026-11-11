import { useMemo, useState, type CSSProperties } from 'react'
import { Segmented, Select } from '../../components/ui'
import {
  magicLensElementLabel,
  magicLensEmptyGeneMessage,
  magicLensPrimaryMetricLabel,
  magicLensScopeLabel,
  type MagicLensState,
} from './magicLensModel'
import type { RoiGeneStatsState } from './roiModel'
import {
  DEFAULT_MIN_PERCENT_INSIDE,
  IDLE_ROI_REFERENCE_STATE,
  MIN_PERCENT_OPTIONS,
  formatLog2FoldChange,
  rankRoiGenes,
  type RankedRoiGene,
  type RoiGeneSort,
  type RoiReferenceState,
} from './roiEnrichmentModel'

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

// The Genes tab (15.4-B): genes in the selection, ranked by fold change over
// the reference outside it (Enriched) or by count (Most abundant), with the
// share of cells expressing each inside and outside. A gene's name colours
// the cells by it.
export function RoiGeneStatsPanel({
  copy,
  elementPlural = 'cells',
  elementSingular = 'cell',
  state,
  title = 'Top ROI genes',
  reference = IDLE_ROI_REFERENCE_STATE,
  selectedGenes = NO_GENES,
  onShowGene,
}: {
  readonly copy: string
  readonly elementPlural?: string
  readonly elementSingular?: string
  readonly state: RoiGeneStatsState
  readonly title?: string
  readonly reference?: RoiReferenceState
  readonly selectedGenes?: readonly string[]
  readonly onShowGene?: ((gene: string) => void) | undefined
}) {
  const [sort, setSort] = useState<RoiGeneSort>('enriched')
  const [minPercent, setMinPercent] = useState<number>(DEFAULT_MIN_PERCENT_INSIDE)
  const outside = reference.status === 'ready' ? reference.stats : null
  const ranked = useMemo(
    () =>
      state.status === 'ready'
        ? rankRoiGenes(state.stats, outside, { sort, minPercentInside: minPercent })
        : [],
    [minPercent, outside, sort, state],
  )

  if (state.status === 'idle') {
    return null
  }

  if (state.status === 'loading' || state.status === 'error') {
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

  // Enriched needs the reference; until then the order is by count.
  const byFoldChange = sort === 'enriched' && outside !== null
  const maxValue = Math.max(
    ...ranked.map((gene) =>
      byFoldChange ? Math.max(gene.log2FoldChange ?? 0, 0) : gene.count,
    ),
    byFoldChange ? 0.1 : 1,
  )
  const sampled = state.stats.sampledCellCount

  return (
    <section className="roi-gene-panel" aria-label="ROI gene distribution">
      <div className="roi-gene-heading">
        <span>{title}</span>
        <small>
          {state.stats.hitCellLimit
            ? `${sampled.toLocaleString()} sampled`
            : `${sampled.toLocaleString()} ${sampled === 1 ? elementSingular : elementPlural}`}
        </small>
      </div>
      <div className="roi-gene-controls">
        <Segmented
          title="Sort the genes"
          label="Sort genes"
          value={sort}
          options={[
            {
              value: 'enriched',
              label: 'Enriched',
              title: `Rank by log2 fold change over ${elementPlural} outside the selection`,
            },
            {
              value: 'abundant',
              label: 'Most abundant',
              title: 'Rank by count in the selection',
            },
          ]}
          onChange={setSort}
        />
        <Select
          title={`Leave out genes expressed in fewer of the ${elementPlural} inside`}
          label={`Min % of ${elementPlural}`}
          value={String(minPercent)}
          options={MIN_PERCENT_OPTIONS.map((percent) => ({
            value: String(percent),
            label: percent === 0 ? 'Any' : `${percent}%`,
          }))}
          onChange={(value) => {
            setMinPercent(Number(value))
          }}
          className="roi-gene-min-percent"
        />
      </div>
      <p className="roi-gene-reference" aria-live="polite">
        {referenceCopy(reference, elementSingular, elementPlural)}
      </p>
      {ranked.length === 0 ? (
        <p className="roi-gene-status">
          No gene is expressed in {minPercent}% of the {elementPlural} inside
        </p>
      ) : (
        <ol className="roi-gene-list">
          {ranked.map((gene) => {
            const value = byFoldChange
              ? Math.max(gene.log2FoldChange ?? 0, 0)
              : gene.count
            const label = byFoldChange
              ? formatLog2FoldChange(gene.log2FoldChange ?? 0)
              : gene.count.toLocaleString()
            const row = (
              <>
                <span>{gene.gene}</span>
                <strong
                  title={byFoldChange ? 'log2 fold change' : `Count in the selection`}
                >
                  {label}
                </strong>
              </>
            )

            return (
              <li
                key={gene.gene}
                style={
                  {
                    '--roi-gene-width': `${Math.max(4, (value / maxValue) * 100)}%`,
                  } as CSSProperties
                }
              >
                {onShowGene === undefined ? (
                  <div className="roi-gene-row">{row}</div>
                ) : (
                  <button
                    type="button"
                    className="roi-gene-row roi-gene-row-button"
                    title={`Colour ${elementPlural} by ${gene.gene}`}
                    aria-pressed={selectedGenes.includes(gene.gene)}
                    onClick={() => {
                      onShowGene(gene.gene)
                    }}
                  >
                    {row}
                  </button>
                )}
                <div className="roi-gene-bar" aria-hidden="true" />
                <small>{geneDetail(gene, byFoldChange, elementSingular)}</small>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

const NO_GENES: readonly string[] = []

function referenceCopy(
  reference: RoiReferenceState,
  elementSingular: string,
  elementPlural: string,
): string {
  const count = (value: number) =>
    `${value.toLocaleString()} ${value === 1 ? elementSingular : elementPlural}`

  switch (reference.status) {
    case 'idle':
      return 'No comparison yet'
    case 'loading':
      return `Comparing with ${count(reference.cellCount)} outside…`
    case 'ready':
      return `Compared with ${count(reference.stats.sampledCellCount)} outside`
    case 'unavailable':
      return `No comparison: no sampled ${elementPlural} outside this selection`
    case 'error':
      return `No comparison: ${reference.error.title}`
  }
}

function geneDetail(
  gene: RankedRoiGene,
  byFoldChange: boolean,
  elementSingular: string,
): string {
  const parts = [
    ...(byFoldChange ? [] : [`${formatPercent(gene.percentTotal)} total`]),
    `${formatPercent(gene.percentInside)} in`,
    ...(gene.percentOutside === null
      ? []
      : [`${formatPercent(gene.percentOutside)} out`]),
    `${formatNumber(gene.meanInside)}/${elementSingular}`,
  ]

  return parts.join(' · ')
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? '0'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function formatPercent(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}
