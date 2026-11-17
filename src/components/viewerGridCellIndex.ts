import { VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN } from '../data/visiumHdGridLod'
import { deriveNestedGridBasis } from '../datasets/spatialGrid'
import type { GridCellDatum } from '../rendering/deckLayers'
import { GridCellColumns } from '../rendering/gridCellColumns'

const VISIUM_HD_2UM_BIN_MICROMETERS = 2
const VISIUM_HD_RENDER_LOD_BIN_MICROMETERS = 16
// Coarse slots are counted in a dense array up to this many per source bin,
// and in a map beyond (bins scattered over a huge grid).
const DENSE_COARSE_SLOTS_PER_BIN = 4

export const GRID_CELL_2UM_EXACT_RENDER_ZOOM_MIN = VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN

export interface GridCellRenderLods {
  readonly exact: GridCellColumns
  readonly coarse16um: GridCellColumns | null
  readonly exactBinSizeMicrometers: number | null
}

export function createGridCellRenderLods(columns: GridCellColumns): GridCellRenderLods {
  const binSizeMicrometers = columns.binSizeMicrometers
  const exactBinSizeMicrometers =
    binSizeMicrometers !== undefined &&
    Number.isFinite(binSizeMicrometers) &&
    binSizeMicrometers > 0 &&
    columns.length > 0
      ? binSizeMicrometers
      : null

  return {
    exact: columns,
    coarse16um:
      exactBinSizeMicrometers === VISIUM_HD_2UM_BIN_MICROMETERS
        ? coarsenGridCellColumns(columns, VISIUM_HD_RENDER_LOD_BIN_MICROMETERS)
        : null,
    exactBinSizeMicrometers,
  }
}

export function selectGridCellsForRenderLod(
  lods: GridCellRenderLods,
  zoom: number,
): GridCellColumns {
  if (
    lods.exactBinSizeMicrometers === VISIUM_HD_2UM_BIN_MICROMETERS &&
    zoom < GRID_CELL_2UM_EXACT_RENDER_ZOOM_MIN &&
    lods.coarse16um !== null &&
    lods.coarse16um.length > 0
  ) {
    return lods.coarse16um
  }

  return lods.exact
}

export function isRenderLodGridCell(cell: GridCellDatum): boolean {
  return cell.renderLodSourceBinSizeMicrometers !== undefined
}

// The squares of a coarser nested grid that hold at least one bin, in row then
// column order: what zoomed-out 2 µm bins are drawn as. They have no
// expression or annotation of their own (their IDs match no element), so they
// take a gene's colour by where their centre falls.
export function coarsenGridCellColumns(
  columns: GridCellColumns,
  binSizeMicrometers: number,
): GridCellColumns {
  const sourceBinSizeMicrometers =
    columns.binSizeMicrometers ?? VISIUM_HD_2UM_BIN_MICROMETERS
  const factor = Math.round(binSizeMicrometers / sourceBinSizeMicrometers)
  const { length, rows, cols } = columns
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minCol = Number.POSITIVE_INFINITY
  let maxCol = Number.NEGATIVE_INFINITY

  for (let index = 0; index < length; index += 1) {
    const row = Math.floor((rows[index] ?? 0) / factor)
    const col = Math.floor((cols[index] ?? 0) / factor)
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
    if (col < minCol) minCol = col
    if (col > maxCol) maxCol = col
  }

  const rowSpan = length === 0 ? 0 : maxRow - minRow + 1
  const colSpan = length === 0 ? 0 : maxCol - minCol + 1
  const slotOf = (index: number) =>
    (Math.floor((rows[index] ?? 0) / factor) - minRow) * colSpan +
    (Math.floor((cols[index] ?? 0) / factor) - minCol)
  // In-tissue state of each occupied slot: 1 when any of its bins is in
  // tissue, otherwise 0.
  const occupied =
    rowSpan * colSpan <= DENSE_COARSE_SLOTS_PER_BIN * length + 65_536
      ? denseOccupiedSlots(columns, rowSpan * colSpan, slotOf)
      : sparseOccupiedSlots(columns, slotOf)
  const count = occupied.slots.length
  const coarseRows = new Int32Array(count)
  const coarseCols = new Int32Array(count)
  const inTissue = new Uint8Array(count)
  const ids: string[] = new Array<string>(count)
  const label = `render-lod-${binSizeMicrometers}um`

  for (let index = 0; index < count; index += 1) {
    const slot = occupied.slots[index] ?? 0
    const row = Math.floor(slot / colSpan) + minRow
    const col = (slot % colSpan) + minCol
    coarseRows[index] = row
    coarseCols[index] = col
    inTissue[index] = occupied.inTissue[index] ?? 0
    ids[index] = `${label}:${row}:${col}`
  }

  return new GridCellColumns({
    gridId: `${columns.gridId}:${label}`,
    basis: deriveNestedGridBasis(columns.basis, factor),
    length: count,
    ids,
    rows: coarseRows,
    cols: coarseCols,
    binSizeMicrometers,
    inTissue,
    renderLodSourceBinSizeMicrometers: sourceBinSizeMicrometers,
  })
}

interface OccupiedSlots {
  readonly slots: ArrayLike<number>
  readonly inTissue: ArrayLike<number>
}

function denseOccupiedSlots(
  columns: GridCellColumns,
  slotCount: number,
  slotOf: (index: number) => number,
): OccupiedSlots {
  // 0: empty; 1: bins, none in tissue; 2: a bin in tissue.
  const state = new Uint8Array(slotCount)
  let count = 0

  for (let index = 0; index < columns.length; index += 1) {
    const slot = slotOf(index)
    const next = columns.inTissue?.[index] === 1 ? 2 : 1

    if (state[slot] === 0) count += 1
    if (next > (state[slot] ?? 0)) state[slot] = next
  }

  const slots = new Uint32Array(count)
  const inTissue = new Uint8Array(count)
  let cursor = 0

  for (let slot = 0; slot < slotCount; slot += 1) {
    const value = state[slot] ?? 0
    if (value === 0) continue
    slots[cursor] = slot
    inTissue[cursor] = value === 2 ? 1 : 0
    cursor += 1
  }

  return { slots, inTissue }
}

function sparseOccupiedSlots(
  columns: GridCellColumns,
  slotOf: (index: number) => number,
): OccupiedSlots {
  const state = new Map<number, number>()

  for (let index = 0; index < columns.length; index += 1) {
    const slot = slotOf(index)
    const next = columns.inTissue?.[index] === 1 ? 2 : 1
    if (next > (state.get(slot) ?? 0)) state.set(slot, next)
  }

  const slots = Float64Array.from(state.keys()).sort()

  return {
    slots,
    inTissue: Uint8Array.from(slots, (slot) => (state.get(slot) === 2 ? 1 : 0)),
  }
}
