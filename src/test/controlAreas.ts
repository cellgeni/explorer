import type { ControlHudTab } from '../features/app-shell/appShellModel'

// Where tests find each group of controls. Area names follow the Phase 15
// layout (UNIFIED_PLAN.md, "Where Each Control Goes"), and each maps to the
// Control HUD tab that holds those controls today. Unit and E2E tests open
// controls only through openControls(), so a shell change edits this table
// and the two helpers, not the tests.
export const CONTROL_AREA_TABS = {
  // Start screen; info drawer › Open another dataset.
  'open-dataset': 'dataset',
  // Info drawer › Dataset and About.
  'dataset-info': 'dataset',
  // Info drawer › View options: SpatialData coordinate system, Visium library.
  'view-options': 'dataset',
  // Info drawer › Diagnostics: diagnose, data access notes, activity log.
  diagnostics: 'dataset',
  // Spots or Bins section: off-tissue spots, Visium HD bin size.
  'spot-options': 'dataset',
  // Image section: the Visium tissue image.
  'tissue-image': 'dataset',
  // Image section: opacity, channels, Z plane, custom image layers.
  image: 'layers',
  // Cells › Appearance: boundaries and their opacity.
  'cell-appearance': 'layers',
  // Measure tool and its popover.
  measure: 'layers',
  // Settings: hover tooltips, mouse coordinate unit.
  settings: 'layers',
  // Diagnostics, in debug mode only: the deck.gl layer stack.
  'layer-stack': 'layers',
  // Cells › Colour by, including the metadata track.
  'color-by': 'genes',
  // Cells › Gene expression: picker, gene sets, combining, scale, detail.
  genes: 'genes',
  // Transcripts section.
  transcripts: 'transcripts',
  // Magic Lens tool, its popover and card.
  'magic-lens': 'magic-lens',
  // Cells › Clusters: annotation sets, labels, import and export.
  clusters: 'annotations',
  // Annotations section: GeoJSON shapes.
  shapes: 'annotations',
  // Selection tools and the Selection card.
  selection: 'roi',
  // Cell or Bin card.
  'cell-card': 'cell',
  // Embedding panel.
  embedding: 'cell',
} as const satisfies Record<string, ControlHudTab>

export type ControlArea = keyof typeof CONTROL_AREA_TABS
