import type {
  MerscopeImageChoice,
  MerscopeImageOptions,
} from '../../datasets/merscopeDataset'
import { MERSCOPE_IMAGE_AUTOLOAD_MAX_BYTES } from '../../datasets/merscopeFormat'

// The MERSCOPE image control: which stain and z plane of the `.vzg` is shown.
// Each is a separate download of up to a few hundred MB, so one is shown at
// a time and a change reloads the dataset with the new choice.
export type MerscopeImageControlState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ready' | 'loading'
      readonly options: MerscopeImageOptions
      // Null when no image is shown.
      readonly choice: MerscopeImageChoice | null
    }

export const IDLE_MERSCOPE_IMAGE_STATE: MerscopeImageControlState = { status: 'idle' }

// The shareable value: `<stain>_z<plane>`, or `none`.
export const MERSCOPE_NO_IMAGE = 'none'

export function formatMerscopeImageChoice(choice: MerscopeImageChoice | null): string {
  return choice === null ? MERSCOPE_NO_IMAGE : `${choice.stain}_z${choice.z}`
}

export function parseMerscopeImageChoice(
  value: string | undefined,
): MerscopeImageChoice | null | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === MERSCOPE_NO_IMAGE) {
    return null
  }

  const match = /^(.+)_z(\d+)$/.exec(value)
  return match?.[1] === undefined ? undefined : { stain: match[1], z: Number(match[2]) }
}

// The image to load: the link's choice when the `.vzg` has it, else the
// default when its pyramid is small enough to read without asking.
export function merscopeImageForLoad(
  options: MerscopeImageOptions,
  shared: string | undefined,
): { readonly choice: MerscopeImageChoice | null; readonly deferred: boolean } {
  const requested = parseMerscopeImageChoice(shared)

  if (requested === null) {
    return { choice: null, deferred: false }
  }

  if (
    requested !== undefined &&
    merscopeImageByteLength(options, requested) !== undefined
  ) {
    return { choice: requested, deferred: false }
  }

  const size = merscopeImageByteLength(options, options.defaultChoice) ?? 0

  return size <= MERSCOPE_IMAGE_AUTOLOAD_MAX_BYTES
    ? { choice: options.defaultChoice, deferred: false }
    : { choice: null, deferred: true }
}

// The pyramid's size in the zip, or undefined when the `.vzg` lacks it.
export function merscopeImageByteLength(
  options: MerscopeImageOptions,
  choice: MerscopeImageChoice,
): number | undefined {
  return options.stains
    .find((option) => option.stain === choice.stain)
    ?.planes.find((plane) => plane.z === choice.z)?.byteLength
}

export function merscopeImageControlReady(
  options: MerscopeImageOptions,
  choice: MerscopeImageChoice | null,
): MerscopeImageControlState {
  return { status: 'ready', options, choice }
}

export function merscopeImageControlLoading(
  state: MerscopeImageControlState,
  choice: MerscopeImageChoice | null,
): MerscopeImageControlState {
  return state.status === 'idle' ? state : { ...state, status: 'loading', choice }
}

// The image on screen again, once a change's reload is cancelled or fails.
export function merscopeImageControlRestored(
  state: MerscopeImageControlState,
  choice: MerscopeImageChoice | null,
): MerscopeImageControlState {
  return state.status === 'idle' ? state : { ...state, status: 'ready', choice }
}

export function merscopeImageSelectionToShareable(state: MerscopeImageControlState): {
  readonly merscopeImage?: string
} {
  return state.status === 'idle'
    ? {}
    : { merscopeImage: formatMerscopeImageChoice(state.choice) }
}

export function formatMerscopeImageSize(byteLength: number): string {
  const megabytes = byteLength / (1024 * 1024)

  return megabytes >= 10
    ? `${megabytes.toFixed(0)} MB`
    : megabytes >= 1
      ? `${megabytes.toFixed(1)} MB`
      : `${Math.max(1, Math.round(byteLength / 1024))} KB`
}
