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
  visiumHdActiveBinSize,
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
      loadedBinSize: 16,
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
    if (switchedReady.status === 'idle') {
      throw new Error('Expected ready Visium HD control state.')
    }

    expect(
      visiumHdControlReadyFromOptions(
        'https://example.test/visium',
        switchedReady.options,
        overview(16, ['BC-16']),
        2,
      ),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/visium',
      selectedBinSize: 2,
      loadedBinSize: 16,
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
      binCount: 1,
    })
    expect(visiumHdControlFailed(switchedReady, 'Failed')).toEqual({
      ...switchedReady,
      status: 'error',
      error: 'Failed',
    })
  })

  it('keeps the drawn tier while the selected one loads', () => {
    const url = 'https://example.test/visium'
    const ready16 = visiumHdControlStateFromOverview(
      url,
      [16, 8, 2],
      overview(16, ['BC-16-A', 'BC-16-B', 'BC-16-C']),
    )

    const loading2 = visiumHdControlLoading(ready16, 2)

    expect(loading2).toMatchObject({
      status: 'loading',
      selectedBinSize: 2,
      loadedBinSize: 16,
      binCount: 3,
    })
    if (loading2.status === 'idle') {
      throw new Error('Expected loading Visium HD control state.')
    }

    const ready2 = visiumHdControlReadyFromOptions(
      url,
      loading2.options,
      overview(2, ['BC-2-A', 'BC-2-B', 'BC-2-C', 'BC-2-D', 'BC-2-E']),
      2,
    )

    expect(ready2).toMatchObject({ status: 'ready', selectedBinSize: 2, binCount: 5 })
    expect(ready2).not.toHaveProperty('loadedBinSize')

    // A failed load leaves the old tier drawn.
    expect(visiumHdControlFailed(loading2, 'Failed')).toMatchObject({
      status: 'error',
      selectedBinSize: 2,
      loadedBinSize: 16,
      binCount: 3,
      error: 'Failed',
    })
  })

  it('carries a coarser view of selected 2 µm bins into the loading state', () => {
    const url = 'https://example.test/visium'
    const viewOf2 = visiumHdControlReadyFromOptions(
      url,
      createVisiumHdBinOptions([16, 8, 2]),
      overview(16, ['BC-16']),
      2,
    )

    // Zooming in loads the 2 µm bins themselves.
    expect(visiumHdControlLoading(viewOf2, 2)).toMatchObject({
      status: 'loading',
      selectedBinSize: 2,
      loadedBinSize: 16,
      binCount: 1,
    })
    // Selecting the tier already drawn needs no separate view size.
    const loading16 = visiumHdControlLoading(viewOf2, 16)

    expect(loading16).toMatchObject({
      status: 'loading',
      selectedBinSize: 16,
      binCount: 1,
    })
    expect(loading16).not.toHaveProperty('loadedBinSize')

    // 2 µm bins drawn and selected: zooming out still shows them while the
    // 16 µm view loads.
    const ready2 = visiumHdControlReadyFromOptions(
      url,
      createVisiumHdBinOptions([16, 8, 2]),
      overview(2, ['BC-2-A', 'BC-2-B']),
      2,
    )
    const zoomingOut = visiumHdControlLoading(ready2, 2)

    expect(zoomingOut).toMatchObject({
      status: 'loading',
      selectedBinSize: 2,
      binCount: 2,
    })
    expect(zoomingOut).not.toHaveProperty('loadedBinSize')
  })

  it('reads the drawn tier after a failed switch', () => {
    const url = 'https://example.test/visium'
    const options = createVisiumHdBinOptions([16, 8, 2])
    const ready16 = visiumHdControlReadyFromOptions(url, options, overview(16, ['BC-16']))
    const viewOf2 = visiumHdControlReadyFromOptions(
      url,
      options,
      overview(16, ['BC-16']),
      2,
    )

    expect(visiumHdActiveBinSize(IDLE_VISIUM_HD_CONTROL_STATE)).toBeUndefined()
    expect(visiumHdActiveBinSize(ready16)).toBe(16)
    // The 16 µm view of 2 µm bins reads 2 µm; the gene LOD maps it by zoom.
    expect(visiumHdActiveBinSize(viewOf2)).toBe(2)
    // A load in progress reads the selected size, as do the zoom LOD loads.
    expect(visiumHdActiveBinSize(visiumHdControlLoading(ready16, 8))).toBe(8)
    expect(visiumHdActiveBinSize(visiumHdControlLoading(viewOf2, 2))).toBe(2)
    // A failed load leaves the 16 µm bins drawn, so reads follow them.
    expect(
      visiumHdActiveBinSize(
        visiumHdControlFailed(visiumHdControlLoading(ready16, 8), 'Failed'),
      ),
    ).toBe(16)
    expect(
      visiumHdActiveBinSize(
        visiumHdControlFailed(visiumHdControlLoading(viewOf2, 2), 'Failed'),
      ),
    ).toBe(16)
    // With the selected tier drawn, a failed zoom LOD load reads it.
    const ready2 = visiumHdControlReadyFromOptions(url, options, overview(2, ['BC-2']), 2)
    expect(
      visiumHdActiveBinSize(
        visiumHdControlFailed(visiumHdControlLoading(ready2, 2), 'Failed'),
      ),
    ).toBe(2)
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
