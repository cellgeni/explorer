// Where tests find each group of controls. Area names follow the Phase 15
// layout (UNIFIED_PLAN.md, "Where Each Control Goes"); each maps to the part of
// the shell that holds those controls. Unit and E2E tests open controls only
// through openControls(), so a layout change edits this table and the two
// helpers, not the tests.
export type ControlAreaPlace =
  // The start screen while it shows, else the dataset name's menu in the
  // top bar.
  | { readonly kind: 'dataset-menu' }
  // ⓘ's info drawer.
  | { readonly kind: 'info-drawer' }
  // A layer panel section, by the start of its header's name.
  | { readonly kind: 'section'; readonly section: RegExp }
  // A top bar popover, by its title.
  | { readonly kind: 'popover'; readonly title: string }
  // Cells › Show Embedding.
  | { readonly kind: 'embedding' }
  // Shown on their own, such as cards, which appear with what they show.
  | { readonly kind: 'none' }

const CELLS_SECTION = /^(Cells|Spots|Bins)/

export const CONTROL_AREAS = {
  // Start screen; the dataset name menu; info drawer › Open another dataset.
  'open-dataset': { kind: 'dataset-menu' },
  // Info drawer › Dataset and About.
  'dataset-info': { kind: 'info-drawer' },
  // Info drawer › View options: SpatialData coordinate system, Visium library.
  'view-options': { kind: 'info-drawer' },
  // Info drawer › Diagnostics: diagnose, data access notes, activity log.
  diagnostics: { kind: 'info-drawer' },
  // Spots or Bins section: off-tissue spots, Visium HD bin size.
  'spot-options': { kind: 'section', section: CELLS_SECTION },
  // Image section: the Visium tissue image.
  'tissue-image': { kind: 'section', section: /^Image/ },
  // Image section: opacity, channels, Z plane, custom image layers.
  image: { kind: 'section', section: /^Image/ },
  // Cells › Appearance: boundaries and their opacity.
  'cell-appearance': { kind: 'section', section: CELLS_SECTION },
  // The Measure tool's popover, while measuring.
  measure: { kind: 'popover', title: 'Measure options' },
  // Settings: hover tooltips, mouse coordinate unit, boundary limit.
  settings: { kind: 'popover', title: 'Settings' },
  // Diagnostics, in debug mode only: the deck.gl layer stack.
  'layer-stack': { kind: 'info-drawer' },
  // Cells › Colour by, including the metadata track.
  'color-by': { kind: 'section', section: CELLS_SECTION },
  // Cells › Gene expression: picker, gene sets, combining, scale, detail.
  genes: { kind: 'section', section: CELLS_SECTION },
  // Transcripts section.
  transcripts: { kind: 'section', section: /^Transcripts/ },
  // The Magic Lens tool's popover: radius and Summarise View.
  'magic-lens': { kind: 'popover', title: 'Magic Lens options' },
  // Cells › Clusters: annotation sets, labels, import and export.
  clusters: { kind: 'section', section: CELLS_SECTION },
  // Annotations section: GeoJSON shapes.
  shapes: { kind: 'section', section: /^Annotations/ },
  // The selection tools are in the top bar; the Selection card shows a
  // selection.
  selection: { kind: 'none' },
  // Cell or Bin card.
  'cell-card': { kind: 'none' },
  // Embedding panel.
  embedding: { kind: 'embedding' },
} as const satisfies Record<string, ControlAreaPlace>

export type ControlArea = keyof typeof CONTROL_AREAS
