import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

// The row pitch at the default font size: 24 px buttons 4 px apart. The
// buttons grow with the font size and text spacing, and the pitch follows
// the first one drawn (EXP-308).
const GENE_OPTION_ROW_HEIGHT = 28
const GENE_OPTION_ROW_GAP = 4
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
  // `keyboard` when the pick came from Enter or Space.
  readonly onToggleGene: (gene: string, keyboard: boolean) => void
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
  const [rowHeight, setRowHeight] = useState(GENE_OPTION_ROW_HEIGHT)
  const measureRow = useCallback((button: HTMLButtonElement | null) => {
    if (button === null) return
    const measure = () => {
      const height = button.offsetHeight
      if (height > 0) setRowHeight(height + GENE_OPTION_ROW_GAP)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(button)
    return () => {
      observer.disconnect()
    }
  }, [])
  const selectedGeneSet = useMemo(() => new Set(selectedGenes), [selectedGenes])
  // Where a gene was picked, so focus can stay in the list when the gene
  // leaves it with its button (EXP-294).
  const pickedIndexRef = useRef<number | null>(null)

  // The rows drawn follow the list's own scroll position whenever the genes
  // change. Picking a gene takes it out of the list but leaves the list
  // scrolled, so rows drawn for the top would leave the box looking empty.
  useLayoutEffect(() => {
    const list = listRef.current

    const pickedIndex = pickedIndexRef.current
    pickedIndexRef.current = null

    if (scrollResetKeyRef.current !== scrollResetKey) {
      scrollResetKeyRef.current = scrollResetKey
      if (list !== null) list.scrollTop = 0
    } else if (
      pickedIndex !== null &&
      genes.length > 0 &&
      (document.activeElement === null || document.activeElement === document.body)
    ) {
      // The gene now in the picked one's place, which is drawn, as the list
      // has not scrolled.
      const index = Math.min(pickedIndex, genes.length - 1)
      list
        ?.querySelector<HTMLButtonElement>(`[aria-posinset="${index + 1}"] button`)
        ?.focus()
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

  const viewportHeight = Math.min(genes.length, GENE_OPTION_VISIBLE_ROWS) * rowHeight
  const totalHeight = genes.length * rowHeight
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight)
  const currentScrollTop = Math.min(scrollTop, maxScrollTop)
  const startIndex = Math.max(
    0,
    Math.floor(currentScrollTop / rowHeight) - GENE_OPTION_OVERSCAN_ROWS,
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
              style={{ top: `${geneIndex * rowHeight}px` }}
            >
              <button
                ref={visibleIndex === 0 ? measureRow : undefined}
                type="button"
                className={selectedGeneSet.has(gene) ? 'selected' : undefined}
                title={alias === undefined ? gene : `${gene} (${alias})`}
                onClick={(event) => {
                  pickedIndexRef.current = geneIndex
                  // A click from Enter or Space has no click count.
                  onToggleGene(gene, event.detail === 0)
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
