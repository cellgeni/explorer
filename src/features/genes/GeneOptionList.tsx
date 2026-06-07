import { useMemo, useState } from 'react'

const GENE_OPTION_ROW_HEIGHT = 28
const GENE_OPTION_VISIBLE_ROWS = 7
const GENE_OPTION_OVERSCAN_ROWS = 4

interface GeneOptionListProps {
  readonly genes: readonly string[]
  readonly selectedGenes: readonly string[]
  readonly ariaLabel?: string
  readonly emptyMessage?: string
  readonly onToggleGene: (gene: string) => void
}

export function GeneOptionList({
  genes,
  selectedGenes,
  ariaLabel = 'Gene options',
  emptyMessage = 'No matching genes',
  onToggleGene,
}: GeneOptionListProps) {
  const geneListKey = `${genes.length}:${genes[0] ?? ''}:${genes[genes.length - 1] ?? ''}`
  const [scrollState, setScrollState] = useState({ key: '', scrollTop: 0 })
  const scrollTop = scrollState.key === geneListKey ? scrollState.scrollTop : 0
  const selectedGeneSet = useMemo(() => new Set(selectedGenes), [selectedGenes])

  if (genes.length === 0) {
    return (
      <div className="gene-option-list" aria-label={ariaLabel}>
        <span className="option-empty">{emptyMessage}</span>
      </div>
    )
  }

  const viewportHeight =
    Math.min(genes.length, GENE_OPTION_VISIBLE_ROWS) * GENE_OPTION_ROW_HEIGHT
  const totalHeight = genes.length * GENE_OPTION_ROW_HEIGHT
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight)
  const currentScrollTop = Math.min(scrollTop, maxScrollTop)
  const startIndex = Math.max(
    0,
    Math.floor(currentScrollTop / GENE_OPTION_ROW_HEIGHT) - GENE_OPTION_OVERSCAN_ROWS,
  )
  const endIndex = Math.min(
    genes.length,
    startIndex +
      GENE_OPTION_VISIBLE_ROWS +
      GENE_OPTION_OVERSCAN_ROWS +
      GENE_OPTION_OVERSCAN_ROWS,
  )
  const visibleGenes = genes.slice(startIndex, endIndex)

  return (
    <div
      className="gene-option-list is-virtualized"
      aria-label={ariaLabel}
      onScroll={(event) => {
        setScrollState({ key: geneListKey, scrollTop: event.currentTarget.scrollTop })
      }}
      style={{ height: `${viewportHeight}px` }}
    >
      <div className="gene-option-list-spacer" style={{ height: `${totalHeight}px` }}>
        {visibleGenes.map((gene, visibleIndex) => {
          const geneIndex = startIndex + visibleIndex

          return (
            <button
              key={gene}
              type="button"
              className={selectedGeneSet.has(gene) ? 'selected' : undefined}
              title={gene}
              aria-setsize={genes.length}
              aria-posinset={geneIndex + 1}
              onClick={() => {
                onToggleGene(gene)
              }}
              style={{ top: `${geneIndex * GENE_OPTION_ROW_HEIGHT}px` }}
            >
              {gene}
            </button>
          )
        })}
      </div>
    </div>
  )
}
