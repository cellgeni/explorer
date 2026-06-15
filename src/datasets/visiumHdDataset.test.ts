import { describe, expect, it } from 'vitest'
import { compressors as parquetCompressors } from 'hyparquet-compressors'
import { micrometers } from '../data/coords'
import {
  VISIUM_HD_TISSUE_POSITION_COLUMNS,
  VisiumHdDataset,
  createVisiumHdBinnedOverview,
  parseVisiumHdScalefactors,
  parseVisiumHdTissuePositionRows,
  readVisiumHdTissuePositions,
} from './visiumHdDataset'
import type { AsyncBuffer } from 'hyparquet'
import type {
  ReadVisiumHdTissuePositionsOptions,
  VisiumHdBinDescriptor,
  VisiumHdParquetReadObjectsOptions,
  VisiumHdScalefactors,
} from './visiumHdDataset'

const fakeFile: AsyncBuffer = {
  byteLength: 8,
  slice: () => new ArrayBuffer(0),
}

const bin16: VisiumHdBinDescriptor = {
  binSizeMicrometers: 16,
  outputPath: 'binned_outputs/square_016um',
  tissuePositionsPath: 'binned_outputs/square_016um/spatial/tissue_positions.parquet',
  scalefactorsPath: 'binned_outputs/square_016um/spatial/scalefactors_json.json',
  filteredMatrixH5Path: 'binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
}

const scalefactors: VisiumHdScalefactors = {
  micronsPerPixel: 0.5,
  tissueHiresScale: 0.25,
  tissueLowresScale: 0.025,
  binSizeMicrometers: 16,
  spotDiameterFullres: 32,
  registrationTargetImageScale: 0.125,
  tissueHiresImageWidth: 6000,
  tissueHiresImageHeight: 5143,
  tissueLowresImageWidth: 600,
  tissueLowresImageHeight: 514,
}

