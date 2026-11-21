import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type { ShareableState } from '../../data/shareableState'
import type { AnnDataVisiumSummary } from '../../datasets/h5adDataset'
import {
  visiumControlLoading,
  visiumControlReady,
  type VisiumControlState,
} from '../dataset/visiumModel'
import type { StartDatasetLoad } from './useDatasetLifecycle'
import { useVisiumControlsWorkflow } from './useVisiumControlsWorkflow'

const DATASET_URL = 'https://example.test/visium.h5ad'
const SUMMARY: AnnDataVisiumSummary = {
  libraryId: 'lib-A',
  libraryIds: ['lib-A', 'lib-B'],
  spotCount: 24,
  offTissueSpotCount: 6,
  showOffTissue: false,
  spotDiameterMicrometers: 55,
  units: { micrometersPerPixel: 0.8, source: 'spot-grid', detail: 'fit' },
  scalefactors: { tissueHiresScalef: 0.25 },
  images: ['hires'],
}
const SHARED: ShareableState = {
  datasetUrl: DATASET_URL,
  selectedGenes: ['Actb'],
  observationColorMode: 'annotations',
  viewState: { target: [10, -20, 0], zoom: 2 },
  roiSelection: {
    kind: 'box',
    bbox: {
      minX: micrometers(0),
      maxX: micrometers(10),
      minY: micrometers(0),
      maxY: micrometers(10),
    },
  },
}

function renderControls(state: VisiumControlState) {
  const startDatasetLoad = vi.fn<StartDatasetLoad>(async () => undefined)
  const setVisiumControlState = vi.fn()
  const { result } = renderHook(() =>
    useVisiumControlsWorkflow({
      appendDebugEvent: vi.fn(),
      datasetUrl: DATASET_URL,
      getSpatialDataset: vi.fn(),
      readShareableState: () => SHARED,
      setFlatMorphologyImage: vi.fn(),
      setMorphologyState: vi.fn(),
      setVisiumControlState,
      shouldLoadMorphology: true,
      startDatasetLoadRef: { current: startDatasetLoad },
      visiumControlState: state,
    }),
  )

  return { result, setVisiumControlState, startDatasetLoad }
}

describe('useVisiumControlsWorkflow', () => {
  it('reloads with off-tissue spots, keeping genes, colours, and the ROI', () => {
    const controls = renderControls(visiumControlReady('h5ad', SUMMARY, 'hires'))

    act(() => {
      controls.result.current.handleVisiumViewChange({ showOffTissue: true })
    })

    expect(controls.setVisiumControlState).toHaveBeenCalled()
    // The reload holds the view it opens until it replaces the one on screen.
    expect(controls.startDatasetLoad).toHaveBeenCalledWith(DATASET_URL, true, {
      shareableState: {
        ...SHARED,
        visiumImage: 'hires',
        visiumLibrary: 'lib-A',
        visiumOffTissue: true,
      },
      restoreControl: expect.any(Function),
    })
  })

  it('drops the ROI when switching to another library', () => {
    const controls = renderControls(visiumControlReady('h5ad', SUMMARY, null))

    act(() => {
      controls.result.current.handleVisiumViewChange({ libraryId: 'lib-B' })
    })

    expect(controls.startDatasetLoad).toHaveBeenCalledWith(DATASET_URL, true, {
      shareableState: {
        datasetUrl: DATASET_URL,
        selectedGenes: ['Actb'],
        observationColorMode: 'annotations',
        viewState: { target: [10, -20, 0], zoom: 2 },
        visiumImage: 'none',
        visiumLibrary: 'lib-B',
        visiumOffTissue: false,
      },
      restoreControl: expect.any(Function),
    })
  })

  it('puts the view on screen back if the reload is cancelled or fails', () => {
    const ready = visiumControlReady('h5ad', SUMMARY, 'hires')
    const controls = renderControls(ready)

    act(() => {
      controls.result.current.handleVisiumViewChange({ libraryId: 'lib-B' })
    })
    const [, , viewChange] = controls.startDatasetLoad.mock.calls[0] ?? []
    act(() => {
      viewChange?.restoreControl()
    })

    const restore = controls.setVisiumControlState.mock.calls.at(-1)?.[0] as (
      state: VisiumControlState,
    ) => VisiumControlState
    expect(
      restore(visiumControlLoading(ready, { libraryId: 'lib-B', showOffTissue: false })),
    ).toEqual(ready)
  })

  it('does nothing before a Visium dataset is ready', () => {
    const controls = renderControls({ status: 'idle' })

    act(() => {
      controls.result.current.handleVisiumViewChange({ showOffTissue: true })
    })

    expect(controls.startDatasetLoad).not.toHaveBeenCalled()
  })
})
