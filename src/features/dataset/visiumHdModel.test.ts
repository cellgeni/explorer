import { describe, expect, it } from 'vitest'
import { micrometers } from '../../data/coords'
import type { SpatialGrid } from '../../datasets/spatialDataset'
import type {
  VisiumHdBinnedOverview,
  VisiumHdBinSizeMicrometers,
} from '../../datasets/visiumHdDataset'
import {
  IDLE_VISIUM_HD_CONTROL_STATE,
  createVisiumHdBinOptions,
  visiumHdControlFailed,
  visiumHdControlLoading,
  visiumHdControlReadyFromOptions,
  visiumHdControlStateFromOverview,
} from './visiumHdModel'

describe('Visium HD controls model', () => {
  it('enables detected 2 µm outputs without an explicit filtered-barcode budget', () => {
    expect(createVisiumHdBinOptions([16, 8, 2])).toEqual([
      { size: 16, available: true, disabled: false },
      { size: 8, available: true, disabled: false },
      { size: 2, available: true, disabled: false },
    ])
  })

  it('keeps missing 2 µm outputs disabled', () => {
    expect(createVisiumHdBinOptions([16, 8])).toContainEqual({
      size: 2,
      available: false,
      disabled: true,
      reason: '2 µm binned output was not detected.',
    })
  })

  it('constructs Visium HD control transitions', () => {
    const initialReady = visiumHdControlStateFromOverview(
      'https://example.test/visium',
      [16, 8],
      overview(16, ['BC-16']),
    )

    expect(IDLE_VISIUM_HD_CONTROL_STATE).toEqual({ status: 'idle' })
    expect(initialReady).toEqual({
      status: 'ready',
      url: 'https://example.test/visium',
      selectedBinSize: 16,
      options: [
        { size: 16, available: true, disabled: false, binCount: 1 },
        { size: 8, available: true, disabled: false },
        {
          size: 2,
          available: false,
          disabled: true,
          reason: '2 µm binned output was not detected.',
        },
      ],
      binCount: 1,
    })
    expect(visiumHdControlLoading(IDLE_VISIUM_HD_CONTROL_STATE, 8)).toBe(
      IDLE_VISIUM_HD_CONTROL_STATE,
    )
    expect(visiumHdControlLoading(initialReady, 8)).toEqual({
      ...initialReady,
      status: 'loading',
      selectedBinSize: 8,
    })

    const switchedReady = visiumHdControlReadyFromOptions(
      'https://example.test/visium',
      initialReady.status === 'idle' ? [] : initialReady.options,
      overview(8, ['BC-8-A', 'BC-8-B']),
    )

    expect(switchedReady).toEqual({
      status: 'ready',
      url: 'https://example.test/visium',
      selectedBinSize: 8,
      options: [
        { size: 16, available: true, disabled: false, binCount: 1 },
        { size: 8, available: true, disabled: false, binCount: 2 },
        {
          size: 2,
          available: false,
          disabled: true,
          reason: '2 µm binned output was not detected.',
        },
      ],
      binCount: 2,
    })
    expect(visiumHdControlFailed(switchedReady, 'Failed')).toEqual({
      ...switchedReady,
      status: 'error',
      error: 'Failed',
    })
  })
})

function overview(
  binSizeMicrometers: VisiumHdBinSizeMicrometers,
  ids: readonly string[],
): VisiumHdBinnedOverview {
  return {
    binSizeMicrometers,
    scalefactors: {
      micronsPerPixel: 0.5,
      tissueHiresScale: 0.2,
      tissueLowresScale: 0.02,
    },
    grid: grid(binSizeMicrometers),
    gridCells: {
      kind: 'grid-cells',
      gridId: `visium-hd-square-${binSizeMicrometers}um`,
      ids,
      rows: new Int32Array(ids.length),
      cols: new Int32Array(ids.length),
    },
    fullresRows: new Float64Array(ids.length),
    fullresCols: new Float64Array(ids.length),
    inTissue: new Uint8Array(ids.length),
    sourcePaths: {
      tissuePositions: `binned_outputs/square_${binSizeMicrometers}um/spatial/tissue_positions.parquet`,
      scalefactors: `binned_outputs/square_${binSizeMicrometers}um/spatial/scalefactors_json.json`,
      tissueHiresImage: `binned_outputs/square_${binSizeMicrometers}um/spatial/tissue_hires_image.png`,
      tissueLowresImage: `binned_outputs/square_${binSizeMicrometers}um/spatial/tissue_lowres_image.png`,
      filteredMatrixH5: `binned_outputs/square_${binSizeMicrometers}um/filtered_feature_bc_matrix.h5`,
    },
  }
}

function grid(binSizeMicrometers: VisiumHdBinSizeMicrometers): SpatialGrid {
  return {
    id: `visium-hd-square-${binSizeMicrometers}um`,
    binSizeMicrometers: micrometers(binSizeMicrometers),
    basis: {
      origin: { x: micrometers(0), y: micrometers(0) },
      rowStep: { x: micrometers(0), y: micrometers(binSizeMicrometers) },
      colStep: { x: micrometers(binSizeMicrometers), y: micrometers(0) },
    },
  }
}
