import { act, renderHook, waitFor } from '@testing-library/react'
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

  it('drops a tissue image read once another dataset is on screen', async () => {
    let finishImage: (source: unknown) => void = () => undefined
    const imageRead = new Promise((resolve) => {
      finishImage = resolve
    })
    const dataset = {
      overview: vi.fn(),
      genePanel: vi.fn(),
      annotationGroups: vi.fn(),
      embeddingOptions: vi.fn(),
      metadataTracks: vi.fn(),
      visiumSummary: vi.fn(),
      meta: vi.fn(async () => ({ units: { micrometersPerPixel: 1 } })),
      tissueImage: vi.fn(() => imageRead),
    }
    const setFlatMorphologyImage = vi.fn()
    const setMorphologyState = vi.fn()
    const { result, rerender } = renderHook(
      ({ datasetUrl }: { readonly datasetUrl: string }) =>
        useVisiumControlsWorkflow({
          appendDebugEvent: vi.fn(),
          datasetUrl,
          getSpatialDataset: vi.fn(async () => dataset) as never,
          readShareableState: () => SHARED,
          setFlatMorphologyImage,
          setMorphologyState,
          setVisiumControlState: vi.fn(),
          shouldLoadMorphology: true,
          startDatasetLoadRef: { current: null },
          visiumControlState: visiumControlReady('h5ad', SUMMARY, 'lowres'),
        }),
      { initialProps: { datasetUrl: DATASET_URL } },
    )

    act(() => {
      result.current.handleVisiumImageChange('hires')
    })
    await waitFor(() => {
      expect(dataset.tissueImage).toHaveBeenCalledWith('hires')
    })
    // Another dataset commits before the PNG arrives.
    rerender({ datasetUrl: 'https://example.test/other.h5ad' })
    setFlatMorphologyImage.mockClear()
    setMorphologyState.mockClear()

    await act(async () => {
      finishImage({ kind: 'flat', url: 'blob:hires', scaleFactor: 0.25 })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(setFlatMorphologyImage).not.toHaveBeenCalled()
    expect(setMorphologyState).not.toHaveBeenCalled()
  })

  it('does nothing before a Visium dataset is ready', () => {
    const controls = renderControls({ status: 'idle' })

    act(() => {
      controls.result.current.handleVisiumViewChange({ showOffTissue: true })
    })

    expect(controls.startDatasetLoad).not.toHaveBeenCalled()
  })
})
