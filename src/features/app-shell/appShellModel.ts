import type { ViewerCoordinateUnit } from '../../components/ViewerCore'
import { parseShareableState, type ShareableState } from '../../data/shareableState'
import type { ObservationColorMode } from '../../rendering/cellStyling'

export const CONTROL_HUD_TABS = [
  { id: 'dataset', label: 'Dataset' },
  { id: 'slides', label: 'Slides' },
  { id: 'layers', label: 'Layers' },
  { id: 'genes', label: 'Genes' },
  { id: 'transcripts', label: 'Transcripts' },
  { id: 'magic-lens', label: 'Magic Lens' },
  { id: 'annotations', label: 'Annotations' },
  { id: 'roi', label: 'ROI' },
  { id: 'cell', label: 'Cell' },
] as const

export type ControlHudTab = (typeof CONTROL_HUD_TABS)[number]['id']

export function readShareableStateFromLocation(): ShareableState {
  if (typeof window === 'undefined') {
    return {}
  }

  return {
    ...parseShareableState(window.location.search),
    ...parseShareableState(window.location.hash),
  }
}

export function parseControlHudTab(value: string | undefined): ControlHudTab | undefined {
  return CONTROL_HUD_TABS.some((tab) => tab.id === value)
    ? (value as ControlHudTab)
    : undefined
}

export function parseViewerCoordinateUnit(
  value: string | undefined,
): ViewerCoordinateUnit | undefined {
  return value === 'um' || value === 'px' ? value : undefined
}

export function isObservationColorMode(value: string): value is ObservationColorMode {
  return (
    value === 'transcript-count' ||
    value === 'cell-area' ||
    value === 'annotations' ||
    value === 'metadata'
  )
}

export function parseObservationColorMode(
  value: string | undefined,
): ObservationColorMode | undefined {
  return value !== undefined && isObservationColorMode(value) ? value : undefined
}
