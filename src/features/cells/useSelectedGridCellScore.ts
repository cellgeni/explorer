import { useMemo, useState } from 'react'
import type { BBox } from '../../data/coords'
import { gridCellOverlapsBbox, unscoredGridCell } from '../../rendering/deckLayers'
import type { GridCellDatum } from '../../rendering/deckLayerTypes'

interface SelectedGridCellScoreOptions {
  // The bin the user selected, as clicked.
  readonly selected: GridCellDatum | null
  // That bin scored by the latest expression batch.
  readonly scored: GridCellDatum | null
  // The box the latest batch was read for, when it was read for a view.
  readonly readBox: BBox | undefined
  readonly selectedGenes: readonly string[]
}

interface SelectedGridCellScore {
  readonly cell: GridCellDatum | null
  // The latest batch was read for an area that leaves the bin out.
  readonly outsideRead: boolean
}

// The selected Visium HD bin for the Bin card. A batch read for a view away
// from the bin (a pan at close zoom) has no score for it, so the bin keeps the
// score of the last batch read over it, for the same genes, or has none,
// rather than the 0 the latest batch would give it.
export function useSelectedGridCellScore({
  selected,
  scored,
  readBox,
  selectedGenes,
}: SelectedGridCellScoreOptions): SelectedGridCellScore {
  const outsideRead =
    selected !== null && readBox !== undefined && !gridCellOverlapsBbox(selected, readBox)
  const [lastRead, setLastRead] = useState<GridCellDatum | null>(null)

  // A bin the batch does not list is styled with a 0 and no genes: its score
  // is for the selected genes. Stored with them, the same score compares
  // equal on the next render, which this update during render relies on.
  if (
    !outsideRead &&
    scored?.expressionCount !== undefined &&
    !sameScore(lastRead, scored, selectedGenes)
  ) {
    setLastRead({ ...scored, expressionGenes: scored.expressionGenes ?? selectedGenes })
  }

  const cell = useMemo(() => {
    if (selected === null || !outsideRead) {
      return scored
    }

    return lastRead?.id === selected.id &&
      sameGeneList(lastRead.expressionGenes, selectedGenes)
      ? lastRead
      : unscoredGridCell(selected)
  }, [lastRead, outsideRead, scored, selected, selectedGenes])

  return { cell, outsideRead }
}

function sameScore(
  last: GridCellDatum | null,
  next: GridCellDatum,
  selectedGenes: readonly string[],
): boolean {
  return (
    last !== null &&
    last.id === next.id &&
    last.expressionCount === next.expressionCount &&
    sameGeneList(last.expressionGenes, next.expressionGenes ?? selectedGenes)
  )
}

function sameGeneList(
  genes: readonly string[] | undefined,
  selectedGenes: readonly string[],
): boolean {
  return (
    genes !== undefined &&
    genes.length === selectedGenes.length &&
    genes.every((gene, index) => gene === selectedGenes[index])
  )
}
