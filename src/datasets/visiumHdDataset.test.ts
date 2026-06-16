import { describe, expect, it, vi } from 'vitest'
import { compressors as parquetCompressors } from 'hyparquet-compressors'
import { micrometers } from '../data/coords'
import {
  DEFAULT_VISIUM_HD_FEATURE_SLICE_BYTE_BUDGET,
  DEFAULT_VISIUM_HD_INTERACTIVE_MATRIX_BYTE_BUDGET,
  VISIUM_HD_TISSUE_POSITION_COLUMNS,
  VisiumHdDataset,
  createVisiumHdBinnedOverview,
  createVisiumHdBinnedOverviewFromSquareBarcodes,
  parseVisiumHdFeatureRows,
  parseVisiumHdScalefactors,
  parseVisiumHdTissuePositionRows,
  readVisiumHdFeatureGenePanel,
  readVisiumHdTissuePositions,
} from './visiumHdDataset'
import {
  VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
  VisiumHdTwoMicrometerOverviewDisabledError,
} from './visiumHdStrategy'
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

const bin2: VisiumHdBinDescriptor = {
  binSizeMicrometers: 2,
  outputPath: 'binned_outputs/square_002um',
  tissuePositionsPath: 'binned_outputs/square_002um/spatial/tissue_positions.parquet',
  scalefactorsPath: 'binned_outputs/square_002um/spatial/scalefactors_json.json',
  filteredMatrixH5Path: 'binned_outputs/square_002um/filtered_feature_bc_matrix.h5',
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

  it('parses filtered feature matrix gene names for the Visium HD gene panel', () => {
    expect(
      parseVisiumHdFeatureRows(
        [
          'ENSG000001\tActb\tGene Expression',
          'ENSG000002\tNegControlProbe_001\tGene Expression',
          'ENSG000003\tGad1\tGene Expression',
          'ENSG000004\tAb1\tAntibody Capture',
          'ENSG000005\tActb\tGene Expression',
          '',
        ].join('\n'),
      ),
    ).toEqual(['Actb', 'Gad1'])
  })

  it('reads Visium HD feature gene panels from filtered matrix features TSV', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        ['ENSG000001\tActb\tGene Expression', 'ENSG000002\tGad1\tGene Expression'].join(
          '\n',
        ),
      )
    })

    await expect(
      readVisiumHdFeatureGenePanel('https://example.test/visium/', bin16, {
        fetcher,
      }),
    ).resolves.toEqual(['Actb', 'Gad1'])
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_016um/filtered_feature_bc_matrix/features.tsv.gz',
    )
  })

  it('loads and caches the Visium HD gene panel for the selected bin', async () => {
    const fetcher = vi.fn(async () => new Response('unused'))
    const featureGenePanelReader = vi.fn(async () => ['Actb', 'Gad1'])
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16],
      fetcher,
      featureGenePanelReader,
    })

    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1'])
    await expect(dataset.genePanel()).resolves.toEqual(['Actb', 'Gad1'])
    expect(featureGenePanelReader).toHaveBeenCalledTimes(1)
    expect(featureGenePanelReader).toHaveBeenCalledWith(
      'https://example.test/visium',
      bin16,
      { fetcher },
    )
  })

  it('loads and caches filtered matrix barcodes for the selected bin', async () => {
    const fetcher = vi.fn(async () => new Response('unused'))
    const filteredMatrixBarcodeReader = vi.fn(async () => [
      {
        barcode: 's_002um_000001_000002-1',
        binSizeMicrometers: 2 as const,
        row: 1,
        col: 2,
      },
    ])
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin2],
      fetcher,
      filteredMatrixBarcodeReader,
    })

    await expect(dataset.filteredMatrixBarcodes(2)).resolves.toEqual([
      {
        barcode: 's_002um_000001_000002-1',
        binSizeMicrometers: 2,
        row: 1,
        col: 2,
      },
    ])
    await expect(dataset.filteredMatrixBarcodes(2)).resolves.toEqual([
      {
        barcode: 's_002um_000001_000002-1',
        binSizeMicrometers: 2,
        row: 1,
        col: 2,
      },
    ])
    expect(filteredMatrixBarcodeReader).toHaveBeenCalledTimes(1)
    expect(filteredMatrixBarcodeReader).toHaveBeenCalledWith(
      'https://example.test/visium',
      bin2,
      { fetcher },
    )
  })

  it('loads and caches budgeted barcode mappings through the dataset', async () => {
    const fetcher = vi.fn(async () => new Response('unused'))
    const barcodeMappings = [
      {
        square002um: 's_002um_000001_000002-1',
        square008um: 's_008um_000000_000000-1',
        square016um: 's_016um_000000_000000-1',
        cellId: 'cell-1',
        inNucleus: true,
        inCell: true,
      },
    ]
    const barcodeMappingsReader = vi.fn(async () => barcodeMappings)
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16],
      fetcher,
      barcodeMappingsReader,
    })

    await expect(dataset.barcodeMappings({ maxRows: 25 })).resolves.toBe(barcodeMappings)
    await expect(dataset.barcodeMappings({ maxRows: 25 })).resolves.toBe(barcodeMappings)
    expect(barcodeMappingsReader).toHaveBeenCalledTimes(1)
    expect(barcodeMappingsReader).toHaveBeenCalledWith('https://example.test/visium', {
      maxRows: 25,
      fetcher,
    })
  })

  it('filters barcode mapping assignments by active bin IDs', async () => {
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16],
      barcodeMappingsReader: async () => [
        {
          square002um: 's_002um_000001_000002-1',
          square008um: 's_008um_000000_000000-1',
          square016um: 's_016um_000000_000000-1',
          cellId: 'cell-a',
          inNucleus: true,
          inCell: true,
        },
        {
          square002um: 's_002um_000003_000004-1',
          square008um: 's_008um_000000_000001-1',
          square016um: 's_016um_000000_000001-1',
          cellId: null,
          inNucleus: false,
          inCell: false,
        },
      ],
    })

    await expect(
      dataset.barcodeMappingAssignments(16, ['s_016um_000000_000001-1'], { maxRows: 50 }),
    ).resolves.toEqual([
      {
        binId: 's_016um_000000_000001-1',
        square002um: 's_002um_000003_000004-1',
        cellId: null,
        inNucleus: false,
        inCell: false,
      },
    ])
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

  it('exposes detected Visium HD segmented cell polygons through elements()', async () => {
    const positions = parseVisiumHdTissuePositionRows([
      visiumPositionRow('BC-0', 1, 0, 0, 400, 200),
      visiumPositionRow('BC-1', 1, 1, 0, 402, 232),
      visiumPositionRow('BC-2', 1, 0, 1, 432, 204),
    ])
    const insideElement = {
      id: 'cellid_000000001-1',
      geometry: {
        kind: 'polygon' as const,
        rings: [
          [
            { x: micrometers(95), y: micrometers(195) },
            { x: micrometers(105), y: micrometers(195) },
            { x: micrometers(105), y: micrometers(205) },
          ],
        ],
      },
    }
    const outsideElement = {
      id: 'cellid_000000002-1',
      geometry: {
        kind: 'polygon' as const,
        rings: [
          [
            { x: micrometers(500), y: micrometers(500) },
            { x: micrometers(510), y: micrometers(500) },
            { x: micrometers(510), y: micrometers(510) },
          ],
        ],
      },
    }
    const segmentationReader = vi.fn(async () => [insideElement, outsideElement])
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16],
      segmentedOutputs: {
        cellSegmentationsGeojsonPath: 'segmented_outputs/cell_segmentations.geojson',
      },
      segmentationReader,
      tissuePositionsReader: async () => positions,
      scalefactorsReader: async () => scalefactors,
    })

    const meta = await dataset.meta()
    const batch = await dataset.elements({
      minX: micrometers(90),
      maxX: micrometers(110),
      minY: micrometers(190),
      maxY: micrometers(210),
    })
    const secondBatch = await dataset.elements({
      minX: micrometers(90),
      maxX: micrometers(110),
      minY: micrometers(190),
      maxY: micrometers(210),
    })

    expect(meta.capabilities.cellBoundaries).toBe(true)
    expect(batch.elements).toEqual([insideElement])
    expect(secondBatch.elements).toEqual([insideElement])
    expect(segmentationReader).toHaveBeenCalledTimes(1)
    expect(segmentationReader).toHaveBeenCalledWith(
      'https://example.test/visium',
      expect.objectContaining({
        path: 'segmented_outputs/cell_segmentations.geojson',
        scalefactors,
        kind: 'cell',
      }),
    )
  })

  it('reports nucleus segmentation metadata without enabling cell boundaries', async () => {
    const positions = parseVisiumHdTissuePositionRows([
      visiumPositionRow('BC-0', 1, 0, 0, 400, 200),
      visiumPositionRow('BC-1', 1, 1, 0, 402, 232),
      visiumPositionRow('BC-2', 1, 0, 1, 432, 204),
    ])
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16],
      segmentedOutputs: {
        nucleusSegmentationsGeojsonPath:
          'segmented_outputs/nucleus_segmentations.geojson',
        nucleusInstanceMaskTiffPath: 'segmented_outputs/nucleus_instance_mask.tiff',
      },
      tissuePositionsReader: async () => positions,
      scalefactorsReader: async () => scalefactors,
    })

    const meta = await dataset.meta()
    const batch = await dataset.elements({
      minX: micrometers(90),
      maxX: micrometers(110),
      minY: micrometers(190),
      maxY: micrometers(210),
    })

    expect(meta.capabilities.cellBoundaries).toBe(false)
    expect(meta.segmentations).toEqual([
      {
        id: 'visium-hd-nucleus-segmentations',
        kind: 'nucleus',
        label: 'Nucleus segmentations',
        sourceKind: 'geojson',
        path: 'segmented_outputs/nucleus_segmentations.geojson',
      },
      {
        id: 'visium-hd-nucleus-instance-mask',
        kind: 'nucleus',
        label: 'Nucleus instance mask',
        sourceKind: 'tiff',
        path: 'segmented_outputs/nucleus_instance_mask.tiff',
      },
    ])
    expect(batch.elements).toEqual([])
  })

  it('rejects 2 µm overview reads until a budgeted loading path is available', async () => {
    const tissuePositionsReader = vi.fn(async () =>
      parseVisiumHdTissuePositionRows([visiumPositionRow('BC-2', 1, 0, 0, 400, 200)]),
    )
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16, bin2],
      tissuePositionsReader,
      scalefactorsReader: async () => scalefactors,
    })

    await expect(dataset.readBinnedOverview(2)).rejects.toThrow(
      VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
    )
    await expect(dataset.readBinnedOverview(2)).rejects.toBeInstanceOf(
      VisiumHdTwoMicrometerOverviewDisabledError,
    )
    expect(tissuePositionsReader).not.toHaveBeenCalled()
  })

  it('loads a 2 µm overview from filtered matrix barcodes when an explicit budget is configured', async () => {
    const positions = parseVisiumHdTissuePositionRows([
      visiumPositionRow('BC-0', 1, 0, 0, 400, 200),
      visiumPositionRow('BC-1', 1, 1, 0, 402, 232),
      visiumPositionRow('BC-2', 1, 0, 1, 432, 204),
    ])
    const filteredMatrixBarcodeReader = vi.fn(async () => [
      {
        barcode: 's_002um_000001_000002-1',
        binSizeMicrometers: 2 as const,
        row: 1,
        col: 2,
      },
    ])
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16, bin2],
      maxTwoMicrometerFilteredBarcodes: 10,
      tissuePositionsReader: async () => positions,
      scalefactorsReader: async (url) =>
        url.includes('square_002um')
          ? { ...scalefactors, binSizeMicrometers: 2, spotDiameterFullres: 4 }
          : scalefactors,
      filteredMatrixBarcodeReader,
    })

    const overview = await dataset.readBinnedOverview(2)

    expect(overview.binSizeMicrometers).toBe(2)
    expect(overview.grid.id).toBe('visium-hd-square-002um')
    expect(overview.grid.binSizeMicrometers).toBe(micrometers(2))
    expect(overview.grid.basis.rowStep.x).toBeCloseTo(2)
    expect(overview.grid.basis.rowStep.y).toBeCloseTo(0.125)
    expect(overview.grid.basis.colStep.x).toBeCloseTo(0.25)
    expect(overview.grid.basis.colStep.y).toBeCloseTo(2)
    expect(overview.gridCells.ids).toEqual(['s_002um_000001_000002-1'])
    expect(Array.from(overview.gridCells.rows)).toEqual([1])
    expect(Array.from(overview.gridCells.cols)).toEqual([2])
    expect(filteredMatrixBarcodeReader).toHaveBeenCalledWith(
      'https://example.test/visium',
      bin2,
      {
        fetcher: expect.any(Function),
        maxBarcodeCount: 10,
      },
    )
  })

  it('creates a binned overview from filtered matrix square barcodes and a derived basis', () => {
    const overview = createVisiumHdBinnedOverviewFromSquareBarcodes(
      bin2,
      [
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
      ],
      { ...scalefactors, binSizeMicrometers: 2 },
      {
        origin: { x: micrometers(0), y: micrometers(0) },
        rowStep: { x: micrometers(0), y: micrometers(2) },
        colStep: { x: micrometers(2), y: micrometers(0) },
      },
    )

    expect(overview.binSizeMicrometers).toBe(2)
    expect(overview.grid.id).toBe('visium-hd-square-002um')
    expect(overview.grid.bounds).toEqual({
      minRow: 1,
      maxRow: 3,
      minCol: 2,
      maxCol: 4,
    })
    expect(overview.gridCells.ids).toEqual([
      's_002um_000001_000002-1',
      's_002um_000003_000004-1',
    ])
    expect(Array.from(overview.gridCells.rows)).toEqual([1, 3])
    expect(Array.from(overview.gridCells.cols)).toEqual([2, 4])
    expect(Array.from(overview.fullresRows)).toEqual([4, 12])
    expect(Array.from(overview.fullresCols)).toEqual([8, 16])
    expect(Array.from(overview.inTissue)).toEqual([1, 1])
    expect(overview.sourcePaths.filteredMatrixBarcodes).toBe(
      'binned_outputs/square_002um/filtered_feature_bc_matrix/barcodes.tsv.gz',
    )
  })

  it('rejects filtered barcode overviews when barcode tiers are mixed', () => {
    expect(() =>
      createVisiumHdBinnedOverviewFromSquareBarcodes(
        bin2,
        [
          {
            barcode: 's_008um_000001_000002-1',
            binSizeMicrometers: 8,
            row: 1,
            col: 2,
          },
        ],
        scalefactors,
        {
          origin: { x: micrometers(0), y: micrometers(0) },
          rowStep: { x: micrometers(0), y: micrometers(2) },
          colStep: { x: micrometers(2), y: micrometers(0) },
        },
      ),
    ).toThrow('Expected 2 µm barcode, received 8 µm')
  })

  it('does not choose 2 µm as a first-paint default tier', async () => {
    const tissuePositionsReader = vi.fn(async () =>
      parseVisiumHdTissuePositionRows([
        visiumPositionRow('BC-8', 1, 0, 0, 400, 200),
        visiumPositionRow('BC-9', 1, 1, 0, 402, 216),
        visiumPositionRow('BC-10', 1, 0, 1, 416, 204),
      ]),
    )
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [
        {
          ...bin2,
        },
        {
          ...bin16,
          binSizeMicrometers: 8,
          outputPath: 'binned_outputs/square_008um',
          tissuePositionsPath:
            'binned_outputs/square_008um/spatial/tissue_positions.parquet',
          scalefactorsPath: 'binned_outputs/square_008um/spatial/scalefactors_json.json',
          filteredMatrixH5Path:
            'binned_outputs/square_008um/filtered_feature_bc_matrix.h5',
        },
      ],
      tissuePositionsReader,
      scalefactorsReader: async () => ({ ...scalefactors, binSizeMicrometers: 8 }),
    })

    await expect(dataset.readBinnedOverview()).resolves.toMatchObject({
      binSizeMicrometers: 8,
    })
    expect(tissuePositionsReader).toHaveBeenCalledTimes(1)
  })

  it('allows 2 µm-only datasets to construct while rejecting unsafe overview reads', async () => {
    const filteredMatrixBarcodeReader = vi.fn(async () => [
      {
        barcode: 's_002um_000001_000002-1',
        binSizeMicrometers: 2 as const,
        row: 1,
        col: 2,
      },
    ])
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin2],
      filteredMatrixBarcodeReader,
    })

    await expect(dataset.readBinnedOverview()).rejects.toThrow(
      VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
    )
    await expect(dataset.filteredMatrixBarcodes()).resolves.toEqual([
      {
        barcode: 's_002um_000001_000002-1',
        binSizeMicrometers: 2,
        row: 1,
        col: 2,
      },
    ])
  })

  it('rejects budgeted 2 µm overview reads when no coarser basis source exists', async () => {
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin2],
      maxTwoMicrometerFilteredBarcodes: 10,
    })

    await expect(dataset.readBinnedOverview()).rejects.toThrow(
      '2 µm overview loading requires a detected 8 µm or 16 µm tier',
    )
  })

  it('reads binned matrix rows by Visium HD barcode', async () => {
    const matrixResult = {
      geneNames: ['Actb'],
      cells: new Map([['BC-0', { geneNames: ['Actb'], counts: [5] }]]),
    }
    const featureMatrixReader = vi.fn(async () => matrixResult)
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16],
      featureMatrixReader,
    })

    await expect(dataset.matrix(['BC-0'])).resolves.toBe(matrixResult)
    expect(featureMatrixReader).toHaveBeenCalledWith(
      'https://example.test/visium/binned_outputs/square_016um/filtered_feature_bc_matrix.h5',
      ['BC-0'],
      {
        maxFullFileBytes: DEFAULT_VISIUM_HD_INTERACTIVE_MATRIX_BYTE_BUDGET,
      },
    )
  })

  it('scores selected genes for visible Visium HD bins', async () => {
    const positions = parseVisiumHdTissuePositionRows([
      visiumPositionRow('BC-0', 1, 0, 0, 400, 200),
      visiumPositionRow('BC-1', 1, 1, 0, 402, 232),
      visiumPositionRow('BC-2', 1, 0, 1, 432, 204),
    ])
    const featureSliceReader = vi.fn(async () => ({
      geneNames: ['Actb', 'Gad1'],
      cells: new Map([
        [
          'BC-0',
          {
            geneNames: ['Actb', 'Gad1'],
            counts: [5, 3],
          },
        ],
      ]),
    }))
    const stageTimings: string[] = []
    const dataset = new VisiumHdDataset({
      baseUrl: 'https://example.test/visium/',
      bins: [bin16],
      tissuePositionsReader: async () => positions,
      scalefactorsReader: async () => scalefactors,
      featureSliceReader,
    })

    const batch = await dataset.geneExpression(
      {
        minX: micrometers(90),
        maxX: micrometers(110),
        minY: micrometers(190),
        maxY: micrometers(210),
      },
      ['Actb', 'Gad1', 'Actb'],
      {
        limit: 10,
        onStageTiming: (timing) => {
          stageTimings.push(timing.stage)
        },
      },
    )

    expect(featureSliceReader).toHaveBeenCalledWith(
      'https://example.test/visium/feature_slice.h5',
      [
        expect.objectContaining({
          id: 'BC-0',
          row: 0,
          col: 0,
        }),
      ],
      ['Actb', 'Gad1'],
      expect.objectContaining({
        binSizeMicrometers: 16,
        maxFullFileBytes: DEFAULT_VISIUM_HD_FEATURE_SLICE_BYTE_BUDGET,
        onStageTiming: expect.any(Function),
      }),
    )
    expect(batch.genes).toEqual(['Actb', 'Gad1'])
    expect(batch.maxCount).toBe(8)
    expect(batch.cells).toEqual([
      expect.objectContaining({
        id: 'BC-0',
        count: 8,
        cellArea: 256,
      }),
    ])
    expect(batch.cells[0]?.position.x).toBeCloseTo(100)
    expect(batch.cells[0]?.position.y).toBeCloseTo(200)
    expect(stageTimings).toEqual(['viewport-cells', 'matrix-read', 'score-cells'])
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