describe('Visium HD dataset readers', () => {
  it('parses Space Ranger scalefactors JSON with declared and measured fields', () => {
    expect(
      parseVisiumHdScalefactors({
        microns_per_pixel: 0.22133875377751464,
        tissue_hires_scalef: 0.087,
        tissue_lowres_scalef: 0.0087,
        bin_size_um: 16,
        spot_diameter_fullres: 72.287,
        tissue_hires_image_width: 6000,
        tissue_hires_image_height: 5143,
        tissue_lowres_image_width: 600,
        tissue_lowres_image_height: 514,
        regist_target_img_scalef: 0.1,
      }),
    ).toEqual({
      micronsPerPixel: 0.22133875377751464,
      tissueHiresScale: 0.087,
      tissueLowresScale: 0.0087,
      binSizeMicrometers: 16,
      spotDiameterFullres: 72.287,
      tissueHiresImageWidth: 6000,
      tissueHiresImageHeight: 5143,
      tissueLowresImageWidth: 600,
      tissueLowresImageHeight: 514,
      registrationTargetImageScale: 0.1,
    })
  })

  it('reads tissue_positions.parquet through the Visium HD column projection', async () => {
    const calls: VisiumHdParquetReadObjectsOptions[] = []
    const positions = await readVisiumHdTissuePositions({
      file: fakeFile,
      limit: 50,
      readObjects: async (options) => {
        calls.push(options)
        return [
          {
            barcode: 'AAAC-1',
            in_tissue: 1n,
            array_row: 2n,
            array_col: 3n,
            pxl_row_in_fullres: 400.5,
            pxl_col_in_fullres: 800.25,
          },
        ]
      },
    })

    expect(calls[0]).toEqual({
      file: fakeFile,
      columns: VISIUM_HD_TISSUE_POSITION_COLUMNS,
      rowFormat: 'object',
      rowEnd: 50,
      compressors: parquetCompressors,
    })
    expect(positions.ids).toEqual(['AAAC-1'])
    expect(Array.from(positions.inTissue)).toEqual([1])
    expect(Array.from(positions.arrayRows)).toEqual([2])
    expect(Array.from(positions.arrayCols)).toEqual([3])
    expect(Array.from(positions.fullresRows)).toEqual([400.5])
    expect(Array.from(positions.fullresCols)).toEqual([800.25])
  })

  it('builds a columnar binned overview with an affine grid basis', () => {
    const positions = parseVisiumHdTissuePositionRows([
      visiumPositionRow('BC-0', 1, 0, 0, 400, 200),
      visiumPositionRow('BC-1', 1, 1, 0, 402, 232),
      visiumPositionRow('BC-2', 1, 0, 1, 432, 204),
      visiumPositionRow('BC-3', 1, 2, 3, 500, 276),
      visiumPositionRow('BC-out', 0, 5, 5, 520, 320),
    ])

    const overview = createVisiumHdBinnedOverview(bin16, positions, scalefactors)

    expect(overview.binSizeMicrometers).toBe(16)
    expect(overview.grid.id).toBe('visium-hd-square-016um')
    expect(overview.grid.binSizeMicrometers).toBe(micrometers(16))
    expect(overview.grid.bounds).toEqual({
      minRow: 0,
      maxRow: 2,
      minCol: 0,
      maxCol: 3,
    })
    expect(overview.gridCells.ids).toEqual(['BC-0', 'BC-1', 'BC-2', 'BC-3'])
    expect(Array.from(overview.gridCells.rows)).toEqual([0, 1, 0, 2])
    expect(Array.from(overview.gridCells.cols)).toEqual([0, 0, 1, 3])
    expect(Array.from(overview.inTissue)).toEqual([1, 1, 1, 1])
    expect(Array.from(overview.fullresRows)).toEqual([400, 402, 432, 500])
    expect(Array.from(overview.fullresCols)).toEqual([200, 232, 204, 276])
    expect(overview.grid.basis.origin.x).toBeCloseTo(100)
    expect(overview.grid.basis.origin.y).toBeCloseTo(200)
    expect(overview.grid.basis.rowStep.x).toBeCloseTo(16)
    expect(overview.grid.basis.rowStep.y).toBeCloseTo(1)
    expect(overview.grid.basis.colStep.x).toBeCloseTo(2)
    expect(overview.grid.basis.colStep.y).toBeCloseTo(16)
  })

  it('exposes Visium HD metadata and bbox-filtered grid cells through the dataset', async () => {
    const positions = parseVisiumHdTissuePositionRows([
      visiumPositionRow('BC-0', 1, 0, 0, 400, 200),
      visiumPositionRow('BC-1', 1, 1, 0, 402, 232),
      visiumPositionRow('BC-2', 1, 0, 1, 432, 204),
    ])
    const tissuePositionCalls: ReadVisiumHdTissuePositionsOptions[] = []
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16],
      tissuePositionsReader: async (options) => {
        tissuePositionCalls.push(options)
        return positions
      },
      scalefactorsReader: async () => scalefactors,
    })

    const meta = await dataset.meta()
    const batch = await dataset.elements({
      minX: micrometers(90),
      maxX: micrometers(110),
      minY: micrometers(190),
      maxY: micrometers(210),
    })

    expect(meta).toMatchObject({
      platform: 'visium-hd',
      capabilities: {
        transcripts: false,
        cellBoundaries: false,
        pyramidImage: false,
        multiChannel: false,
      },
    })
    expect(meta.units.micrometersPerPixel).toBe(micrometers(0.5))
    expect(meta.grids?.[0]?.id).toBe('visium-hd-square-016um')
    expect(batch.elements).toEqual([])
    expect(batch.gridCells?.[0]?.ids).toEqual(['BC-0'])
    expect(Array.from(batch.gridCells?.[0]?.rows ?? [])).toEqual([0])
    expect(Array.from(batch.gridCells?.[0]?.cols ?? [])).toEqual([0])
    expect(tissuePositionCalls).toHaveLength(1)
  })

  it('returns the binned high-resolution tissue PNG as a flat image source', async () => {
    const positions = parseVisiumHdTissuePositionRows([
      visiumPositionRow('BC-0', 1, 0, 0, 400, 200),
      visiumPositionRow('BC-1', 1, 1, 0, 402, 232),
      visiumPositionRow('BC-2', 1, 0, 1, 432, 204),
    ])
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16],
      tissuePositionsReader: async () => positions,
      scalefactorsReader: async () => scalefactors,
    })

    await expect(dataset.image()).resolves.toEqual({
      kind: 'flat',
      url: 'https://example.test/visium/binned_outputs/square_016um/spatial/tissue_hires_image.png',
      scaleFactor: 0.25,
      size: [6000, 5143],
    })
  })

  it('allows flat image dimensions to be resolved by the browser when scalefactors omit them', async () => {
    const positions = parseVisiumHdTissuePositionRows([
      visiumPositionRow('BC-0', 1, 0, 0, 400, 200),
      visiumPositionRow('BC-1', 1, 1, 0, 402, 232),
      visiumPositionRow('BC-2', 1, 0, 1, 432, 204),
    ])
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16],
      tissuePositionsReader: async () => positions,
      scalefactorsReader: async () => ({
        micronsPerPixel: scalefactors.micronsPerPixel,
        tissueHiresScale: scalefactors.tissueHiresScale,
        tissueLowresScale: scalefactors.tissueLowresScale,
      }),
    })

    await expect(dataset.image()).resolves.toEqual({
      kind: 'flat',
      url: 'https://example.test/visium/binned_outputs/square_016um/spatial/tissue_hires_image.png',
      scaleFactor: 0.25,
    })
  })
})

function visiumPositionRow(
  barcode: string,
  inTissue: 0 | 1,
  arrayRow: number,
  arrayCol: number,
  fullresRow: number,
  fullresCol: number,
): Record<string, unknown> {
  return {
    barcode,
    in_tissue: inTissue,
    array_row: arrayRow,
    array_col: arrayCol,
    pxl_row_in_fullres: fullresRow,
    pxl_col_in_fullres: fullresCol,
  }
}
