import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import {
  aggregateAteraBinnedTiles,
  ateraDensityBinSize,
  ateraGeneIndexes,
  ateraMaxPolygonExtent,
  ateraPolygonGridLevelForBbox,
  ateraPolygonGridTilesForBbox,
  ateraTranscriptGridTilesForBbox,
  decodeAteraGriddedPolygons,
  halfFloatToNumber,
  isAteraUnassignedCell,
  parseAteraExperiment,
  parseAteraPolygonGridAttrs,
  parseAteraTranscriptGrid,
  type AteraBinnedTile,
} from './ateraFormat'

function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    minY: micrometers(minY),
    maxX: micrometers(maxX),
    maxY: micrometers(maxY),
  }
}

describe('parseAteraExperiment', () => {
  it('reads the pixel size, 2D morphology image, and explorer file paths', () => {
    expect(
      parseAteraExperiment({
        pixel_size: 0.21249222,
        num_cells: 93864,
        num_transcripts: 666909842,
        region_name: 'WSI_KID_04_region1',
        analysis_sw_version: 'xenium-9.9.9.9',
        panel_wta: { panel_name: 'Atera Human Whole Transcriptome Gene Expression' },
        images: {
          morphology_2d_filepath: 'morphology_2d/ch0000_dapi.ome.tif',
          morphology_3d_filepath: 'morphology_3d/ch0000_dapi_3d.ome.tif',
        },
        explorer_files: {
          transcripts_zarr_filepath: 'transcripts.zarr.zip',
          transcripts_viz_zarr_filepath: 'binned_transcripts.zarr.zip',
          cells_zarr_filepath: 'cells.zarr.zip',
          cell_feature_zarr_filepath: 'cell_feature_matrix.zarr.zip',
          cell_feature_viz_zarr_filepath: 'csc_cell_feature_matrix.zarr.zip',
          analysis_summary_filepath: 'analysis_summary.html',
        },
      }),
    ).toEqual({
      micrometersPerPixel: 0.21249222,
      morphologyPath: 'morphology_2d/ch0000_dapi.ome.tif',
      cellCount: 93864,
      transcriptCount: 666909842,
      panelName: 'Atera Human Whole Transcriptome Gene Expression',
      regionName: 'WSI_KID_04_region1',
      analysisVersion: 'xenium-9.9.9.9',
      files: {
        transcripts: 'transcripts.zarr.zip',
        binnedTranscripts: 'binned_transcripts.zarr.zip',
        cells: 'cells.zarr.zip',
        cellFeatureMatrix: 'cell_feature_matrix.zarr.zip',
        cscCellFeatureMatrix: 'csc_cell_feature_matrix.zarr.zip',
      },
    })
  })

  it('tolerates missing sections and rejects non-objects', () => {
    expect(parseAteraExperiment({ pixel_size: 'NaN' })).toEqual({ files: {} })
    expect(() => parseAteraExperiment([])).toThrow('experiment.spatial')
  })
})

