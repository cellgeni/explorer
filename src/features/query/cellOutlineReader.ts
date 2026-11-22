import type { CellOutlineRequest, SpatialElement } from '../../datasets/spatialDataset'
import { cellPictureOutline, type CellPictureOutline } from './cellPictureModel'

// The outlines of the cells a page of pictures shows (plan 23-H), read a
// page at a time and kept for the dataset. A page that scrolls away stops
// before its next batch.
export class CellOutlineReader {
  private readonly outlines = new Map<string, CellPictureOutline | null>()

  constructor(
    private readonly load: (
      cells: readonly CellOutlineRequest[],
      signal: AbortSignal,
    ) => Promise<ReadonlyMap<string, SpatialElement>>,
    // Cells read in one call.
    private readonly batchSize = 12,
  ) {}

  // Tells each cell's outline, or null for none, as its batch arrives, and
  // gives the number of cells read rather than known.
  async read(
    cells: readonly CellOutlineRequest[],
    signal: AbortSignal,
    onOutline: (cellId: string, outline: CellPictureOutline | null) => void,
  ): Promise<number> {
    const wanted: CellOutlineRequest[] = []

    for (const cell of cells) {
      const known = this.outlines.get(cell.id)
      if (known === undefined) wanted.push(cell)
      else onOutline(cell.id, known)
    }

    for (let start = 0; start < wanted.length; start += this.batchSize) {
      if (signal.aborted) return start
      const batch = wanted.slice(start, start + this.batchSize)
      const elements = await this.load(batch, signal)

      // Kept even for a page that has scrolled away: they were read. A
      // read stopped part-way returns what it found, so a cell missing from
      // it is not known to have no outline, and is read again later.
      for (const cell of batch) {
        const element = elements.get(cell.id)
        if (element === undefined && signal.aborted) continue
        const outline = element === undefined ? null : cellPictureOutline(element)
        this.outlines.set(cell.id, outline)
        if (!signal.aborted) onOutline(cell.id, outline)
      }
      if (signal.aborted) return start + batch.length
    }
    return wanted.length
  }
}
