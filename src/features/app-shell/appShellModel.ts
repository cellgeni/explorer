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

// The tabs whose controls the new shell's top bar, info drawer and layer
// panel hold (15.2-B, C), so its HUD leaves them out.
export const LAYER_PANEL_HUD_TABS: readonly ControlHudTab[] = [
  'dataset',
  'layers',
  'genes',
  'transcripts',
  'annotations',
]

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

// The colour mode a share link asks for. Version 2 links (15.1-L) say it
// whenever it is not the default. Before 15.1-A, selected genes always
// coloured the cells whatever the mode said, and version 1 links always carry
// a mode, so a version 1 link with genes resolves to gene expression, as it
// looked then.
export function sharedObservationColorMode(state: {
  readonly linkVersion?: number | undefined
  readonly observationColorMode?: string | undefined
  readonly selectedGenes?: readonly string[] | undefined
}): ObservationColorMode | undefined {
  if ((state.linkVersion ?? 1) < 2 && (state.selectedGenes?.length ?? 0) > 0) {
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

function readLocationParam(name: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const { search, hash } = window.location

  return (
    new URLSearchParams(search).get(name) ??
    new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get(name)
  )
}

export type ShellVersion = 1 | 2

// The new shell (UNIFIED_PLAN.md, 15.2) is built behind ?shell=2 until 15.2-J
// makes it the default. Use the query string: the hash is rewritten as the
// view changes.
export function readShellVersionFromLocation(): ShellVersion {
  return readLocationParam('shell') === '2' ? 2 : 1
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
