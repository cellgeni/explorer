import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ShareableState } from '../../data/shareableState'
import {
  ateraImageControlReady,
  IDLE_ATERA_IMAGE_STATE,
  type AteraImageControlState,
} from '../dataset/ateraImageModel'
import { useAteraImageWorkflow } from './useAteraImageWorkflow'
import type { StartDatasetLoad } from './useDatasetLifecycle'

const DATASET_URL = 'https://example.test/atera'
const SHARED: ShareableState = {
  datasetUrl: DATASET_URL,
  selectedGenes: ['UMOD'],
  morphologyZPlane: 7,
}

function renderWorkflow(state: AteraImageControlState) {
  const startDatasetLoad = vi.fn<StartDatasetLoad>(async () => undefined)
  const setAteraImageState = vi.fn()
  const { result } = renderHook(() =>
    useAteraImageWorkflow({
      appendDebugEvent: vi.fn(),
      ateraImageState: state,
      datasetUrl: DATASET_URL,
      readShareableState: () => SHARED,
      setAteraImageState,
      startDatasetLoadRef: { current: startDatasetLoad },
    }),
  )

  return { result, setAteraImageState, startDatasetLoad }
}

describe('useAteraImageWorkflow', () => {
  it('reloads the dataset with the chosen image and keeps the view', () => {
    const { result, setAteraImageState, startDatasetLoad } = renderWorkflow(
      ateraImageControlReady('2d'),
    )

    act(() => {
      result.current.handleAteraImageChange('3d')
    })

    expect(setAteraImageState).toHaveBeenCalledTimes(1)
    // The image loads even when Morphology image is off. The reload holds
    // the new choice until it replaces the view on screen.
    expect(startDatasetLoad).toHaveBeenCalledWith(DATASET_URL, true, {
      shareableState: { ...SHARED, ateraImage: '3d' },
      restoreControl: expect.any(Function),
    })
  })

  it('puts the image on screen back if the reload is cancelled or fails', () => {
    const { result, setAteraImageState, startDatasetLoad } = renderWorkflow(
      ateraImageControlReady('2d'),
    )

    act(() => {
      result.current.handleAteraImageChange('3d')
    })
    const [, , viewChange] = startDatasetLoad.mock.calls[0] ?? []
    act(() => {
      viewChange?.restoreControl()
    })

    const restore = setAteraImageState.mock.calls.at(-1)?.[0] as (
      state: AteraImageControlState,
    ) => AteraImageControlState
    expect(restore({ status: 'loading', choice: '3d' })).toEqual(
      ateraImageControlReady('2d'),
    )
  })

  it('does nothing while no choice is offered', () => {
    const { result, startDatasetLoad } = renderWorkflow(IDLE_ATERA_IMAGE_STATE)

    act(() => {
      result.current.handleAteraImageChange('3d')
    })

    expect(startDatasetLoad).not.toHaveBeenCalled()
  })
})
