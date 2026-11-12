import type { ShareableState } from '../../data/shareableState'
import type { ActiveTool } from '../app-shell/activeToolModel'
import type { LayerVisibility } from '../app-shell/useAppDomainState'
import type { LayerSectionId } from './layerPanelModel'
import { TOOL_ORDER } from './shortcuts'

// The shell's part of a share link (UNIFIED_PLAN.md, 15.2-H, D7):
// `panel=` lists the open layer sections, `info` (the info drawer) and
// `embedding`; `tool=` the active tool; `card=` a card to restore; `hidden=`
// the hidden layers. Each is left out at its default.

export type ShellPanelId = LayerSectionId | 'info' | 'embedding'

const LAYER_SECTION_IDS: readonly LayerSectionId[] = [
  'image',
  'cells',
  'transcripts',
  'annotations',
]
const HIDEABLE_LAYERS: readonly (keyof LayerVisibility)[] = [
  'image',
  'cells',
  'annotations',
]

export interface ShellPanelState {
  // Null until someone opens or closes a section: the default sections.
  readonly expanded: readonly LayerSectionId[] | null
  readonly infoOpen: boolean
  readonly embeddingOpen: boolean
}

export const DEFAULT_SHELL_PANELS: ShellPanelState = {
  expanded: null,
  infoOpen: false,
  embeddingOpen: false,
}

// The sections open until the user opens or closes one: Cells, or Image
// where there are no cells.
export function defaultExpandedSections(hasCells: boolean): readonly LayerSectionId[] {
  return hasCells ? ['cells'] : ['image']
}

// An old link's control tab, as the shell reads it.
export function mapControlHudTab(tab: string | undefined): {
  readonly panels?: readonly ShellPanelId[]
  readonly tool?: ActiveTool
  readonly card?: string
} {
  switch (tab) {
    case 'dataset':
      return { panels: ['info'] }
    case 'layers':
      return { panels: ['image'] }
    case 'genes':
    case 'annotations':
      // Clusters belong to Cells (D4).
      return { panels: ['cells'] }
    case 'transcripts':
      return { panels: ['transcripts'] }
    case 'roi':
      return { tool: 'box' }
    case 'magic-lens':
      return { tool: 'magic-lens' }
    case 'cell':
      // The Cell tab also held the embeddings, which belong to Cells.
      return { panels: ['cells', 'embedding'], card: 'cell' }
    default:
      return {}
  }
}

// The link as the shell reads it: an old `tab=` fills `panel=`, `tool=`
// and `card=` where the link does not set them. A version 1 link wrote
// `tab=dataset` whatever was open, so that one opens nothing.
export function withShellLink(state: ShareableState): ShareableState {
  const versionOneDefault =
    (state.linkVersion ?? 1) < 2 && (state.activeTab ?? 'dataset') === 'dataset'
  const mapped = versionOneDefault ? {} : mapControlHudTab(state.activeTab)

  return {
    ...state,
    ...(state.panels === undefined && mapped.panels !== undefined
      ? { panels: mapped.panels }
      : {}),
    ...(state.tool === undefined && mapped.tool !== undefined
      ? { tool: mapped.tool }
      : {}),
    ...(state.card === undefined && mapped.card !== undefined
      ? { card: mapped.card }
      : {}),
  }
}

export function parseActiveTool(value: string | undefined): ActiveTool | undefined {
  return TOOL_ORDER.find((tool) => tool === value)
}

// `tool=`, or a version 1 link's `lens=1`.
export function toolFromLink(state: ShareableState): ActiveTool {
  return (
    parseActiveTool(state.tool) ?? (state.magicLensActive === true ? 'magic-lens' : 'pan')
  )
}

// `panel=` lists exactly what is open: `panel=info` is the drawer with every
// section closed.
export function panelsFromLink(state: ShareableState): ShellPanelState {
  if (state.panels === undefined) return DEFAULT_SHELL_PANELS

  return {
    expanded: LAYER_SECTION_IDS.filter((id) => state.panels?.includes(id)),
    infoOpen: state.panels.includes('info'),
    embeddingOpen: state.panels.includes('embedding'),
  }
}

// Left out at the default; with the drawer or embedding open, the default
// sections are written out.
export function panelsForLink(
  panels: ShellPanelState,
  defaultExpanded: readonly LayerSectionId[],
): readonly ShellPanelId[] | undefined {
  if (panels.expanded === null && !panels.infoOpen && !panels.embeddingOpen) {
    return undefined
  }

  return [
    ...(panels.expanded ?? defaultExpanded),
    ...(panels.infoOpen ? (['info'] as const) : []),
    ...(panels.embeddingOpen ? (['embedding'] as const) : []),
  ]
}

// `card=` restores a selected cell (`cell:<id>`), Visium HD bin (`bin:<id>`)
// or drawn boundary without a cell (`boundary:<id>`); the other cards come
// back from the link's selection (`roi=`) and tool.
export type LinkedCardKind = 'cell' | 'bin' | 'boundary'

export interface LinkedCard {
  readonly kind: LinkedCardKind
  readonly id: string
}

const LINKED_CARD_KINDS: readonly LinkedCardKind[] = ['cell', 'bin', 'boundary']

export function cardFromLink(state: ShareableState): LinkedCard | null {
  const card = state.card ?? ''
  const separator = card.indexOf(':')
  const kind = LINKED_CARD_KINDS.find(
    (candidate) => candidate === card.slice(0, separator),
  )
  const id = card.slice(separator + 1)

  return separator > 0 && kind !== undefined && id.length > 0 ? { kind, id } : null
}

// The card shown, as the card stack picks it: a boundary, then a bin, then
// a cell.
export function cardForLink(selection: {
  readonly cellId?: string | undefined
  readonly binId?: string | undefined
  readonly boundaryId?: string | undefined
}): string | undefined {
  if (selection.boundaryId !== undefined) return `boundary:${selection.boundaryId}`
  if (selection.binId !== undefined) return `bin:${selection.binId}`
  return selection.cellId === undefined ? undefined : `cell:${selection.cellId}`
}

export function layerVisibilityFromLink(state: ShareableState): LayerVisibility {
  const hidden = state.hiddenLayers ?? []

  return {
    image: !hidden.includes('image'),
    cells: !hidden.includes('cells'),
    annotations: !hidden.includes('annotations'),
  }
}

export function hiddenLayersForLink(visibility: LayerVisibility): readonly string[] {
  return HIDEABLE_LAYERS.filter((layer) => !visibility[layer])
}
