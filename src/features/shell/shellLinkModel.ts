import type { ShareableState } from '../../data/shareableState'
import type { ActiveTool } from '../app-shell/activeToolModel'
import type { LayerVisibility } from '../app-shell/useAppDomainState'
import type { LayerSectionId } from './layerPanelModel'
import { TOOL_ORDER } from './shortcuts'

// The new shell's part of a share link (UNIFIED_PLAN.md, 15.2-H, D7):
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
  // Null until someone opens or closes a section: Cells, or the first one.
  readonly expanded: readonly LayerSectionId[] | null
  readonly infoOpen: boolean
  readonly embeddingOpen: boolean
}

export const DEFAULT_SHELL_PANELS: ShellPanelState = {
  expanded: null,
  infoOpen: false,
  embeddingOpen: false,
}

// A current-shell tab, as the new shell reads it.
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
      // The Cell tab also held the embeddings.
      return { panels: ['embedding'], card: 'cell' }
    default:
      return {}
  }
}

// The link as the new shell reads it: an old `tab=` fills `panel=`, `tool=`
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

export function panelsFromLink(state: ShareableState): ShellPanelState {
  if (state.panels === undefined) return DEFAULT_SHELL_PANELS

  const expanded = LAYER_SECTION_IDS.filter((id) => state.panels?.includes(id))

  return {
    // A link that names only the drawer or embedding keeps the sections'
    // default.
    expanded: expanded.length === 0 && state.panels.length > 0 ? null : expanded,
    infoOpen: state.panels.includes('info'),
    embeddingOpen: state.panels.includes('embedding'),
  }
}

export function panelsForLink(
  panels: ShellPanelState,
): readonly ShellPanelId[] | undefined {
  const open: ShellPanelId[] = [
    ...(panels.expanded ?? []),
    ...(panels.infoOpen ? (['info'] as const) : []),
    ...(panels.embeddingOpen ? (['embedding'] as const) : []),
  ]

  return panels.expanded === null && open.length === 0 ? undefined : open
}

// `card=cell:<id>` restores a selected cell; the other cards come back from
// the link's selection (`roi=`) and tool.
export function cellIdFromLink(state: ShareableState): string | null {
  const card = state.card
  return card !== undefined && card.startsWith('cell:') && card.length > 'cell:'.length
    ? card.slice('cell:'.length)
    : null
}

export function cardForLink(selectedCellId: string | null): string | undefined {
  return selectedCellId === null ? undefined : `cell:${selectedCellId}`
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
