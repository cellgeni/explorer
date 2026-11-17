import { useLayoutEffect, useMemo, useRef, useState } from 'react'

const GENE_OPTION_ROW_HEIGHT = 28
const GENE_OPTION_VISIBLE_ROWS = 7
const GENE_OPTION_OVERSCAN_ROWS = 4

interface GeneOptionListProps {
  readonly genes: readonly string[]
  readonly selectedGenes: readonly string[]
  readonly aliases?: ReadonlyMap<string, string> | undefined
  readonly ariaLabel?: string
  readonly emptyMessage?: string
  // A change, such as a new search, scrolls the list back to the top.
  readonly scrollResetKey?: string
  readonly onToggleGene: (gene: string) => void
}

export function GeneOptionList({
  genes,
  selectedGenes,
  aliases,
  ariaLabel = 'Gene options',
  emptyMessage = 'No matching genes',
  scrollResetKey = '',
  onToggleGene,
}: GeneOptionListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const scrollResetKeyRef = useRef(scrollResetKey)
  const [scrollTop, setScrollTop] = useState(0)
  const selectedGeneSet = useMemo(() => new Set(selectedGenes), [selectedGenes])

  // The rows drawn follow the list's own scroll position whenever the genes
  // change. Picking a gene takes it out of the list but leaves the list
  // scrolled, so rows drawn for the top would leave the box looking empty.
  useLayoutEffect(() => {
    const list = listRef.current

    if (scrollResetKeyRef.current !== scrollResetKey) {
      scrollResetKeyRef.current = scrollResetKey
      if (list !== null) list.scrollTop = 0
    }

    setScrollTop(list?.scrollTop ?? 0)
  }, [genes, scrollResetKey])

  if (genes.length === 0) {
    return (
      <div className="gene-option-list">
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
    // A list, so each option says where it is among all the genes, as
    // only some rows are rendered (15.5-D: a button cannot carry that).
    <div
      ref={listRef}
      className="gene-option-list is-virtualized"
      role="list"
      aria-label={ariaLabel}
      onScroll={(event) => {
        setScrollTop(event.currentTarget.scrollTop)
      }}
      style={{ height: `${viewportHeight}px` }}
    >
      <div className="gene-option-list-spacer" style={{ height: `${totalHeight}px` }}>
        {visibleGenes.map((gene, visibleIndex) => {
          const geneIndex = startIndex + visibleIndex
          const alias = aliases?.get(gene)

          return (
            <div
              key={gene}
              role="listitem"
              className="gene-option-item"
              aria-setsize={genes.length}
              aria-posinset={geneIndex + 1}
              style={{ top: `${geneIndex * GENE_OPTION_ROW_HEIGHT}px` }}
            >
              <button
                type="button"
                className={selectedGeneSet.has(gene) ? 'selected' : undefined}
                title={alias === undefined ? gene : `${gene} (${alias})`}
                onClick={() => {
                  onToggleGene(gene)
                }}
              >
                {gene}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
