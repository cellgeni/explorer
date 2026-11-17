import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ShareableState } from '../../data/shareableState'
import {
  ateraImageControlReady,
  IDLE_ATERA_IMAGE_STATE,
  type AteraImageControlState,
} from '../dataset/ateraImageModel'
import { useAteraImageWorkflow } from './useAteraImageWorkflow'

const DATASET_URL = 'https://example.test/atera'
const SHARED: ShareableState = {
  datasetUrl: DATASET_URL,
  selectedGenes: ['UMOD'],
  morphologyZPlane: 7,
}

function renderWorkflow(state: AteraImageControlState) {
  const initialShareableStateRef = { current: null as ShareableState | null }
  const startDatasetLoad = vi.fn(async () => undefined)
  const setAteraImageState = vi.fn()
  const { result } = renderHook(() =>
    useAteraImageWorkflow({
      appendDebugEvent: vi.fn(),
      ateraImageState: state,
      datasetUrl: DATASET_URL,
      initialShareableStateRef,
      readShareableState: () => SHARED,
      setAteraImageState,
      startDatasetLoadRef: { current: startDatasetLoad },
    }),
  )

  return { initialShareableStateRef, result, setAteraImageState, startDatasetLoad }
}

describe('useAteraImageWorkflow', () => {
  it('reloads the dataset with the chosen image and keeps the view', () => {
    const { initialShareableStateRef, result, setAteraImageState, startDatasetLoad } =
      renderWorkflow(ateraImageControlReady('2d'))

    act(() => {
      result.current.handleAteraImageChange('3d')
    })

    expect(initialShareableStateRef.current).toEqual({ ...SHARED, ateraImage: '3d' })
    expect(setAteraImageState).toHaveBeenCalledTimes(1)
    // The image loads even when Morphology image is off.
    expect(startDatasetLoad).toHaveBeenCalledWith(DATASET_URL, true)
  })

  it('does nothing while no choice is offered', () => {
    const { result, startDatasetLoad } = renderWorkflow(IDLE_ATERA_IMAGE_STATE)

    act(() => {
      result.current.handleAteraImageChange('3d')
    })

    expect(startDatasetLoad).not.toHaveBeenCalled()
  })
})
