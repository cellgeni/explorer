// The Atera morphology control: the 2D multi-focus image or the 3D DAPI
// stack. One is shown at a time, and a change reloads the dataset with the
// new choice, as a MERSCOPE stain change does.
export type AteraImageChoice = '2d' | '3d'

export type AteraImageControlState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ready' | 'loading'
      readonly choice: AteraImageChoice
    }

export const IDLE_ATERA_IMAGE_STATE: AteraImageControlState = { status: 'idle' }

export function parseAteraImageChoice(
  value: string | undefined,
): AteraImageChoice | undefined {
  return value === '2d' || value === '3d' ? value : undefined
}

export function ateraImageControlReady(choice: AteraImageChoice): AteraImageControlState {
  return { status: 'ready', choice }
}

export function ateraImageControlLoading(
  state: AteraImageControlState,
  choice: AteraImageChoice,
): AteraImageControlState {
  return state.status === 'idle' ? state : { status: 'loading', choice }
}

// The image on screen again, once a change's reload is cancelled or fails.
export function ateraImageControlRestored(
  state: AteraImageControlState,
  choice: AteraImageChoice,
): AteraImageControlState {
  return state.status === 'idle' ? state : { status: 'ready', choice }
}

// The link names the 3D stack only; the 2D image is the default.
export function ateraImageSelectionToShareable(state: AteraImageControlState): {
  readonly ateraImage?: string
} {
  return state.status === 'idle' || state.choice === '2d' ? {} : { ateraImage: '3d' }
}
