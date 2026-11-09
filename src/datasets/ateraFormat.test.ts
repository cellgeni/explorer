import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import {
  ateraMaxPolygonExtent,
  ateraPolygonGridLevelForBbox,
  ateraPolygonGridTilesForBbox,
  decodeAteraGriddedPolygons,
  parseAteraExperiment,
  parseAteraPolygonGridAttrs,
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
