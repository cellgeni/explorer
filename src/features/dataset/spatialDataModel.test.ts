import { describe, expect, it } from 'vitest'
import type { SpatialDataSummary } from '../../datasets/spatialDataDataset'
import {
  IDLE_SPATIALDATA_CONTROL_STATE,
  spatialDataControlLoading,
  spatialDataControlReady,
  spatialDataSelectionFromShareable,
  spatialDataSelectionToShareable,
} from './spatialDataModel'

const SUMMARY: SpatialDataSummary = {
  coordinateSystem: 'global',
  coordinateSystems: ['global', 'aligned'],
  image: 'morphology_focus',
  images: ['morphology_focus', 'he_image'],
  table: 'table',
  regions: ['cell_boundaries'],
  boundaries: 'cell_boundaries',
  skippedElements: ['points'],
  units: { micrometersPerUnit: 0.2125, source: 'declared', detail: 'axes in micrometer' },
}

describe('spatialDataModel', () => {
  it('builds the ready state from the summary fields the controls show', () => {
    const selection = { coordinateSystem: 'global', micrometersPerUnit: 0.5 }

    expect(spatialDataControlReady(SUMMARY, selection)).toEqual({
      status: 'ready',
      coordinateSystem: 'global',
      coordinateSystems: ['global', 'aligned'],
      image: 'morphology_focus',
      images: ['morphology_focus', 'he_image'],
      units: SUMMARY.units,
      selection,
    })
  })

  it('leaves the image out when the summary has none', () => {
    const state = spatialDataControlReady(
      {
        coordinateSystem: 'global',
        coordinateSystems: ['global'],
        images: [],
        regions: ['cell_boundaries'],
        skippedElements: [],
        units: SUMMARY.units,
      },
      {},
    )

    expect(state).not.toHaveProperty('image')
    expect(state).toMatchObject({ status: 'ready', images: [] })
  })

  it('marks a ready state as loading with the new selection', () => {
    const ready = spatialDataControlReady(SUMMARY, { coordinateSystem: 'global' })
    const loading = spatialDataControlLoading(ready, { coordinateSystem: 'aligned' })

    expect(loading).toEqual({
      ...ready,
      status: 'loading',
      selection: { coordinateSystem: 'aligned' },
    })
  })

  it('keeps the idle state idle while loading', () => {
    expect(
      spatialDataControlLoading(IDLE_SPATIALDATA_CONTROL_STATE, { image: 'he_image' }),
    ).toBe(IDLE_SPATIALDATA_CONTROL_STATE)
  })

  it('reads a selection from shareable fields, leaving out the unset ones', () => {
    expect(
      spatialDataSelectionFromShareable({
        spatialDataCoordinateSystem: 'aligned',
        spatialDataImage: 'he_image',
        spatialDataMicrometersPerUnit: 0.5,
      }),
    ).toEqual({ coordinateSystem: 'aligned', image: 'he_image', micrometersPerUnit: 0.5 })

    const partial = spatialDataSelectionFromShareable({ spatialDataImage: 'he_image' })
    expect(partial).toEqual({ image: 'he_image' })
    expect(Object.keys(partial)).toEqual(['image'])
    expect(spatialDataSelectionFromShareable({})).toEqual({})
  })

  it('writes nothing to share for the idle state', () => {
    expect(spatialDataSelectionToShareable(IDLE_SPATIALDATA_CONTROL_STATE)).toEqual({})
  })

  it('shares only the selection, not the summary defaults', () => {
    const state = spatialDataControlReady(SUMMARY, { image: 'he_image' })

    expect(spatialDataSelectionToShareable(state)).toEqual({
      spatialDataImage: 'he_image',
    })
  })

  it.each([
    {},
    { spatialDataCoordinateSystem: 'aligned' },
    { spatialDataMicrometersPerUnit: 0 },
    {
      spatialDataCoordinateSystem: 'global',
      spatialDataImage: 'morphology_focus',
      spatialDataMicrometersPerUnit: 1.5,
    },
  ])('round-trips shareable fields %o through a loading state', (shareable) => {
    const ready = spatialDataControlReady(SUMMARY, {})
    const loading = spatialDataControlLoading(
      ready,
      spatialDataSelectionFromShareable(shareable),
    )

    expect(spatialDataSelectionToShareable(loading)).toEqual(shareable)
  })
})
