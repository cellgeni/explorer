import type { AnnDataVisiumSummary } from '../../datasets/h5adDataset'
import type { VisiumImageKind, VisiumUnits } from '../../datasets/visiumFormat'

export type VisiumSource = 'space-ranger' | 'h5ad'

export type VisiumControlState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ready' | 'loading'
      readonly source: VisiumSource
      readonly summary: AnnDataVisiumSummary
      // The tissue image shown, or null when it is off or there is none.
      readonly image: VisiumImageKind | null
    }

export const IDLE_VISIUM_CONTROL_STATE: VisiumControlState = { status: 'idle' }

export function visiumControlReady(
  source: VisiumSource,
  summary: AnnDataVisiumSummary,
  image: VisiumImageKind | null,
): VisiumControlState {
  return { status: 'ready', source, summary, image }
}

export function visiumControlImage(
  state: VisiumControlState,
  image: VisiumImageKind | null,
  status: 'ready' | 'loading',
): VisiumControlState {
  return state.status === 'idle' ? state : { ...state, status, image }
}

export function visiumSourceLabel(source: VisiumSource): string {
  return source === 'h5ad' ? 'Visium (H5AD)' : 'Visium (Space Ranger)'
}

export function visiumImageLabel(kind: VisiumImageKind): string {
  return kind === 'hires' ? 'High-res' : 'Low-res'
}

// Estimates that can be noticeably off: the nominal spot diameter is a 60-70
// µm range, and without any scale the pixels are shown as micrometres.
export function visiumUnitsNeedNotice(units: VisiumUnits): boolean {
  return units.source === 'spot-diameter' || units.source === 'unknown'
}
