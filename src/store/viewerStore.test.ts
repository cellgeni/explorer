import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_DATASET_URL, initialViewerState, useViewerStore } from './viewerStore'

afterEach(() => {
  const { setDatasetUrl, setViewState } = useViewerStore.getState()

  useViewerStore.setState({
    ...initialViewerState,
    setDatasetUrl,
    setViewState,
  })
})

describe('viewer store', () => {
  it('keeps lightweight UI state outside data caches', () => {
    expect(useViewerStore.getState().datasetUrl).toBe(DEMO_DATASET_URL)

    useViewerStore.getState().setDatasetUrl('https://example.test/output')
    useViewerStore.getState().setViewState({
      target: [10, 20, 0],
      zoom: 2,
      minZoom: -4,
      maxZoom: 10,
    })

    expect(useViewerStore.getState()).toMatchObject({
      datasetUrl: 'https://example.test/output',
      viewState: {
        target: [10, 20, 0],
        zoom: 2,
      },
    })
  })
})
