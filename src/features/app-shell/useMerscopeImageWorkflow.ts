import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { parseShareableState, type ShareableState } from '../../data/shareableState'
import type { MerscopeImageChoice } from '../../datasets/merscopeDataset'
import {
  formatMerscopeImageChoice,
  merscopeImageControlLoading,
  merscopeImageControlRestored,
  type MerscopeImageControlState,
} from '../dataset/merscopeImageModel'
import type { StartDatasetLoad } from './useDatasetLifecycle'

interface MutableRef<T> {
  current: T
}

export interface UseMerscopeImageWorkflowOptions {
  readonly appendDebugEvent: (message: string) => void
  readonly datasetUrl: string | null
  readonly initialShareableStateRef: MutableRef<ShareableState | null>
  readonly merscopeImageState: MerscopeImageControlState
  // The shareable state the view is in now; defaults to the URL hash.
  readonly readShareableState?: () => ShareableState
  readonly setMerscopeImageState: Dispatch<SetStateAction<MerscopeImageControlState>>
  readonly shouldLoadMorphology: boolean
  readonly startDatasetLoadRef: MutableRef<StartDatasetLoad | null>
}

// The MERSCOPE stain and plane. A change reloads the dataset with the new
// choice in the shareable state, as a Visium library change does: the cell
// tables are not read again, and the view, genes, and layers carry over.
// Choosing a stain loads it even when Morphology image is off.
export function useMerscopeImageWorkflow({
  appendDebugEvent,
  datasetUrl,
  initialShareableStateRef,
  merscopeImageState,
  readShareableState = readHashShareableState,
  setMerscopeImageState,
  shouldLoadMorphology,
  startDatasetLoadRef,
}: UseMerscopeImageWorkflowOptions): {
  readonly handleMerscopeImageChange: (choice: MerscopeImageChoice | null) => void
} {
  const handleMerscopeImageChange = useCallback(
    (choice: MerscopeImageChoice | null) => {
      if (datasetUrl === null || merscopeImageState.status === 'idle') {
        return
      }

      const shownChoice = merscopeImageState.choice
      const shownShareableState = initialShareableStateRef.current
      initialShareableStateRef.current = {
        ...readShareableState(),
        datasetUrl,
        merscopeImage: formatMerscopeImageChoice(choice),
      }
      setMerscopeImageState((state) => merscopeImageControlLoading(state, choice))
      appendDebugEvent(
        `MERSCOPE image change: ${choice === null ? 'none' : `${choice.stain} z${choice.z}`}`,
      )
      void startDatasetLoadRef.current?.(
        datasetUrl,
        choice !== null || shouldLoadMorphology,
        {
          undo: () => {
            initialShareableStateRef.current = shownShareableState
            setMerscopeImageState((state) =>
              merscopeImageControlRestored(state, shownChoice),
            )
          },
        },
      )
    },
    [
      appendDebugEvent,
      datasetUrl,
      initialShareableStateRef,
      merscopeImageState,
      readShareableState,
      setMerscopeImageState,
      shouldLoadMorphology,
      startDatasetLoadRef,
    ],
  )

  return { handleMerscopeImageChange }
}

function readHashShareableState(): ShareableState {
  return typeof window === 'undefined' ? {} : parseShareableState(window.location.hash)
}
