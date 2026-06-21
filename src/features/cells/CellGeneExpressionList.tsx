import type { CSSProperties } from 'react'
import { useId, useMemo, useState } from 'react'
import {
  CELL_GENE_EXPRESSION_LIMIT,
  type CellGeneExpressionGene,
  type CellGeneExpressionSummary,
} from './cellDetailModel'

interface CellGeneExpressionListProps {
  readonly expression: CellGeneExpressionSummary
  readonly ariaLabel?: string | undefined
  readonly searchPlaceholder?: string | undefined
  readonly filterLabel?: string | undefined
  readonly hitLimitCopy?: string | undefined
}

export function CellGeneExpressionList({
  expression,
  ariaLabel = 'Cell gene expression',
  searchPlaceholder = 'Search expressed genes',
  filterLabel = 'Gene filter',
  hitLimitCopy = `Showing first ${CELL_GENE_EXPRESSION_LIMIT.toLocaleString()} genes`,
}: CellGeneExpressionListProps) {
  const geneSearchInputId = useId()
  const [geneSearch, setGeneSearch] = useState('')
  const filteredGenes = useMemo(
    () => filterCellExpressionGenes(expression.genes, geneSearch),
    [expression.genes, geneSearch],
  )
  const maxExpressionCount = expression.genes.reduce(
    (max, gene) => Math.max(max, gene.count),
    0,
  )

  return (
    <>
      <label className="cell-expression-filter" htmlFor={geneSearchInputId}>
        {filterLabel}
      </label>
      <input
        id={geneSearchInputId}
        className="cell-expression-search"
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={geneSearch}
        placeholder={searchPlaceholder}
        title={filterLabel}
        onChange={(event) => {
          setGeneSearch(event.currentTarget.value)
        }}
      />
      {expression.genes.length === 0 ? (
        <p className="cell-expression-status">No expressed genes found</p>
      ) : filteredGenes.length === 0 ? (
        <p className="cell-expression-status">No matching genes</p>
      ) : (
        <ol className="cell-expression-list" aria-label={ariaLabel}>
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
        <p className="cell-expression-status">{hitLimitCopy}</p>
      ) : null}
    </>
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

function formatPercent(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}
