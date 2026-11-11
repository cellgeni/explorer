import type { ViewerCoordinateUnit } from '../../components/ViewerCore'
import { parseShareableState, type ShareableState } from '../../data/shareableState'
import type { ObservationColorMode } from '../../rendering/cellStyling'

export const CONTROL_HUD_TABS = [
  { id: 'dataset', label: 'Dataset' },
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
    value === 'metadata' ||
    value === 'gene-expression'
  )
}

export function parseObservationColorMode(
  value: string | undefined,
): ObservationColorMode | undefined {
  return value !== undefined && isObservationColorMode(value) ? value : undefined
}

// The colour mode a share link asks for. Before 15.1-A, selected genes always
// coloured the cells whatever the mode said, and links always carry a mode, so
// a link with genes resolves to gene expression, as it looked then.
export function sharedObservationColorMode(state: {
  readonly observationColorMode?: string | undefined
  readonly selectedGenes?: readonly string[] | undefined
}): ObservationColorMode | undefined {
  if ((state.selectedGenes?.length ?? 0) > 0) {
    return 'gene-expression'
  }

  return parseObservationColorMode(state.observationColorMode)
}

// The colour mode a dataset manifest's defaults ask for. Unlike a link, a
// manifest names colorCellsBy only on purpose, so it wins; genes without it
// colour by gene expression.
export function manifestObservationColorMode(defaults: {
  readonly observationColorMode?: string | undefined
  readonly selectedGenes?: readonly string[] | undefined
}): ObservationColorMode | undefined {
  return (
    parseObservationColorMode(defaults.observationColorMode) ??
    ((defaults.selectedGenes?.length ?? 0) > 0 ? 'gene-expression' : undefined)
  )
}

// Debug mode shows developer details: the deck.gl layer and budget lines, the
// zoom number and HUD tab switches in the log (UNIFIED_PLAN.md, D6). Turn it
// on with ?debug=1 (or #debug=1) in the address.
export function readDebugModeFromLocation(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const { search, hash } = window.location

  return (
    new URLSearchParams(search).get('debug') === '1' ||
    new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('debug') === '1'
  )
}