describe('Atera gridded polygon sets', () => {
  const grid = parseAteraPolygonGridAttrs({
    grid_size: [500.0],
    number_levels: 3,
    grid_keys: [
      [
        [0, 0],
        [1, 0],
        [3, 2],
      ],
      [
        [0, 0],
        [1, 1],
      ],
      [[0, 0]],
    ],
    grid_number_objects: [[10, 0, 4], [10, 4], [14]],
  })

  it('doubles the tile size per level', () => {
    expect(grid.levels.map((level) => level.tileSize)).toEqual([500, 1000, 2000])
    expect(grid.levels[0]?.tiles).toEqual([
      { key: '0,0', x: 0, y: 0, objectCount: 10 },
      { key: '1,0', x: 1, y: 0, objectCount: 0 },
      { key: '3,2', x: 3, y: 2, objectCount: 4 },
    ])
  })

  it('uses coarser levels as the request widens', () => {
    expect(ateraPolygonGridLevelForBbox(grid, bbox(0, 0, 1000, 800))).toBe(0)
    expect(ateraPolygonGridLevelForBbox(grid, bbox(0, 0, 4100, 100))).toBe(1)
    expect(ateraPolygonGridLevelForBbox(grid, bbox(0, 0, 60000, 100))).toBe(2)
  })

  it('selects non-empty tiles that polygons from padding can reach', () => {
    const level = grid.levels[0]

    if (level === undefined) {
      throw new Error('missing level')
    }

    expect(
      ateraPolygonGridTilesForBbox(level, bbox(1510, 1010, 1600, 1100), 0).map(
        (tile) => tile.key,
      ),
    ).toEqual(['3,2'])
    // Tile 1,0 overlaps but is empty; tile 3,2 is reached only with padding.
    expect(
      ateraPolygonGridTilesForBbox(level, bbox(600, 100, 1450, 990), 0).map(
        (tile) => tile.key,
      ),
    ).toEqual([])
    expect(
      ateraPolygonGridTilesForBbox(level, bbox(600, 100, 1450, 990), 60).map(
        (tile) => tile.key,
      ),
    ).toEqual(['3,2'])
  })

  it('rejects attributes without a grid size', () => {
    expect(() => parseAteraPolygonGridAttrs({ grid_keys: [[[0, 0]]] })).toThrow(
      'grid_size',
    )
  })

  it('decodes relative vertices against each cell bounding box', () => {
    const bboxes = new Float32Array([10, 20, 20, 40, 100, 100, 102, 104])
    const polygons = decodeAteraGriddedPolygons({
      cellIndex: [1, 0],
      numVertices: [3, 4],
      relativeVertices: [0, 0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 255, 0, 255],
      bboxes,
    })

    expect(polygons).toEqual([
      {
        cellIndex: 1,
        ring: [
          { x: 100, y: 100 },
          { x: 102, y: 100 },
          { x: 102, y: 104 },
        ],
      },
      {
        cellIndex: 0,
        ring: [
          { x: 10, y: 20 },
          { x: 20, y: 20 },
          { x: 20, y: 40 },
          { x: 10, y: 40 },
        ],
      },
    ])
    expect(ateraMaxPolygonExtent(bboxes)).toBe(20)
  })

  it('skips polygons with fewer than three vertices but keeps the offset', () => {
    const polygons = decodeAteraGriddedPolygons({
      cellIndex: [0, 0],
      numVertices: [2, 3],
      relativeVertices: [0, 0, 1, 1, 0, 0, 255, 0, 255, 255],
      bboxes: [0, 0, 255, 255],
    })

    expect(polygons).toHaveLength(1)
    expect(polygons[0]?.ring[1]).toEqual({ x: 255, y: 0 })
  })
})

describe('Atera transcript grids', () => {
  it('reads tile keys, including negative ones, and the origin', () => {
    const grid = parseAteraTranscriptGrid(
      { grid_size: 2000, grid_keys: ['-1,2', '0,0', 'bad'], origin: { x: 10, y: -5 } },
      'binned',
    )

    expect(grid).toEqual({
      tileSize: 2000,
      originX: 10,
      originY: -5,
      tiles: [
        { key: '-1,2', x: -1, y: 2 },
        { key: '0,0', x: 0, y: 0 },
      ],
    })
    expect(parseAteraTranscriptGrid({ grid_size: [500], grid_keys: [] }, 'g')).toEqual({
      tileSize: 500,
      originX: 0,
      originY: 0,
      tiles: [],
    })
    expect(() => parseAteraTranscriptGrid({ grid_keys: [] }, 'transcripts grid')).toThrow(
      'transcripts grid is missing grid_size or grid_keys.',
    )
  })

  it('selects the tiles a box touches', () => {
    const grid = parseAteraTranscriptGrid(
      { grid_size: 2000, grid_keys: ['-1,2', '0,2', '1,2', '0,0'] },
      'grid',
    )

    expect(
      ateraTranscriptGridTilesForBbox(grid, bbox(-100, 4100, 500, 4200)).map(
        (tile) => tile.key,
      ),
    ).toEqual(['-1,2', '0,2'])
  })

  it('matches genes exactly, then ignoring case, once each', () => {
    const genes = ['UMOD', 'NPHS1', 'umod-like', 'Malat1']

    expect(
      ateraGeneIndexes(genes, ['NPHS1', 'malat1', 'UMOD', 'umod', 'MISSING']),
    ).toEqual([
      { index: 1, name: 'NPHS1' },
      { index: 3, name: 'Malat1' },
      { index: 0, name: 'UMOD' },
    ])
  })
})

