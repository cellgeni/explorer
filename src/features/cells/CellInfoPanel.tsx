import type { CSSProperties } from 'react'
import { useId, useMemo, useState } from 'react'
import {
  CELL_TRANSCRIPT_DISTRIBUTION_LIMIT,
  type CellTranscriptZBin,
  type CellTranscriptZDistribution,
} from '../../data/cellTranscripts'
import type { OverviewCellDatum } from '../../rendering/deckLayers'
import {
  CELL_GENE_EXPRESSION_LIMIT,
  type CellDetailState,
  type CellLoadErrorSummary,
  summarizeCellShape,
  type CellTranscriptDistributionState,
  type CellGeneExpressionGene,
} from './cellDetailModel'

interface CellInfoPanelProps {
  readonly cell: OverviewCellDatum | null
  readonly state: CellDetailState
  readonly transcriptDistributionState: CellTranscriptDistributionState
}

export function CellInfoPanel({
  cell,
  state,
  transcriptDistributionState,
}: CellInfoPanelProps) {
  const geneSearchInputId = useId()
  const [geneSearch, setGeneSearch] = useState('')
  const readyState =
    cell !== null && state.status === 'ready' && state.cellId === cell.id ? state : null
  const loadingState =
    cell !== null && state.status === 'loading' && state.cellId === cell.id ? state : null
  const errorState =
    cell !== null && state.status === 'error' && state.cellId === cell.id ? state : null
  const shape =
    readyState === null || cell === null
      ? cell === null
        ? null
        : summarizeCellShape(cell, null)
      : readyState.shape
  const expression = readyState?.expression ?? null
  const filteredGenes = useMemo(
    () =>
      expression === null ? [] : filterCellExpressionGenes(expression.genes, geneSearch),
    [expression, geneSearch],
  )
  const maxExpressionCount =
    expression?.genes.reduce((max, gene) => Math.max(max, gene.count), 0) ?? 0

  if (cell === null) {
    return <p className="cell-info-empty">No cell selected</p>
  }

  return (
    <div className="cell-detail-panel">
      <dl className="cell-info-list">
        <div>
          <dt>ID</dt>
          <dd>{cell.id}</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>
            {formatNumber(cell.position[0])}, {formatNumber(-(cell.position[1] ?? 0))}
          </dd>
        </div>
        <div>
          <dt>Transcripts</dt>
          <dd>{formatOptionalNumber(cell.transcriptCount)}</dd>
        </div>
        <div>
          <dt>Nuclei</dt>
          <dd>{formatOptionalNumber(cell.nucleusCount)}</dd>
        </div>
        <div>
          <dt>Segmentation</dt>
          <dd>{formatOptionalText(cell.segmentationMethod)}</dd>
        </div>
        <div>
          <dt>Cell Area</dt>
          <dd>{formatMetric(shape?.areaMicrometersSquared, 'um2')}</dd>
        </div>
        <div>
          <dt>Diameter</dt>
          <dd>{formatMetric(shape?.equivalentDiameterMicrometers, 'um')}</dd>
        </div>
        <div>
          <dt>Eccentricity</dt>
          <dd>{formatMetric(shape?.eccentricity)}</dd>
        </div>
        <div>
          <dt>Major Axis</dt>
          <dd>{formatMetric(shape?.majorAxisMicrometers, 'um')}</dd>
        </div>
        <div>
          <dt>Minor Axis</dt>
          <dd>{formatMetric(shape?.minorAxisMicrometers, 'um')}</dd>
        </div>
        <div>
          <dt>Perimeter</dt>
          <dd>{formatMetric(shape?.perimeterMicrometers, 'um')}</dd>
        </div>
        <div>
          <dt>Circularity</dt>
          <dd>{formatMetric(shape?.circularity)}</dd>
        </div>
      </dl>

      <CellTranscriptZDistributionPanel cell={cell} state={transcriptDistributionState} />

      <div className="cell-expression-panel">
        <div className="cell-expression-heading">
          <span>Gene expression</span>
          <small>
            {expression === null
              ? loadingState === null
                ? 'Waiting'
                : 'Loading'
              : `${expression.totalCount.toLocaleString()} counts`}
          </small>
        </div>

        {loadingState === null ? null : (
          <p className="cell-expression-status" aria-live="polite">
            Loading full cell expression
          </p>
        )}

        {errorState === null ? null : (
          <p className="cell-expression-status is-error" aria-live="polite">
            {formatLoadError(errorState.error)}
          </p>
        )}

        {expression === null ? null : (
          <>
            <label className="cell-expression-filter" htmlFor={geneSearchInputId}>
              Gene filter
            </label>
            <input
              id={geneSearchInputId}
              className="cell-expression-search"
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={geneSearch}
              placeholder="Search expressed genes"
              onChange={(event) => {
                setGeneSearch(event.currentTarget.value)
              }}
            />
            {expression.genes.length === 0 ? (
              <p className="cell-expression-status">No expressed genes found</p>
            ) : filteredGenes.length === 0 ? (
              <p className="cell-expression-status">No matching genes</p>
            ) : (
              <ol className="cell-expression-list" aria-label="Cell gene expression">
                {filteredGenes.map((gene) => (
                  <li
                    key={gene.gene}
                    style={
                      {
                        '--cell-gene-width': `${expressionBarWidth(
                          gene.count,
                          maxExpressionCount,
                        )}%`,
                      } as CSSProperties
                    }
                  >
                    <div className="cell-expression-row">
                      <span>{gene.gene}</span>
                      <strong>{gene.count.toLocaleString()}</strong>
                    </div>
                    <div className="cell-expression-bar" aria-hidden="true" />
                    <small>{formatPercent(gene.percentTotal)} total</small>
                  </li>
                ))}
              </ol>
            )}
            {expression.hitGeneLimit ? (
              <p className="cell-expression-status">
                Showing first {CELL_GENE_EXPRESSION_LIMIT.toLocaleString()} genes
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function CellTranscriptZDistributionPanel({
  cell,
  state,
}: {
  readonly cell: OverviewCellDatum
  readonly state: CellTranscriptDistributionState
}) {
  const matchingState = state.status !== 'idle' && state.cellId === cell.id ? state : null
  const readyState =
    matchingState !== null && matchingState.status === 'ready' ? matchingState : null
  const loadingState =
    matchingState !== null && matchingState.status === 'loading' ? matchingState : null
  const errorState =
    matchingState !== null && matchingState.status === 'error' ? matchingState : null
  const distribution = readyState?.distribution ?? null
  const chartLabel =
    distribution === null ? undefined : cellTranscriptZDistributionAriaLabel(distribution)
  const statusCopy =
    distribution === null
      ? loadingState === null
        ? errorState === null
          ? 'Waiting'
          : 'Unavailable'
        : 'Loading'
      : `${distribution.zCount.toLocaleString()} z records`

  return (
    <div className="cell-z-panel" aria-label="Cell transcript z-axis distribution">
      <div className="cell-expression-heading">
        <span>Z-axis transcripts</span>
        <small>{statusCopy}</small>
      </div>

      {loadingState === null ? null : (
        <p className="cell-expression-status" aria-live="polite">
          Loading transcript z locations…
        </p>
      )}

      {errorState === null ? null : (
        <p className="cell-expression-status is-error" aria-live="polite">
          {formatLoadError(errorState.error)}
        </p>
      )}

      {distribution === null ? null : distribution.bins.length === 0 ? (
        <p className="cell-expression-status">
          No transcript z locations found at QV {formatNumber(distribution.minQv)} or
          higher
        </p>
      ) : (
        <>
          <div
            className="cell-z-bars"
            role="img"
            aria-label={chartLabel}
            style={
              {
                '--cell-z-bin-count': String(distribution.bins.length),
              } as CSSProperties
            }
          >
            {distribution.bins.map((bin) => (
              <span
                className="cell-z-bar"
                key={`${bin.minZ}:${bin.maxZ}`}
                title={`${formatZRange(bin)}: ${bin.count.toLocaleString()} transcripts`}
                style={
                  {
                    '--cell-z-height': `${cellTranscriptZBarHeight(
                      bin,
                      distribution.maxBinCount,
                    )}%`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="cell-z-axis" aria-hidden="true">
            <span>{formatZValue(distribution.minZ)}</span>
            <span>Z location (um)</span>
            <span>{formatZValue(distribution.maxZ)}</span>
          </div>
          <p className="cell-z-caption">
            {distribution.transcriptCount.toLocaleString()} transcript rows · QV{' '}
            {formatNumber(distribution.minQv)}+
            {distribution.missingZCount === 0
              ? ''
              : ` · ${distribution.missingZCount.toLocaleString()} without z`}
            {distribution.hitTranscriptLimit
              ? ` · limited to ${CELL_TRANSCRIPT_DISTRIBUTION_LIMIT.toLocaleString()}`
              : ''}
          </p>
        </>
      )}
    </div>
  )
}

function filterCellExpressionGenes(
  genes: readonly CellGeneExpressionGene[],
  search: string,
): readonly CellGeneExpressionGene[] {
  const normalizedSearch = search.trim().toLowerCase()

  if (normalizedSearch.length === 0) {
    return genes
  }

  return genes.filter((gene) => gene.gene.toLowerCase().includes(normalizedSearch))
}

function expressionBarWidth(count: number, maxCount: number): number {
  if (maxCount <= 0) {
    return 0
  }

  return Math.max(2, Math.min(100, (count / maxCount) * 100))
}

function cellTranscriptZBarHeight(bin: CellTranscriptZBin, maxBinCount: number): number {
  if (maxBinCount <= 0 || bin.count <= 0) {
    return 0
  }

  return Math.max(8, (bin.count / maxBinCount) * 100)
}

function cellTranscriptZDistributionAriaLabel(
  distribution: CellTranscriptZDistribution,
): string {
  const zRange =
    distribution.minZ === undefined || distribution.maxZ === undefined
      ? 'unknown z range'
      : `${formatZValue(distribution.minZ)} to ${formatZValue(distribution.maxZ)} um`

  return `${distribution.zCount.toLocaleString()} transcript z locations across ${distribution.bins.length.toLocaleString()} bins from ${zRange}.`
}

function formatZRange(bin: CellTranscriptZBin): string {
  if (bin.minZ === bin.maxZ) {
    return `${formatZValue(bin.minZ)} um`
  }

  return `${formatZValue(bin.minZ)}-${formatZValue(bin.maxZ)} um`
}

function formatZValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'Unknown'
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: value < 1 ? 2 : 1,
  })
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? 'None' : formatNumber(value)
}

function formatOptionalText(value: string | undefined): string {
  const normalized = value?.trim()

  return normalized === undefined || normalized.length === 0 ? 'None' : normalized
}

function formatNumber(value: number | undefined): string {
  return value === undefined
    ? '0'
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function formatPercent(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function formatMetric(value: number | undefined, unit?: string): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'Unavailable'
  }

  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: value < 1 ? 3 : 1,
  })

  return unit === undefined ? formatted : `${formatted} ${unit}`
}

function formatLoadError(error: CellLoadErrorSummary): string {
  return `${error.title}: ${error.message}`
}
