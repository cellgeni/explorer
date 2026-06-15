import { describe, expect, it, vi } from 'vitest'
import {
  parseVisiumHdFilteredMatrixBarcodes,
  parseVisiumHdSquareBarcode,
  readVisiumHdFilteredMatrixBarcodes,
} from './visiumHdBarcodes'
import type { VisiumHdBinDescriptor } from './visiumHdDataset'

const bin2: VisiumHdBinDescriptor = {
  binSizeMicrometers: 2,
  outputPath: 'binned_outputs/square_002um',
  tissuePositionsPath: 'binned_outputs/square_002um/spatial/tissue_positions.parquet',
  scalefactorsPath: 'binned_outputs/square_002um/spatial/scalefactors_json.json',
  filteredMatrixH5Path: 'binned_outputs/square_002um/filtered_feature_bc_matrix.h5',
}

describe('Visium HD filtered matrix barcodes', () => {
  it('parses Space Ranger square barcode coordinates', () => {
    expect(parseVisiumHdSquareBarcode('s_002um_000123_000456-1')).toEqual({
      barcode: 's_002um_000123_000456-1',
      binSizeMicrometers: 2,
      row: 123,
      col: 456,
    })
    expect(parseVisiumHdSquareBarcode('square_016um_10_20')).toEqual({
      barcode: 'square_016um_10_20',
      binSizeMicrometers: 16,
      row: 10,
      col: 20,
    })
    expect(parseVisiumHdSquareBarcode('AAAC-1')).toBeNull()
  })

  it('parses filtered matrix barcode TSV rows for a selected bin size', () => {
    expect(
      parseVisiumHdFilteredMatrixBarcodes(
        ['s_002um_000001_000002-1', 's_002um_000003_000004-1', ''].join('\n'),
        { binSizeMicrometers: 2 },
      ),
    ).toEqual([
      {
        barcode: 's_002um_000001_000002-1',
        binSizeMicrometers: 2,
        row: 1,
        col: 2,
      },
      {
        barcode: 's_002um_000003_000004-1',
        binSizeMicrometers: 2,
        row: 3,
        col: 4,
      },
    ])
  })

  it('rejects malformed or mismatched square barcode rows', () => {
    expect(() => parseVisiumHdFilteredMatrixBarcodes('AAAC-1\n')).toThrow(
      'Unable to parse Visium HD square barcode on line 1: AAAC-1',
    )
    expect(() =>
      parseVisiumHdFilteredMatrixBarcodes('s_008um_000001_000002-1\n', {
        binSizeMicrometers: 2,
      }),
    ).toThrow('Expected 2 µm barcode on line 1, received 8 µm')
  })

  it('loads filtered matrix barcode sidecars from the selected bin output', async () => {
    const fetcher = vi.fn(async () => new Response('s_002um_000001_000002-1\n'))

    await expect(
      readVisiumHdFilteredMatrixBarcodes('https://example.test/visium/', bin2, {
        fetcher,
      }),
    ).resolves.toEqual([
      {
        barcode: 's_002um_000001_000002-1',
        binSizeMicrometers: 2,
        row: 1,
        col: 2,
      },
    ])
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_002um/filtered_feature_bc_matrix/barcodes.tsv.gz',
    )
  })
})
