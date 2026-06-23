import { describe, expect, it, vi } from 'vitest'
import type { VisiumHdBarcodeMapping } from '../../datasets/visiumHdBarcodeMappings'
import type { GridCellDatum } from '../../rendering/deckLayers'
import {
  formatMappingRowsScope,
  isSpatialGeneExpressionDataset,
  isSpatialSegmentationDataset,
  selectedVisiumHdCellMappedBinIds,
  selectedVisiumHdCellMappings,
  selectedVisiumHdProfileBinSize,
} from './visiumHdAppController'

const gridCell: GridCellDatum = {
  id: 's_008um_1_2',
  gridId: 'visium-hd-8um',
  row: 1,
  col: 2,
  binSizeMicrometers: 8,
  polygon: [],
  fillColor: [0, 0, 0, 255],
  lineColor: [255, 255, 255, 255],
}

const mappings: readonly VisiumHdBarcodeMapping[] = [
  {
    square002um: 's_002um_1_1',
    square008um: 's_008um_1_1',
    square016um: 's_016um_1_1',
    cellId: 'cell-1',
    inCell: true,
    inNucleus: false,
  },
  {
    square002um: 's_002um_1_2',
    square008um: 's_008um_1_2',
    square016um: 's_016um_1_2',
    cellId: 'cell-1',
    inCell: false,
    inNucleus: true,
  },
  {
    square002um: 's_002um_2_1',
    square008um: 's_008um_2_1',
    square016um: 's_016um_2_1',
    cellId: 'cell-1',
    inCell: false,
    inNucleus: false,
  },
  {
    square002um: 's_002um_3_1',
    square008um: 's_008um_3_1',
    square016um: 's_016um_3_1',
    cellId: 'cell-2',
    inCell: true,
    inNucleus: true,
  },
]

describe('visiumHdAppController', () => {
  it('chooses active bin size before selected-cell metadata', () => {
    expect(selectedVisiumHdProfileBinSize(16, gridCell)).toBe(16)
    expect(selectedVisiumHdProfileBinSize(undefined, gridCell)).toBe(8)
    expect(
      selectedVisiumHdProfileBinSize(undefined, {
        ...gridCell,
        binSizeMicrometers: 4,
      }),
    ).toBeUndefined()
  })

  it('filters mapped bins for selected cells and membership', () => {
    expect(selectedVisiumHdCellMappedBinIds(mappings, 'cell-1', 8)).toEqual([
      's_008um_1_1',
      's_008um_1_2',
    ])
  })

  it('uses cell-scoped mapping APIs before full mapping scans', async () => {
    const signal = new AbortController().signal
    const barcodeMappingsForCell = vi.fn(async () => mappings)
    const barcodeMappings = vi.fn(async () => [])
    const dataset = {
      matrix: vi.fn(),
      barcodeMappings,
      barcodeMappingsForCell,
    }

    await expect(
      selectedVisiumHdCellMappings(dataset, 'cell-1', 50, signal),
    ).resolves.toBe(mappings)
    expect(barcodeMappingsForCell).toHaveBeenCalledWith('cell-1', { signal })
    expect(barcodeMappings).not.toHaveBeenCalled()
  })

  it('falls back to budgeted full mapping scans', async () => {
    const signal = new AbortController().signal
    const barcodeMappings = vi.fn(async () => mappings)
    const dataset = {
      matrix: vi.fn(),
      barcodeMappings,
    }

    await expect(
      selectedVisiumHdCellMappings(dataset, 'cell-1', 50, signal),
    ).resolves.toBe(mappings)
    expect(barcodeMappings).toHaveBeenCalledWith({ maxRows: 50, signal })
  })

  it('formats mapping-row scope labels and detects capabilities', () => {
    expect(formatMappingRowsScope(undefined)).toBe('all available mapping rows')
    expect(formatMappingRowsScope(50_000)).toBe('up to 50,000 mapping rows')
    expect(isSpatialGeneExpressionDataset({ geneExpression: vi.fn() })).toBe(true)
    expect(isSpatialSegmentationDataset({ segmentationElements: vi.fn() })).toBe(true)
    expect(isSpatialGeneExpressionDataset({ geneExpression: true })).toBe(false)
  })
})
