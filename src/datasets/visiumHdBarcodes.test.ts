import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import {
  parseVisiumHdFilteredMatrixBarcodes,
  parseVisiumHdSquareBarcode,
  readVisiumHdFilteredMatrixBarcodes,
} from './visiumHdBarcodes'
import { VisiumHdFilteredBarcodeBudgetExceededError } from './visiumHdStrategy'
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
        ['s_002um_000001_000002-1', 's_002um_000003_000004-1\tother', ''].join('\n'),
        { binSizeMicrometers: 2 },
      ),
    ).toEqual({
      binSizeMicrometers: 2,
      ids: ['s_002um_000001_000002-1', 's_002um_000003_000004-1'],
      rows: new Int32Array([1, 3]),
      cols: new Int32Array([2, 4]),
    })
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

  it('rejects filtered matrix barcode rows beyond the configured budget', () => {
    expect(() =>
      parseVisiumHdFilteredMatrixBarcodes(
        ['s_002um_000001_000002-1', 's_002um_000003_000004-1'].join('\n'),
        { binSizeMicrometers: 2, maxBarcodeCount: 1 },
      ),
    ).toThrow(VisiumHdFilteredBarcodeBudgetExceededError)
  })

  it('loads filtered matrix barcode sidecars from the selected bin output', async () => {
    const fetcher = vi.fn(async () => new Response('s_002um_000001_000002-1\n'))

    await expect(
      readVisiumHdFilteredMatrixBarcodes('https://example.test/visium/', bin2, {
        fetcher,
        maxBarcodeCount: 10,
      }),
    ).resolves.toEqual({
      binSizeMicrometers: 2,
      ids: ['s_002um_000001_000002-1'],
      rows: new Int32Array([1]),
      cols: new Int32Array([2]),
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_002um/filtered_feature_bc_matrix/barcodes.tsv.gz',
    )
  })

  it('reads a gzipped file as it streams, lines split across chunks', async () => {
    const barcodes = Array.from(
      { length: 5_000 },
      (_, index) =>
        `s_002um_${String(index % 3350).padStart(5, '0')}_${String(index).padStart(5, '0')}-1`,
    )
    const gzipped = gzipSync(new TextEncoder().encode(`${barcodes.join('\r\n')}\r\n`))
    // Three-byte chunks split the gzip header, and every line.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < gzipped.length; offset += 3) {
          controller.enqueue(gzipped.subarray(offset, offset + 3))
        }

        controller.close()
      },
    })

    const columns = await readVisiumHdFilteredMatrixBarcodes(
      'https://example.test/visium/',
      bin2,
      { fetcher: async () => new Response(body) },
    )

    expect(columns.ids).toEqual(barcodes)
    expect(columns.rows[4_999]).toBe(4_999 % 3350)
    expect(columns.cols[4_999]).toBe(4_999)
  })

  it('stops the download once the barcodes pass the budget', async () => {
    let cancelled = false
    let chunksSent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksSent += 1
        controller.enqueue(new TextEncoder().encode('s_002um_00001_00002-1\n'))
      },
      cancel() {
        cancelled = true
      },
    })

    await expect(
      readVisiumHdFilteredMatrixBarcodes('https://example.test/visium/', bin2, {
        fetcher: async () => new Response(body),
        maxBarcodeCount: 3,
      }),
    ).rejects.toThrow(VisiumHdFilteredBarcodeBudgetExceededError)
    expect(cancelled).toBe(true)
    expect(chunksSent).toBeLessThan(10)
  })
})
