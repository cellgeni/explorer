import { describe, expect, it } from 'vitest'
import type { AnnDataVisiumSummary } from '../../datasets/h5adDataset'
import {
  IDLE_VISIUM_CONTROL_STATE,
  visiumControlLoading,
  visiumControlReady,
  visiumImageForLoad,
  visiumSelectionToShareable,
  visiumViewFromShareable,
} from './visiumModel'

const SUMMARY: AnnDataVisiumSummary = {
  libraryId: 'lib-A',
  libraryIds: ['lib-A'],
  spotCount: 370,
  offTissueSpotCount: 4_622,
  showOffTissue: false,
  spotDiameterMicrometers: 55,
  units: { micrometersPerPixel: 0.32, source: 'spot-grid', detail: 'fit' },
  scalefactors: { tissueHiresScalef: 0.2 },
  images: ['hires', 'lowres'],
}

describe('Visium share-link fields', () => {
  it('writes the image always, and the library and off-tissue spots when they apply', () => {
    expect(visiumSelectionToShareable(IDLE_VISIUM_CONTROL_STATE)).toEqual({})
    expect(
      visiumSelectionToShareable(visiumControlReady('h5ad', SUMMARY, 'lowres')),
    ).toEqual({ visiumImage: 'lowres' })
    expect(
      visiumSelectionToShareable(
        visiumControlReady(
          'h5ad',
          {
            ...SUMMARY,
            libraryId: 'lib-B',
            libraryIds: ['lib-A', 'lib-B'],
            showOffTissue: true,
          },
          null,
        ),
      ),
    ).toEqual({ visiumImage: 'none', visiumLibrary: 'lib-B', visiumOffTissue: true })
  })

  it('reads the dataset view and the image to load', () => {
    expect(visiumViewFromShareable({})).toEqual({})
    expect(
      visiumViewFromShareable({ visiumLibrary: 'lib-B', visiumOffTissue: false }),
    ).toEqual({ libraryId: 'lib-B' })
    expect(visiumViewFromShareable({ visiumOffTissue: true })).toEqual({
      showOffTissue: true,
    })

    expect(visiumImageForLoad(['hires', 'lowres'], undefined)).toBe('hires')
    expect(visiumImageForLoad(['hires', 'lowres'], 'lowres')).toBe('lowres')
    expect(visiumImageForLoad(['lowres'], 'hires')).toBe('lowres')
    expect(visiumImageForLoad(['hires'], 'none')).toBeNull()
    expect(visiumImageForLoad([], undefined)).toBeNull()
  })
})

describe('Visium view changes', () => {
  it('keeps the spots on screen while loading, with the choice asked for', () => {
    const ready = visiumControlReady('h5ad', SUMMARY, 'hires')
    const loading = visiumControlLoading(ready, {
      libraryId: 'lib-A',
      showOffTissue: true,
    })

    expect(loading).toEqual({
      ...ready,
      status: 'loading',
      requestedView: { libraryId: 'lib-A', showOffTissue: true },
    })
    expect(visiumControlLoading(IDLE_VISIUM_CONTROL_STATE)).toBe(
      IDLE_VISIUM_CONTROL_STATE,
    )
    // A loaded view replaces the request.
    expect(
      visiumControlReady('h5ad', { ...SUMMARY, showOffTissue: true }, 'hires'),
    ).not.toHaveProperty('requestedView')
  })
})