describe('Atera binned transcript density', () => {
  it('doubles the bin size until the box spans at most the bin budget', () => {
    expect(ateraDensityBinSize(bbox(0, 0, 100, 100), 5, 1_500)).toEqual({
      level: 0,
      binSize: 5,
    })
    // 16 × 8 mm: 320 µm bins span 51 × 26 = 1,326 squares; 160 µm would be 5,151.
    expect(ateraDensityBinSize(bbox(0, 0, 16_000, 8_000), 5, 1_500)).toEqual({
      level: 6,
      binSize: 320,
    })
    expect(ateraDensityBinSize(bbox(0, 0, 16_000, 8_000), 5, 1).binSize).toBe(5 * 2 ** 12)
  })

  // Tiles are 20 µm with 4×4 native 5 µm bins; tile (1,0) sits right of (0,0).
  //   GENEA tile (0,0): row 0 cols 0 and 3 → 2 and 1; row 2 col 1 → 4
  //   GENEB tile (0,0): row 0 col 0 → 3
  //   GENEA tile (1,0): row 0 col 0 → 5
  const grid = { tileSize: 20, originX: 0, originY: 0 }
  const geneATile: AteraBinnedTile = {
    x: 0,
    y: 0,
    rows: 4,
    cols: 4,
    indptr: [0, 2, 2, 3, 3],
    indices: [0, 3, 1],
    data: [2, 1, 4],
  }
  const geneBTile: AteraBinnedTile = {
    ...geneATile,
    indptr: [0, 1, 1, 1, 1],
    indices: [0],
    data: [3],
  }
  const geneANeighbour: AteraBinnedTile = { ...geneBTile, x: 1, data: [5] }

  it('sums native bins per gene into squares and counts those in the box', () => {
    const { bins, visibleCount } = aggregateAteraBinnedTiles({
      genes: [
        { name: 'GENEA', tiles: [geneATile, geneANeighbour] },
        { name: 'GENEB', tiles: [geneBTile] },
      ],
      grid,
      bbox: bbox(0, 0, 39, 19),
      binSize: 10,
    })

    expect(visibleCount).toBe(15)
    expect(Object.fromEntries([...bins].map(([key, bin]) => [key, bin.count]))).toEqual({
      '0,0': 5,
      '1,0': 1,
      '0,1': 4,
      '2,0': 5,
    })
    expect(Object.fromEntries(bins.get('0,0')?.featureCounts ?? [])).toEqual({
      GENEA: 2,
      GENEB: 3,
    })
  })

  it('keeps edge squares whole but counts only native bins centred in the box', () => {
    const inside = aggregateAteraBinnedTiles({
      genes: [{ name: 'GENEA', tiles: [geneATile] }],
      grid,
      bbox: bbox(1, 1, 8, 8),
      binSize: 10,
    })

    expect([...inside.bins.keys()]).toEqual(['0,0'])
    expect(inside.bins.get('0,0')?.count).toBe(2)
    expect(inside.visibleCount).toBe(2)

    const corner = aggregateAteraBinnedTiles({
      genes: [{ name: 'GENEA', tiles: [geneATile] }],
      grid,
      bbox: bbox(5, 5, 8, 8),
      binSize: 10,
    })

    expect(corner.bins.get('0,0')?.count).toBe(2)
    expect(corner.visibleCount).toBe(0)
  })
})

describe('Atera transcript values', () => {
  it('decodes float16 quality scores from their bits', () => {
    expect(halfFloatToNumber(0x5100)).toBe(40)
    expect(halfFloatToNumber(0x5010)).toBe(32.5)
    expect(halfFloatToNumber(0x4e60)).toBe(25.5)
    expect(halfFloatToNumber(0)).toBe(0)
    expect(halfFloatToNumber(0xc000)).toBe(-2)
    expect(halfFloatToNumber(0x0001)).toBe(2 ** -24)
    expect(halfFloatToNumber(0x7c00)).toBe(Number.POSITIVE_INFINITY)
    expect(halfFloatToNumber(0x7e00)).toBeNaN()
  })

  it('treats UINT32_MAX cell id parts as unassigned', () => {
    expect(isAteraUnassignedCell(0xffff_ffff, 0xffff_ffff)).toBe(true)
    expect(isAteraUnassignedCell(3_043_040_529, 1)).toBe(false)
  })
})
