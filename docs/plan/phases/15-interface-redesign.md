# Phase 15 — Interface Redesign

Planned 2026-11-11. Milestone M1 (15.0 and 15.1 A, B, C, D, E, G, H, K, M)
and M2 (15.1 F, I, J, L) done 2026-11-11; M3, the new shell (15.2 A–J),
done 2026-11-11: it is the only shell. M4 (15.3 A–D: start screen, Help,
Undo, Cancel) done 2026-11-11. M5 (15.4 A–E: selections, enriched genes,
transcript gene legend, minimap, axes) done 2026-11-11. The 15.5 close-out
(A–F) done 2026-11-12, which completes the phase. The user asked for a
usability review of the
interface and then a plan for the changes. The plan rests on:

- The UI review of 2026-11-10. It walked through eight tasks on the hosted
  Xenium demo (1,414,155 cells) and the Census Visium H5AD, checked them
  against Nielsen's heuristics, and took screenshots at 1440×900, 1024×700 and
  390 px.
- A layout comparison with Vitessce, CELLxGENE Explorer, TissUUmaps 3/4 and
  10x Explorer. The 10x Explorer web viewer was checked hands-on on 2026-11-11.
- A code map of the shell, viewer, tests and docs made on 2026-11-11. It is
  cited below as `file:line`; line numbers drift as the code changes.

The user decided on 2026-11-11:

- a dark theme (D11);
- no transition period for the old tabs (D12);
- examples fetched from GitHub at runtime (D9);
- selected-gene transcript density reopened (D13);
- Magic Lens keeps its name but leaves its tab (D14);
- `@axe-core/playwright` as a dev dependency (D10).

Sizes are for one developer: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

## Goals And Non-Goals

Goals:

- Fix every High and Medium finding in
  [the findings](#findings-from-the-ui-review),
  confirmed by re-running the eight review tasks.
- Move to the 10x Explorer layout model: a top bar, a layer panel organised by
  data type, floating result cards, and canvas tools and legend.
- Meet WCAG 2.2 AA contrast for all text, with no control text below 12 px.
- Keep every feature unless a decision below removes it, on all seven
  platforms: Xenium, Atera, Visium, Visium HD, H5AD, SpatialData and Image.
- Keep existing share links and dataset manifest `defaults` working.

Non-goals:

- A user-arranged multi-view grid like Vitessce's.
- New analysis beyond ranking ROI genes against the rest of the tissue (see
  15.4-B). No differential expression between arbitrary groups and no
  clustering.
- A mobile-first design. Screens under 860 px stay usable but are not
  optimised.
- Data-path performance work, which belongs to the existing optimization pass.

## Findings From The UI Review

| ID  | Finding                                                                                                                                                                          | Severity | Fixed in       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------- |
| F1  | A selected gene silently overrides `Cell color`. Loading clusters while a gene is selected changes nothing on the map (`rendering/cellPointStyle.ts:26–43`).                     | High     | 15.1-A         |
| F2  | There is no legend on the canvas. The colour scale exists only inside the Genes tab.                                                                                             | High     | 15.1-C         |
| F3  | Clicking a cell shows no highlight and does not open its details (`App.tsx:2181–2193`; nothing in `rendering/` draws a selection).                                               | High     | 15.1-D, 15.2   |
| F4  | A failed load wipes the dataset already on screen (`useDatasetLifecycle.ts:912–1030` runs before detection).                                                                     | High     | 15.1-F         |
| F5  | 404, 403 and CORS failures are reported as "Unsupported spatial dataset layout" (`useDatasetLifecycle.ts:1594`).                                                                 | High     | 15.1-E         |
| F6  | The see-through panel over the dark canvas gives text a contrast of 2.2–2.3:1.                                                                                                   | High     | 15.0-A, 15.1-K |
| F7  | 106 of the 116 font sizes are under 11 px, and 48 rules force uppercase.                                                                                                         | High     | 15.1-K         |
| F8  | Developer information sits in the user UI: the deck.gl layer and budget lines, the zoom number, the Log, and the matrix and fallback notices.                                    | Medium   | 15.1-H, 15.2-F |
| F9  | Selecting a second gene silently sums the two into one score, and the colour bar names neither gene nor unit.                                                                    | Medium   | 15.1-A, 15.1-C |
| F10 | Gene search is not ranked (NIPSNAP1 comes before SNAP25), gene chips have no ×, and "No matching genes" appears straight after a pick.                                           | Medium   | 15.1-B         |
| F11 | With genes selected, the transcript layer still shows density for all transcripts, at 85% opacity (`useTranscriptWorkflow.ts:511`).                                              | Medium   | 15.1-J         |
| F12 | Esc does nothing. Tools are three separate flags that only partly exclude each other, and nothing shows that drawing mode is on.                                                 | Medium   | 15.1-G         |
| F13 | Only one ROI at a time. Its top genes are ranked by raw count, and the gene rows can't be clicked.                                                                               | Medium   | 15.4-A, 15.4-B |
| F14 | The Xenium default annotation set "All" stacks 10 clusterings. Clusters are listed twice. H5AD shows raw ID columns, and spot counts include hidden off-tissue spots.            | Medium   | 15.1-I         |
| F15 | There is no start screen and no examples. The demo URL is prefilled with no explanation.                                                                                         | Medium   | 15.3-A         |
| F16 | There is no Copy link button. The URL hash is about 650 characters because it includes defaults. Cluster sets are not shared, and typing in the URL box rewrites the share link. | Medium   | 15.1-L         |
| F17 | Clear and Remove can't be undone, and long queries can't be cancelled.                                                                                                           | Medium   | 15.3-C, 15.3-D |
| F18 | Fit to view assumes a 720 px viewport and ignores the panel (`rendering/overviewViewState.ts:15–60`). At 1024 px wide the panel covers 41% of the canvas.                        | Medium   | 15.2-E         |
| F19 | The page title is "viewer" and there is no favicon.                                                                                                                              | Low      | 15.1-M         |
| F20 | Units are written inconsistently (um, um^2, um2, µm), and some controls are styled differently (a native select, a default-blue slider).                                         | Low      | 15.0-B, 15.1-K |
| F21 | Magic Lens `Min QV` does nothing. This is an existing [open item](../open-items.md).                                                                                             | Low      | 15.2-D         |
| F22 | There is no in-app help, and keyboard shortcuts are mentioned only in screen-reader text.                                                                                        | Low      | 15.3-B         |
| F23 | The embedding is a 300 px scatter plot placed above the Cell info.                                                                                                               | Low      | 15.2-G         |

## Target Design

### Layout (1024 px and wider)

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ Explorer │ Sob23 brain ▾  Xenium · 1.41 M cells · 5,001 genes  ⓘ │ ✋ ▭ ◯ ⟷ ◎ │ ⧉ Share ? ⚙ │ 48 px
├───────────────────────────────────────────────────────────────┬─────────────────────────┤
│ ┌ Selection 1 ──────────── × ┐                                 │ ☑ Image               › │
│ │ 6,229 cells · 0.94 mm²      │                                │ ☑ Cells    graphclust ⌄ │
│ │ Genes │ Cells │ Transcripts │                                │   Colour by [Clusters ▾]│
│ └─────────────────────────────┘                                │   ■ Cluster 1   149,084 │
│                                                                │   ■ Cluster 2   128,390 │
│                         canvas                                 │ ☐ Transcripts         › │
│ ┌ graphclust ─────────────┐                        [−][+][⤢]   │ ☐ Annotations         › │
│ │ ■ 1  ■ 2  ■ 3  … +9      │                        ├─ 2 mm ─┤  │                         │
│ └─────────────────────────┘    X 3,375 µm  Y 5,522 µm          │ 360 px, opaque          │
└───────────────────────────────────────────────────────────────┴─────────────────────────┘
```

- **Top bar** (48 px), left to right:
  - The dataset name. It opens a menu: Open dataset…, Examples, Recent.
  - A summary chip with platform and counts.
  - ⓘ, which opens the dataset info drawer.
  - The tool group: Pan `P`, Box `R`, Lasso `L`, Measure `M`, Magic Lens `O`.
  - Share (copy link), Help `?`, Settings.
- **Layer panel** (right, 360 px, opaque), with sections Image, Cells (titled
  Spots or Bins on those platforms), Transcripts and Annotations.
  - Each header holds a visibility checkbox, the name, a one-line state such
    as "graphclust" or "4 genes · points", and an arrow.
  - Sections stay mounted while collapsed, as HUD panels do today, so local
    state such as a gene search survives.
  - The whole panel collapses to a 40 px strip with `\`.
- **Cards** (top left, 360 px): Selection, Cell or Bin, Transcript, Magic Lens. Each
  card can be closed and has Go to.
- **Canvas furniture:**
  - Bottom left: the legend, plus the progress and notification stack.
  - Bottom right: zoom −, +, Fit, and the scale bar.
  - Bottom centre: the cursor coordinates.
  - The zoom number appears only in debug mode.
- **Info drawer** (left, 380 px, over the canvas) with these sections:
  - Dataset: platform, counts, gene panel, µm/px and where it came from, image.
  - About: the manifest's name, description and source.
  - View options: SpatialData coordinate system, image and scale; Visium
    library.
  - Open another dataset.
  - Diagnostics.
- **Start screen** when no dataset is loaded: a URL field and Open button, an
  example gallery, recent datasets, and a link to the supported formats.
- **Under 860 px:**
  - The tools fold into an overflow menu.
  - The layer panel becomes a bottom sheet that peeks 56 px.
  - Cards become sheets.

### Visual System

- **Tokens** live in `src/styles/tokens.css`:
  - Colour roles: `--surface-0…3`, `--text-1…3`, `--accent`,
    `--accent-contrast`, `--border`, `--focus`, `--danger`, `--warning`,
    `--success`, `--canvas`.
  - Type scale: 11 caption, 12 control, 13 body, 15 title, 18 heading.
  - A 4-point spacing scale, plus radius and shadow tokens.
  - z-index layers: canvas 0–6, legend 8, cards 10, panel 12, drawer 14,
    popover 16, toast 18.
- **Dark theme (D11).**
  - Every surface is near-black or dark grey and opaque. Panel, cards, legend,
    drawer, popovers and start screen all match the black canvas, so they look
    the same over fluorescence, H&E and density layers.
  - Text runs from near-white to mid-grey.
  - The current green and magenta stay as the accent and focus colours,
    lightened until they pass contrast on dark surfaces.
  - `color-scheme: dark` makes native controls and scrollbars match.
  - There is no light theme for now. The tokens leave room to add one later.
- Surfaces are opaque. No backdrop blur behind text.
- Labels and headings use sentence case. Buttons keep their current Title Case
  names, which 160 test queries depend on. No CSS uppercase anywhere.
- One length and area formatter produces µm and µm² everywhere.
- Icons are inline SVG, pinned in the repo. No icon fonts and no CDN.

## Product Decisions

- **DECISION D1 — Layout model.** Use 10x Explorer's model. It is the closest
  match in domain, it groups controls by data type, and it leaves about 75% of
  a 1440 px screen to the canvas. CELLxGENE's two fixed side panels leave about
  49%.
- **DECISION D2 — One source for cell colour.** `Colour by` has six options:
  Clusters (an annotation set), Gene expression, Metadata, Transcript count,
  Cell area, and None.
  - Gene expression is one of these options, never an override.
  - Picking genes in the Cells section switches `Colour by` to Gene
    expression. Picking genes in Transcripts does not.
  - Removing the last gene restores the previous mode.
- **DECISION D3 — One shared gene list** (the URL's `genes=`). Cells use it
  when `Colour by` is Gene expression, and Transcripts use it when the filter
  is Selected genes.
- **DECISION D4 — Clusters belong to Cells**, as 10x Explorer's "Groups" do.
  The Annotations section holds selections and GeoJSON shapes. Choosing a set
  loads it; there is no separate Load button.
- **DECISION D5 — Casing.** Buttons keep Title Case and labels use sentence
  case. The CSS uppercase rules go.
- **DECISION D6 — Developer information** moves to Diagnostics in the info
  drawer. The deck.gl layer and budget lines and the zoom number appear only
  with `?debug=1` or Settings › Show debug info.
- **DECISION D7 — Share URL version 2.**
  - Default values are left out.
  - `panel=`, `card=` and `tool=` replace `tab=`, and version 1 links are
    mapped.
  - `dataset=` follows the loaded dataset, not the text box.
  - Dataset cluster sets are shared through `groups=`.
- **DECISION D8 — Tools are one `activeTool` value.** Esc returns to Pan, and
  finishing a shape returns to Pan.
- **DECISION D9 — Examples are fetched from GitHub at runtime** (user,
  2026-11-11). New examples appear without a new release.
  - The source is the raw `examples/index.json` on `main`. A build can point
    it elsewhere.
  - Gallery links are built from `manifestUrl`, so self-hosted deployments
    link to themselves.
  - If the fetch fails, the start screen still offers the demo dataset.
- **DECISION D10 — No new runtime dependencies for the UI.** Popovers,
  drawers and tooltips are built in-house. The one new dev dependency is
  `@axe-core/playwright`, pinned, for accessibility checks (user,
  2026-11-11).
- **DECISION D11 — Dark theme** (user, 2026-11-11). It ships in 15.0-A, and
  [Visual System](#visual-system) describes it.
- **DECISION D12 — No transition period** (user, 2026-11-11). No tutorials
  depend on the current tabs. The old shell is deleted when the new one
  becomes the default (15.2-J), and old `tab=` links are still mapped.
- **DECISION D13 — Selected-gene transcript density is reopened** (user,
  2026-11-11). This reverses [the reconciliation notes](../history.md#reconciliation-notes) row 10. Density
  follows the gene filter; see 15.1-J.
- **DECISION D14 — Magic Lens keeps its name and leaves its tab** (user,
  2026-11-11).
  - The cursor lens becomes the Magic Lens tool in the top bar (`O`), with its
    results in a Magic Lens card.
  - The viewport scope becomes "Summarise view" in the tool's popover.
  - The ROI scope becomes the Selection card's Transcripts tab.

## Where Each Control Goes

| Today: tab › control                                                 | New home                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Dataset › URL, Morphology/Tissue image, Load Dataset                 | Start screen; Info drawer › Open another dataset                                         |
| Dataset › Boundary limit                                             | Open another dataset › Advanced; Settings                                                |
| Dataset › Bin size (Visium HD)                                       | Bins section                                                                             |
| Dataset › Coordinate system, Image, µm per unit (SpatialData)        | Info drawer › View options (the image choice is also in the Image section)               |
| Dataset › Tissue image, Show off-tissue spots (Visium)               | Image section; Spots section                                                             |
| Dataset › Library (Visium)                                           | Info drawer › View options                                                               |
| Dataset › Diagnose, download, Matrix warning, Fallbacks, Issues, Log | Info drawer › Diagnostics (warnings and fallbacks as one "Data access notes (n)" item)   |
| Dataset › About this dataset                                         | Info drawer › About                                                                      |
| Layers › Layer stack line                                            | Diagnostics, debug mode only                                                             |
| Layers › Cell/Nucleus boundaries, fill and boundary opacity          | Cells › Appearance                                                                       |
| Layers › Hover tooltips, Mouse coordinates unit                      | Settings                                                                                 |
| Layers › Image opacity, Z plane, channels, custom image layers       | Image section                                                                            |
| Layers › Distance measure, Measure unit, Clear Measurement           | Measure tool and its popover                                                             |
| Genes › Search, list, chips, gene sets                               | Cells › Colour by › Gene expression (gene picker)                                        |
| Genes › Signature score, Gene scale                                  | Cells › Gene expression ("Combine genes" when there are 2 or more; colour scale); legend |
| Genes › Expression detail                                            | Cells › Advanced                                                                         |
| Genes › Cell color, Metadata track                                   | Cells › Colour by                                                                        |
| Genes › status line                                                  | Legend footer ("231,404 of 1,414,155 cells express SNAP25")                              |
| Transcripts › all controls                                           | Transcripts section: Display, Genes, Appearance, Filters, and Advanced (budget meter)    |
| Transcripts › status panel, pinned transcript                        | Section header summary; Transcript card                                                  |
| Magic Lens › cursor lens, radius                                     | Magic Lens tool and its popover; Magic Lens card                                         |
| Magic Lens › Viewport scope                                          | Magic Lens popover › Summarise view                                                      |
| Magic Lens › ROI scope                                               | Selection card › Transcripts tab                                                         |
| Magic Lens › Min QV                                                  | Hidden until it changes results                                                          |
| Annotations › set, load/clear, labels, set sizes                     | Cells › Colour by › Clusters (one list: swatch, visibility, name, count, %)              |
| Annotations › Import file/URL, Export                                | Cells › Clusters ⋯ menu                                                                  |
| Annotations › Metadata tracks                                        | Cells › Colour by › Metadata                                                             |
| Annotations › GeoJSON import, export, shapes                         | Annotations section                                                                      |
| ROI › Draw Box, Draw Lasso, Clear                                    | Top-bar tools; Esc; the card's Delete                                                    |
| ROI › name, summary, top genes, Save, exports                        | Selection card                                                                           |
| Cell › Embeddings                                                    | Embedding panel (Cells › Show embedding)                                                 |
| Cell › Cell/Bin info, gene expression, Clear                         | Cell or Bin card                                                                         |
| Shell › Hide Controls                                                | Panel collapse button and `\`                                                            |

## Work Rules

From [Working Rules](../../../PLAN.md#working-rules):

- One checkbox is one reviewable PR, with tests and docs in the same PR.
- A refactor PR does not change behaviour, and a behaviour PR does not
  restructure.
- Every PR passes `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build` and the E2E smoke tests.
- PRs that change UI also go through this **platform checklist**:
  - the Xenium demo;
  - Atera kidney;
  - Census Visium H5AD;
  - the Visium HD reference;
  - PBMC3K H5AD;
  - the SpatialData Visium store;
  - an OME-TIFF and a QPTIFF image.

## 15.0 Foundations

These change almost nothing on screen, but every later step depends on them.

- [x] **A. Dark tokens.** Add `tokens.css` with the dark theme in
      [Visual System](#visual-system), then convert the 12 stylesheets one file at
      a time, replacing about 440 hard-coded colours. (M)
  - This is where the theme changes: the panel, inputs, chips and status
    panels go dark and opaque.
  - Layout, sizes and copy stay as they are.
  - Set `color-scheme: dark` and a dark `theme-color` in `index.html`, so
    native controls and scrollbars match.
  - Done 2026-11-11. All 413 colour literals in the 11 other stylesheets now
    use tokens, and none are left outside `tokens.css`. The five
    `backdrop-filter` blurs are gone and every surface is opaque.
  - Colour roles: four surfaces, three text levels, `--border` and
    `--border-strong`, and `--accent` (green), `--focus` and `--highlight`
    (magenta), `--danger`, `--warning`, with `-soft`/`-border` tints made with
    `color-mix()`. Canvas marks have their own `--overlay-*` tokens.
  - Every text token is at least 5.4:1 on every surface, and each role colour
    on its own tint at least 5.4:1. `--border-strong` is 3:1 against the
    panel, for form controls.
  - Mapping rules: errors and Remove buttons take `--danger`, selected genes
    and transcript hover take `--highlight`, pressed segments become solid
    accent, and hover fills switch their text to `--accent-contrast` or
    `--danger-contrast`.
  - The type, spacing, radius, shadow and z-index tokens are defined but not
    used yet; 15.1-K moves the sizes to them.
  - Not converted: the embedding plot draws on its own canvas with fixed
    colours (`EmbeddingPanel.tsx`). It was already dark.
- [x] **B. Primitives** in `src/components/ui/`: Button, IconButton,
      Segmented, Select, Checkbox, Switch, Slider, NumberField, Chip (removable),
      Disclosure, Popover, Tooltip, Kbd, Card, Drawer, Sheet. (M)
  - Each one requires `title` in its props type.
  - Extend `nativeTitleAudit.test.ts` to check these components and
    `<summary>`; it currently checks only native elements.
  - No existing UI is migrated in this PR.
  - Done 2026-11-11: the 16 primitives, styled in `src/styles/ui.css` with
    tokens only and the new type scale, and exported from
    `components/ui/index.ts`. `title` is the native tooltip on controls, the
    heading of Card and Drawer, the handle text of Sheet, the bubble text of
    Tooltip and the key's meaning on Kbd.
  - Behaviour: NumberField commits on Enter or blur and clamps; Escape
    reverts it. Popover moves focus in and closes on Escape (focus back to
    the trigger) or an outside click. Drawer is not modal, stays mounted
    while closed and returns focus when it closes. Disclosure and Sheet keep
    their content mounted. Tooltip shows after 400 ms of hover or at once on
    focus.
  - `primitives.test.tsx` covers each one, and a line per primitive with
    `@ts-expect-error` makes `tsc` fail if `title` ever becomes optional.
  - The audit now also checks `<summary>` and every component exported from
    `components/ui`. A native control that is the direct child of a Tooltip
    counts as titled, because a native title would show a second tooltip.
- [x] **C. One source for colour scales.** Generate gradient CSS from the
      stops in `rendering/deckLayerColors.ts` with `colorScaleGradient(scale)`.
      Replace the hand-copied gradients in `transcript-controls.css:212–398`. (S)
  - Done 2026-11-11 as two functions, because both families have scales
    called magma, viridis, cividis and teal with different stops:
    `geneExpressionScaleGradient(scale)` and
    `transcriptDensityScaleGradient(scale)`. The 13 CSS rules are gone.
  - The previews now show the map's own opacity (about 0.5 at the low end for
    genes and 0.38 for density). The CSS copies used 0.82 and 0.62. A test
    checks each scale against `geneExpressionColor` and
    `transcriptDensityColor` at 0, 0.5 and 1.
- [x] **D. Test indirection.** Replace `openHudTab`
      (`src/test/appTestHarness.ts:171`) with `openControls(area)`. Area names
      follow the new homes and map to today's tabs, and E2E gets the same helper.
      This touches 75 calls and changes no assertions, so the later shell swap only
      has to edit the helper. (S)
  - Done 2026-11-11. `src/test/controlAreas.ts` maps 20 areas, such as
    `color-by`, `cell-appearance` and `tissue-image`, to today's tabs.
    `openControls` in `appTestHarness.ts` and `tests/e2e/controls.ts` reads it;
    the E2E version returns the panel.
  - Tests that read controls from two future homes now open each area in turn,
    for example `image` and then `cell-appearance` on today's Layers tab.
  - Not covered: tests that use the Dataset tab without clicking it, because
    it is open by default. 15.2-J must add `openControls` calls there.
- [x] **E. Defaults constant.** Add `DEFAULT_SHAREABLE_STATE`, taken from the
      same defaults that `useAppDomainState.ts` uses, plus a test that checks they
      agree. 15.1-L needs it. (S)
  - Done 2026-11-11 in `features/app-shell/shareableDefaults.ts`.
    `useAppDomainState` now reads its starting values from it, and
    `shareableDefaults.test.tsx` checks that the hook starts with exactly these
    values and keeps them when a link spells them all out.
  - Settings that depend on the dataset have no default. Neither does the
    boundary limit, which comes from the device's performance budget, so
    15.1-L must keep writing it.
- [x] **F. Accessibility check.** Add `@axe-core/playwright` (pinned, dev
      only) and run axe in the E2E smoke tests on the main states: the empty
      viewer, a loaded fixture, and each tab open. (S)
  - Today's violations go in a baseline file, `tests/e2e/axe-baseline.json`,
    keyed by rule and target.
  - A new violation fails the test, and the baseline only shrinks.
  - Done 2026-11-11 with `@axe-core/playwright` 4.14.0. A new smoke test,
    "has no accessibility violations beyond the axe baseline", opens every
    tab on the empty viewer and again with the tiny H5AD fixture loaded and a
    gene selected, and runs the WCAG 2.2 A and AA rules each time
    (`tests/e2e/axe.ts`). The other smoke tests do not run axe, so that one
    walk defines the baseline.
  - A listed violation that no state shows any more also fails, so fixes
    must shrink the file. `UPDATE_AXE_BASELINE=1` rewrites it. React `useId`
    values are left out of targets because they change with render order.
  - The baseline has five entries and no colour-contrast entries:
    `aria-allowed-attr` on two gene buttons, `aria-prohibited-attr` on the
    density scale preview, `label-content-name-mismatch` on one button, and
    `scrollable-region-focusable` on a list.
  - The old light theme also had no contrast violations, but only because
    axe cannot work out contrast through a see-through panel over the
    canvas. With opaque surfaces, axe checks 25–43 text nodes per tab and
    finds none below AA, leaving 1–5 per tab unresolved, such as text over
    a gradient. The contrast test in 15.1-K covers what axe cannot.

## 15.1 Behaviour Fixes In The Current Layout

These go into the existing tabs first, so users benefit before the re-layout.
They are independent unless a note says otherwise.

- [x] **A. `Colour by` (F1, F9).** Add `'gene-expression'` to
      `ObservationColorMode` (`rendering/cellStyling.ts:5`). (M)
  - These places should follow the mode instead of `geneExpressionActive`:
    - `cellPointStyle.ts:26–43`
    - the boundary styling (`ViewerCore.tsx:689–718`, `App.tsx:754–761`)
    - the grid styling (`ViewerCore.tsx:627–633`, `App.tsx:773–779`)
    - the fill-opacity boost (`deckLayers.ts:237–245`)
  - Picking a gene sets the mode. Removing the last gene restores the previous
    mode. `Cell color` shows "Gene expression".
  - The manifest's `colorCellsBy` enum gains `gene-expression`
    (`public/schemas/explorer-manifest.v1.json:408`, parser, schema test).
  - Version 1 links that have `genes=` resolve to gene mode, which matches the
    old behaviour.
  - The score select appears only with 2 or more genes, labelled "Combine
    genes".
  - Done 2026-11-11. App.tsx passes the gene expression elements and
    `geneExpressionActive` to the viewer only in Gene expression mode, which
    covers the points, boundaries, grid and the fill-opacity boost in one
    place; `createObservationColorizer` returns null for the mode. With
    SNAP25 selected on the demo, loading clusters now shows the clusters.
  - `colorModeAfterGeneChange` (`genes/geneColorModeModel.ts`) holds the
    rule. Adding a gene in the Genes tab, or applying symbols or a saved
    set, switches to Gene expression; removing the last gene from either
    tab goes back to the last other mode; adding a transcript feature keeps
    the mode.
  - Links and manifests differ. A link always carries `cellColor`, so a link
    with genes opens in Gene expression (`sharedObservationColorMode`). A
    manifest names `colorCellsBy` only on purpose, so it wins, and genes
    without it mean Gene expression (`manifestObservationColorMode`). No
    manifest in `examples/` sets both.
  - Hover details for cells now carry gene counts only in Gene expression
    mode; Cell info still shows them in every mode.
- [x] **B. Gene search (F10).** (S)
  - Rank matches exact, then prefix, then alias prefix, then substring, in
    `filterGeneOptions` (`genes/geneControlsModel.ts:268–300`).
  - Give chips an × with `title="Remove {gene}"`, which E2E already looks for.
  - Clear the query after a pick.
  - Show "{gene} is already selected" rather than "No matching genes"
    (`GeneOptionList.tsx:21`).
  - Apply the same to the transcript feature search
    (`AppTranscriptHudPanel.tsx:157`).
  - Done 2026-11-11. `filterGeneOptions` ranks matches into exact (name or
    alias), name prefix, alias prefix, name substring and alias substring,
    keeping panel order within each rank; "snap" now lists SNAP25 before
    NIPSNAP1. The transcript feature search uses the same function.
  - Selected genes and transcript features are `Chip` primitives (15.0-B)
    whose × is named "Remove {gene}" (or "… from transcript features").
    Tests that clicked a chip by gene name now click its ×.
  - `geneSearchEmptyMessage` names the selected genes a search matches
    ("SNAP25 is already selected", up to three names and "and n more").
    Picking from the Genes list clears the search; the Transcripts search
    already did.
- [x] **C. Canvas legend (F2, F9; needs A).** `ViewerLegend` sits in the
      bottom-left stack as a sibling of `MemoDeckGL`, never inside it. (M)
  - Inputs: colour mode; gene names, score mode, scale and
    `geneExpressionScaleMax`; annotation colours, counts and visibility; the
    metadata track's min and max; the density scale and maximum; the point
    colour mode (`useViewerLayerData.ts:150–246`).
  - Continuous scales show a title, a gradient, and min/max with units.
  - Categories show the first 12 with visibility toggles, then "+k more".
  - It can be collapsed.
  - Extend the no-redraw test (`ViewerCore.test.tsx:1939–1962`) to cover it.
  - Done 2026-11-11. App builds the sections with `viewerLegendSections`
    (`app-shell/viewerLegendModel.ts`); `ViewerLegend` (memoised) only draws
    them, so collapsing it keeps its state local and the deck does not
    redraw. The no-redraw test covers collapsing and a category toggle.
  - Sections: gene expression, annotations (set prefix dropped from labels;
    the checkboxes call the same handler as the Annotations tab), metadata,
    cell area, transcript density, and transcript quality. Transcript count
    is the plain default and has no legend. Feature colours wait for 15.4-C.
  - The bottom-left stack now renders beside the viewport frame, not inside
    it: the frame has `role="img"`, and the axe check flagged the legend's
    checkboxes as nested interactive content.
  - Category lists go after the scales. On the demo, graphclust's 24 labels
    pushed the density scale out of the legend's scroll area.
  - New gradients for the legend share `colorsGradient`
    (`deckLayerColors.ts`): `cellAreaScaleGradient`, `metadataScaleGradient`
    and `transcriptQualityGradient`.
- [x] **D. Selected-cell highlight (F3).** (S–M)
  - For points, spots and bins, draw an SVG ring positioned with
    `rawDataPointToScreen` (`viewerMeasurements.ts:38`), so the deck does not
    redraw.
  - Add a memoised outline layer only while boundaries are drawn, keyed by
    cell ID.
  - A click opens the Cell tab until the cards arrive in 15.2. Esc clears the
    selection.
  - Done 2026-11-11. App describes the selection (`viewerSelectionHighlight`)
    and ViewerCore draws it as SVG next to the deck
    (`ViewerSelectionOverlay`), so selecting never redraws the map. The
    no-redraw test covers it.
  - Instead of a deck outline layer, boundaries are outlined in the same
    SVG: a cell picked as a point is outlined when its boundary is drawn,
    looked up by cell ID, and bins use their polygon. Points without a
    boundary get a ring at least 7 px across.
  - Esc on the canvas clears the selection (Esc for tools comes in 15.1-G).
  - ViewerCore's empty-array defaults are now constants. A parent re-render
    that left those props out used to hand deck.gl new layers.
- [x] **E. Load errors (F5).** At `useDatasetLifecycle.ts:1594`, use
      `detection.checked` (`datasetFactory.ts:1181–1214`) to raise specific
      errors. (M)
  - The kinds are:
    - not found (404, or 403 from a bucket that hides listings);
    - access denied;
    - blocked by CORS (a TypeError on HEAD);
    - unsupported layout, listing what was found.
  - Add these kinds to `errors/loadErrorModel.ts:1–10`, each with a title and
    a next step.
  - The error card offers Run diagnostics.
  - Done 2026-11-11. `classifyDatasetDetection`
    (`datasets/datasetDetectionError.ts`) reads the probes: any readable file
    means "unsupported" (listing what was found); a 401 means access denied;
    all 5xx means a server error; 403 or 404 means not found; no response at
    all means blocked, unless a folder listing ruled every file out. Both
    throw sites (`useDatasetLifecycle`, `createSpatialDataset`) raise a
    `DatasetDetectionError`.
  - `loadErrorModel` adds the codes `not-found`, `access-denied` and
    `blocked`. Each kind has a title and a next step, and the detail lists
    the first six files checked with their answers.
  - Checked in the browser: a missing folder on the Sanger bucket now says
    "Dataset not found" (28 files, HTTP 404), and example.com, which has no
    CORS, says "Request blocked". Both said "Unsupported spatial dataset
    layout" before. The Issues card offers Run Diagnostics.
- [x] **F. Keep the current dataset until the new one loads (F4).** This is its
      own PR and carries the most test work. (L)
  - Add a pending-load slot next to `loadState`.
  - Move the wipe (`useDatasetLifecycle.ts:912–1030`) and
    `onBeforeDatasetLoad` (`App.tsx:1924–1934`) to the success points (about
    :1123, :1462, :1540, :1677).
  - Tie `viewResetKey` (`App.tsx:827`) and the platform adapter to the loaded
    dataset.
  - On failure (:1705–1745), keep the old dataset and show an error toast.
  - Done 2026-11-11, on its own branch for its own PR. `startDatasetLoad`
    gives each load its own `AbortController`. With nothing ready on screen
    it commits at once, as before. With a dataset ready, that dataset stays,
    with its requests running, until the new one reaches its ready point;
    what the load would set before then (platform, boundary toggles, gene
    panel, annotation sets, Visium and SpatialData panels, manifest
    defaults, fallback notices, the Xenium warmup) is queued.
  - Committing aborts the old dataset's `datasetAbortRef` signal, moves
    `loadRequestIdRef` on, runs `onBeforeDatasetLoad` and the old reset,
    then applies the queue and the new data in one render. `viewResetKey`
    and the platform adapter follow, since `loadState` and the platform only
    change then.
  - The reset is rendered on its own first (`flushSync`). Without it a
    Visium library switch, which reloads the same URL, went from ready to
    ready in one render, effects keyed on the dataset's status and URL did
    not rerun, and gene expression stayed cleared (caught by the E2E
    library test).
  - A failure before the commit leaves the screen alone:
    `pendingDatasetLoadState` holds the error, shown by the Issues card and
    a `DatasetLoadToast` ("Dataset not found: missing could not be opened;
    output-XETG… is still open.", with `Dismiss`). While pending it is
    `loading`: the loading list shows the new name and `Load Dataset` is
    disabled, as before. A stalled load cannot be replaced until Cancel
    (15.3-D).
  - The Visium loading state carries the requested library and off-tissue
    choice (`requestedView`), so those controls show it while the old spots
    stay.
  - Checked in the browser on the live demo: a missing folder on the Sanger
    bucket left the demo on screen with the toast; PBMC3K replaced it when
    ready. Unit tests cover the failure, the queue order, a newer load
    dropping a pending one, and the same-URL render; all 20 E2E tests pass.
- [x] **G. Tools (F12).** (M)
  - Replace `magicLensActive`, `measurementEnabled` and `roiMode`
    (`useAppDomainState.ts:238, 366, 395`) with
    `activeTool: 'pan' | 'box' | 'lasso' | 'measure' | 'magic-lens'`.
  - One setter enforces that only one is on. It replaces the logic in
    `App.tsx:2993–3062`, `AppLayerHudPanel.tsx:230–240` and
    `useMagicLensWorkflow.ts:407–420`.
  - Esc cancels an unfinished shape and returns to Pan.
  - Add `onPointerCancel` to the ROI layer.
  - Clear `roiDraft` when the tool changes.
  - Add an `is-drawing` cursor class.
  - Return to Pan after a shape is finished.
  - Keep reading `lens=` from URLs.
  - Done 2026-11-11. `useAppDomainState` holds one `activeTool`
    (`app-shell/activeToolModel.ts`). `magicLensActive`,
    `measurementEnabled` and `roiMode` are derived from it, and their old
    setters are stable adapters over it. The workflows keep their
    interfaces, but turning one tool on turns the others off. The manual
    switching in App, the Layers panel and the Magic Lens workflow is gone.
  - Esc anywhere except a text field returns to Pan (a listener in App).
    Esc on the canvas clears the selection only when no tool is on.
  - ViewerCore drops a half-drawn shape when the ROI tool changes and on
    `pointercancel`, adds `is-drawing` to the frame, and shows a hint at the
    top of the canvas ("Drag to draw a box. Esc cancels."). That hint is what
    tells users a drawing mode is on (F12).
  - Finishing a box or lasso already returned to idle, which is now Pan.
- [x] **H. Developer information (F8).** (S)
  - Show the Layers header lines (`LayerHudPanel.tsx:152–161`) and the zoom
    number (`ViewerCore.tsx:1773–1787`) only in debug mode.
  - Merge Matrix warning and Fallbacks into one "Data access notes (n)" item.
  - Collapse the Log by default.
  - Show "HUD tab:" log lines only in debug mode.
  - Done 2026-11-11. Debug mode is `?debug=1` or `#debug=1`
    (`readDebugModeFromLocation`), read once at start; Settings › Show debug
    info comes with Settings in 15.2.
  - Matrix warning and Fallbacks are one closed `Disclosure`, "Data access
    notes (n)", and the Log is a closed "Log (n)". Both stay mounted.
  - The log held the only "Dataset ready" and "… image ready" lines, which
    15 E2E checks waited for. They now use `expectLogEntry`
    (`tests/e2e/controls.ts`), which opens the log first. A clearer "loaded"
    signal comes with the top bar summary in 15.2-B.
- [x] **I. Annotation sets (F14).** (M)
  - The Xenium default becomes `graphclust` (or the first group), not All.
  - Show one list per set, with the size bars merged into the rows: swatch,
    visibility, name without the set prefix, count and %.
  - For H5AD and SpatialData, put columns that look like IDs
    (`*_ontology_term_id`, `observation_joinid`, or more than 500 categories)
    under "More columns".
  - Leave hidden off-tissue spots out of the counts.
  - Done 2026-11-11. When a Xenium or Atera dataset's sets are listed,
    `defaultAnnotationGroupId` selects graphclust, or the first set, instead
    of All. A link's `groups=` still wins.
  - The Annotations tab shows one list per set (`AnnotationSetLists`): the
    set heading has its total and visibility, and each row has swatch,
    visibility, the name without the set prefix, a size bar, count, % and
    ×. The separate Set sizes plots are gone. Accessible names keep the full
    label ("Remove kmeans 3: Cluster 1").
  - `isIdLikeAnnotationGroup` moves `*_ontology_term_id`,
    `observation_joinid` and sets with more than 500 categories under a
    "More columns" group in the select.
  - With Visium off-tissue spots hidden, `annotationSizePlots` counts only
    placed spots (`placedCellIds`).
  - The set heading is an `h4`, not a `<label>`: the default set for
    imported labels is called "Loaded annotations", and a label would have
    named its checkbox the same as the list.
- [x] **J. Selected-gene transcript density (F11).** This reopens
      [the reconciliation notes](../history.md#reconciliation-notes) row 10, by user decision on 2026-11-11.
      (M–L)
  - When the filter is Selected genes and at least one gene is chosen, request
    density from `/density/gene`. The reader already does this
    (`data/transcriptZarr.ts:300–325`); the workflow switches it off by
    passing `EMPTY_GENE_LIST` (`useTranscriptWorkflow.ts:511`). The request
    key already includes the gene names.
  - With All features, or with no genes chosen, keep the `/grids` density for
    all transcripts, labelled "All transcripts".
  - Normalise the colour to the selected genes' maximum (`scaleMax`). The
    legend reads, for example, "SNAP25 transcripts per 50 µm bin", and the
    hover card shows selected-gene counts.
  - Base Auto's switch from density to points on the selected genes'
    count in view, as Atera already does.
  - Measure time and memory on the demo (5,001 genes) with 1, 8 and 25 genes.
    Set a gene limit from those numbers. Above the limit, say why, and keep
    showing the points.
  - Show the point budget as a meter ("28,724 of 100,000 points", with Edit
    max) instead of number fields.
  - Update `docs/modalities/xenium.md`, and resolve the **Reopened** marks on
    row 10 of the [reconciliation notes](../history.md#reconciliation-notes)
    and on the Phase 5.1 note.
  - Done 2026-11-11. With Selected genes and genes chosen, Xenium density
    counts those genes from `density/gene`; with All features, or no genes,
    it stays the `/grids` density. The layer state carries the genes
    (`featureNames`), so the legend reads "SNAP25 transcripts per 320 µm
    bin" (or "All transcripts per …", "Transcripts in cells per …"), and the
    hover card names the gene, or lists each gene's count.
  - **`density/gene` is stored gene by gene**, `indptr[gene × rows + row]`,
    not row by row as the June reader assumed. On the demo, row 1100's
    pointer for SNAP25 sat at the end of the data. So the old selected-gene
    squares counted the wrong cells, which may be why they were hidden in
    June. A first timing run with the row-by-row reader (13 s and 363 MB for
    the whole slide, whatever the gene count) was measuring that bug.
  - Because each gene's whole-slide entries are contiguous, a gene is read
    once, whole, and kept (8 million entries at most, least recently used
    first out). Measured on the demo, whole slide, Node: 1 gene 0.2 s and
    2.2 MB, 8 genes 0.5 s and 11 MB, 25 genes 1.9 s and 56 MB, plus a
    one-off `indptr` read (10 MB compressed, 75 MB in memory). Later views
    take 3–14 ms. In the browser, SNAP25 over the whole slide took 6.2 s
    while the dataset was still loading, then 46 ms per view.
  - The gene limit is `TRANSCRIPT_GENE_DENSITY_CHUNK_LIMIT`, 32 data chunks
    of new genes per request (about 75 MB, about 30 genes), because gene
    sizes vary. Over it nothing is read, and the panel says to select fewer
    genes or zoom in until exact points load.
  - Squares are the finest 10 µm × 2ⁿ size whose occupied squares fit 1,500
    (320 µm for the whole demo slide, not 1,280 µm from the box alone).
    Colours scale to the largest square on the slide at that size, so they
    hold while panning.
  - **Not done as written:** Auto still switches to points on the
    all-transcript estimate. Xenium exact reads scan every transcript in
    the view (level-0 tiles or Parquet) whatever the filter, so the
    selected-gene count would let a whole-slide view try to read every
    transcript. Atera reads exact points per gene and keeps its
    selected-gene switch.
  - The point budget is a meter, "Exact points: 28,724 of 100,000 points"
    (`TranscriptPointBudget`); `Edit Max` shows the `Exact budget` field.
    The status panel lost its Estimate and Exact budget rows.
  - The reader no longer makes feature-circle glyphs; their renderer code
    is now unused and is left for a cleanup.
- [x] **K. Type and contrast (F6, F7, F20).** (M)
  - Remove the 48 `text-transform: uppercase` rules.
  - Use 12 px for control text and 11 px for captions.
  - Replace the native Visium select and the default slider with the
    primitives.
  - Use the unit formatter in tooltips (`viewerHoverTooltips.tsx`), Cell info
    and the ROI summary.
  - Add a unit test checking every dark token pair used for text and UI parts:
    at least 4.5:1 for text and 3:1 for UI parts.
  - Keep the axe baseline free of colour-contrast entries (15.0-F found
    none after the dark theme).
  - Done 2026-11-11. All 40 `text-transform: uppercase` rules are gone (and
    the `none` overrides that undid them). Every font size uses the type
    scale: 40 sizes from 8.3 to 9.6 px became 11 px captions, 73 from 9.9 to
    12.2 px became 12 px controls, and three became 13 px body text. The HUD
    still fits at 1440 px without overflow.
  - The Visium tissue image select is the `Select` primitive, laid out
    inline. Every slider takes the accent colour from one rule in `base.css`
    instead of the browser's blue; the opacity sliders move from magenta to
    the same accent. The other sliders keep their markup until 15.2 rebuilds
    the panels.
  - `data/units.ts` writes µm and µm² with the micro sign. It is used in the
    hover tooltips, Cell info, Bin info, the ROI summary and the Magic Lens
    radius, replacing "um", "um2" and "um^2". The 11 Greek-mu strings now use
    the micro sign too.
  - `styles/tokens.test.ts` reads `tokens.css` and checks 49 pairs: every
    text and role colour on every surface (4.5:1), role text on its tint
    (4.5:1), text on bright fills (4.5:1), and borders, accent and focus
    against the panel (3:1). The axe baseline still has no contrast
    entries.
- [x] **L. Sharing (F16; needs 15.0-E).** (M)
  - Add a Copy link button (in the Dataset tab now, the top bar later) and a
    "Link copied" toast.
  - Leave defaults out and set `xv=2`.
  - Take `dataset=` from the loaded dataset, not from the box
    (`AppDatasetHudPanel.tsx:126`).
  - Add `groups=`.
  - Version 1 links still parse unchanged; test this.
  - Done 2026-11-11. Links are version 2: `withoutShareableDefaults` drops
    every value equal to `DEFAULT_SHAREABLE_STATE`, keeping a measure unit
    that differs from the mouse unit. The parser records `linkVersion`. For
    version 2 `cellColor` is taken as written; version 1 links keep the
    genes-mean-gene-expression rule from 15.1-A.
  - A loaded Xenium view's link went from about 650 characters to under 200;
    the App test checks this.
  - `dataset=` is the loaded dataset, or the link's own dataset until one
    loads. A failed load no longer rewrites the link.
  - `groups=` carries the loaded dataset annotation set. `AnnotationState`
    records `groupId`, which imports and saved ROIs keep. A link with
    `groups=` loads that set once the dataset's sets are listed
    (`loadAnnotationGroup`).
  - `Copy Link` sits under Load Dataset. It is enabled once a dataset is
    loaded, says "Link copied" for 2.5 s, or says to copy the address bar
    when the clipboard refuses.
  - Known gap: a manifest's `defaults` fill in fields a link leaves out. A
    value that the user set back to the app default is left out of the link,
    so the link reopens with the manifest's value instead. Fix by omitting
    values equal to the manifest-merged defaults of the loaded dataset.
- [x] **M. Title and favicon (F19).** Set the page title to "{dataset} ·
      Spatial Omics Explorer" and add an SVG favicon in `public/`. (S)
  - Done 2026-11-11 (`app-shell/documentTitle.ts`). The name comes from the
    manifest's `name`, or else the URL's last segment, skipping `outs`,
    `explorer.json` and `experiment.xenium`. The title changes only when a
    load finishes. Before any load it is "Spatial Omics Explorer".

## 15.2 Shell Re-Layout

The new shell is built behind `?shell=2` so the app keeps working after every
PR. That flag is for development only. No tutorials depend on the current tabs,
so step J makes the new shell the default and deletes the old one in the same
release, with no transition period. Old `tab=` links keep working through the
mapping in H.

- [x] **A. Section models.** Split the eight HUD panels into blocks that each
      take a view model, all built in App: `useImageSectionModel`,
      `useCellsSectionModel`, `useTranscriptsSectionModel`,
      `useAnnotationsSectionModel` and `useDatasetInfoModel`. (L)
  - The new shell then takes about five models instead of 30–43 separate
    props (Layers 43, Transcripts 43, Annotations 35).
  - This is a refactor only.
  - Done 2026-11-11. `src/features/sections/` holds six models, each built by
    a hook in `App.tsx`:
    - the five above. The cells model has appearance, gene selection and
      colour parts; the annotations model has sets, metadata tracks and
      shapes;
    - `useViewSettingsModel`, a sixth, for hover tooltips, coordinate units
      and the measure tool, which move to Settings and the Measure popover
      in B.
  - The Dataset, Layers, Genes, Transcripts and Annotations tabs now arrange
    blocks (`*Blocks.tsx`) that each take one model or sub-model, so a tab
    takes one to four models. The four `App*HudPanel` wrappers are gone;
    their logging and input normalising moved into the hooks.
  - Magic Lens, ROI and Cell keep their props: D replaces them with cards and
    defines card models.
  - Platform view options (Visium HD bin size; Visium image, library and
    off-tissue spots; SpatialData) stay in the dataset info model. C moves
    bin size, the tissue image and off-tissue spots to their sections.
  - The gene search, gene set drafts and saved sets, and the transcript
    feature search stay in their blocks, so typing does not re-render `App`.
    The annotation URL import flag moved into the model, because the
    Annotations tab unmounts its blocks while hidden.
  - On screen, only `Combine genes` moved: it now sits below the saved gene
    sets, where `docs/ui-reference.md` already listed it.
  - Blocks make their own label IDs; `useAppControlIds` keeps the five that
    Magic Lens, ROI and Cell use.
- [x] **B. Top bar.** (M)
  - The dataset name with its menu, the summary chip and ⓘ.
  - Tools are tied to `activeTool`, and their tooltips show the shortcut.
  - Share, Help and Settings sit on the right.
  - Done 2026-11-11, behind `?shell=2` (`readShellVersionFromLocation`; the
    query string, since the hash is rewritten). The HUD stays under the top
    bar until C replaces it.
    - The dataset name menu holds the open-dataset form; Examples and Recent
      join it in 15.3-A.
    - The summary chip ("Xenium · 1.41 M cells · 5,001 genes", or "Opening
      {name}…") is a `status` region, the loaded signal 15.1-H wanted.
    - ⓘ opens a plain drawer with About, view options and diagnostics; F
      gives it sections and the issue badge.
    - Tools: Pan `P`, Box `R`, Lasso `L`, Measure `M`, Magic Lens `O` (the
      cursor lens, D14). A tool that cannot be used stays focusable and says
      why. While measuring, a popover holds the unit and Clear.
    - `SHORTCUTS` (`src/features/shell/shortcuts.ts`) feeds both the key
      handler and Help, which lists them now; 15.3-B adds the guide links and
      info tooltips.
    - Settings: hover tooltips, coordinate units, boundary limit, and Show
      debug info, which makes debug mode a setting as D6 asked.
    - Pan and Esc share `returnToPan`, and the three ROI tabs and the tools
      share `handleRoiModeChange`.
- [x] **C. Layer panel.** (L)
  - An accordion of Image, Cells/Spots/Bins, Transcripts and Annotations.
  - Each header holds a visibility checkbox and a one-line state.
  - Sections stay mounted.
  - Platform gating moves from `App.tsx:1152–1168` into `platformAdapter.ts`
    as capabilities.
  - Loading tasks are tagged by section instead of by tab
    (`appRuntimeModel.ts:103–310`).
  - The panel can collapse to a 40 px strip.
  - Done 2026-11-11, behind `?shell=2`. The panel is docked, so the canvas
    gets 1,080 px of a 1,440 px window and 1,400 px with the panel collapsed.
    - Sections: Image (opacity, z plane, Visium tissue image, channels,
      custom layers); Cells, Spots or Bins (Appearance with off-tissue spots
      and Visium HD bin size, Colour by, Genes, Clusters per D4, Advanced);
      Transcripts (Display, Genes, Appearance, Filters, Advanced with the
      budget); Annotations (GeoJSON shapes).
    - Header states such as "graphclust", "SNAP25 · density", "3 of 27
      channels" come from `useLayerPanelModel`.
    - The checkboxes hide layers: hidden cells leave deck.gl's layer list
      (`cellsVisible`), so they are not picked, and leave the legend.
      Visibility is not in the link yet (H).
    - Cells is open at first, or the first section on an image.
    - Capabilities `cells` and `magicLens` replace the image check; the HUD
      tab list and the panel sections both read them.
    - Each loading task has an `area` beside its `tabId` for the section's
      loading dot; J drops `tabId`.
    - The HUD keeps Magic Lens, ROI and Cell at the top left until D. The
      Transcripts section keeps the status and pinned transcript until the
      Transcript card (D).
    - The info drawer's view options leave out what moved to sections
      (`DatasetViewOptions placement="drawer"`).
- [x] **D. Cards.** (L)
  - Cards stack at the top left:
    - Selection: cells, Visium HD bins, and the image-geometry variant.
    - Cell or Bin: `CellInfoPanel`, `GridCellInfoPanel`.
    - Transcript: the pinned transcript.
    - Magic Lens: the cursor summary.
  - Magic Lens moves as D14 describes. The tool takes the cursor scope,
    "Summarise view" in its popover takes the viewport scope, and the
    Selection card's Transcripts tab takes the ROI scope. `MagicLensHudPanel`
    is retired.
  - `Min QV` is hidden until it changes results (F21).
  - Done 2026-11-11, behind `?shell=2`. `useCardStackModel`
    (`src/features/cards/`) builds the four cards; each is null while there
    is nothing to show, and closing one clears its state (the selection, the
    cell, the pinned transcript, the lens result). - Selection: the ROI name is the title, with "6,229 cells · 943,210 µm²"
    under it (one µm² formatter, `formatSquareMicrometers`); `ROI name` and
    `Save ROI`; tabs Genes, Cells (Spots, Bins) and Transcripts
    (Expression where the lens counts UMIs or values); the exports. On an
    image, a New shape card names the next shape while Box or Lasso is on. - Magic Lens: the tool's popover has `Radius` and `Summarise View`;
    `handleMagicLensSummarise` switches scope and scans in one step, and
    `handleMagicLensClear` backs the card's close button. The Selection
    card shows only a result for the selection, the Magic Lens card only
    cursor and view results. `MagicLensHudPanel` stays for the old shell
    until J deletes it. - The Transcripts section keeps the overlay status and `Load exact
viewport`; the pinned transcript is in the Transcript card, and the
    canvas tooltip covers hovering. - The HUD keeps only the Cell tab's embeddings, back at the top right of
    the canvas, until G. Go to joins the cards with `zoomToBbox` in E.
- [x] **E. Fit and navigation (F18).** (M)
  - `createOverviewViewState` takes the real viewport size and the space taken
    by the top bar and open panel, instead of 720 px.
  - Add `zoomToBbox`, which the cards' Go to buttons need.
  - Add zoom −, + and Fit buttons. `F` fits; Home still returns to the initial
    view.
  - Done 2026-11-11. The fit (`fitExtentViewState`) uses the canvas as
    measured, less 24 px a side. In the new shell the panel is docked and the
    top bar sits above the canvas, so the measured canvas already leaves them
    out; the old shell's HUD still covers part of it until J.
    - Before the first measurement the fit assumes 720 px, and the first
      measurement fits again. A link's `view` still wins. Level of detail
      measures zoom from the 720 px fit, so cells draw the same at a given
      scale.
    - `zoomToBbox` is a `focusRequest` with a `bbox` (data µm);
      `viewStateForBbox` centres and fits it within the zoom limits. The
      Selection, Cell and Transcript cards have Go To.
    - The new shell has Zoom out, Zoom in (a whole level each) and Fit to
      view above the scale bar, outside the canvas frame (its role is img).
      `F` works anywhere but a text field and is in `SHORTCUTS`; Home returns
      to the first view.
- [x] **F. Info drawer.** (M)
  - Sections: Dataset summary, About, View options, Open another dataset (with
    boundary limit under Advanced), and Diagnostics.
  - An issue count badge shows on ⓘ.
  - Done 2026-11-11. `InfoDrawer` (`src/features/shell/`) has the five
    sections; About and View options appear only when the dataset has them.
    - Dataset lists the platform, exact counts, the image, pixel size and
      address, from `datasetFacts` in the dataset info model. The pixel size
      has no source yet: the loaders do not record where it came from.
    - Diagnostics holds what the Dataset tab's lower half did (the report,
      "Data access notes (n)", load issues, the log), plus the layer stack
      lines in debug mode (D6).
    - The badge counts load issues, and ⓘ's name says how many. The dataset
      name menu also keeps the boundary limit under Advanced.
    - Platform names moved to `PLATFORM_NAMES` in `platformAdapter.ts`, for
      the summary chip and the drawer.
- [x] **G. Embedding (F23).** A floating, resizable panel opened from Cells ›
      Show embedding, using the existing `EmbeddingPanel`. Selection sync stays as
      it is. (M)
  - Done 2026-11-11. `EmbeddingWindow` (`src/features/shell/`) sits at the top
    right of the canvas, 360 × 400 px at first; a grip at its bottom left
    resizes it by pointer or arrow keys, from 280 × 260 px up to the canvas.
    It stays mounted while closed, so it keeps its size.
    - `useEmbeddingModel` (a section model) and `EmbeddingBlocks` feed it;
      the Cell tab keeps its own props until J.
    - `EmbeddingPanel` redraws when its canvas is resized (a
      `ResizeObserver`).
    - The Cells section has Embedding › `Show Embedding`. With the embeddings
      gone from the HUD, the new shell renders no HUD.
- [x] **H. URL panel state.** Add `panel=`, `card=` and `tool=`, and map
      version 1 `tab=` values. (S)
  - dataset → info drawer
  - layers → image
  - genes → cells
  - transcripts → transcripts
  - annotations → cells
  - roi → `tool=box`
  - cell → `card=cell`
  - magic-lens → `tool=magic-lens`
  - Done 2026-11-11. `src/features/shell/shellLinkModel.ts` reads and writes
    them, each left out at its default.
    - `panel=` lists the open layer sections, `info` and `embedding`; App
      now holds that state, so ShellLayout and LayerPanel are controlled.
    - `tool=` is the active tool in both shells and replaces `lens=1`, which
      still opens the lens. A shared link's box, lasso or measure tool
      survives the dataset load's reset.
    - `card=cell:<id>` reselects a cell once the cells load; the other cards
      come back from `roi=` and `tool=`. `card=cell` alone, from a version 1
      `tab=cell`, selects nothing, so that tab also opens the Embedding
      panel, where the Cell tab's embeddings went.
    - `hidden=` keeps the layer checkboxes (15.2-C left this to H).
    - `withShellLink` maps `tab=` when the link sets none of these. A
      version 1 link wrote `tab=dataset` whatever was open, so in one that
      opens nothing; in a version 2 link it opens the info drawer.
- [x] **I. Narrow screens.** Under 860 px: the overflow menu, the bottom sheet,
      and cards as sheets. (M)
  - Done 2026-11-11. `useNarrowScreen` (a `matchMedia` store) switches
    ShellLayout.
    - The tools fold into `ToolMenu`, a popover whose button shows the
      active tool; Share drops its label, the brand hides, and the summary
      chip stays as a hidden status region.
    - The layer panel renders its sections (`variant="sheet"`) in the
      `Sheet` primitive, which peeks 56 px with "Layers" and the Cells
      summary; `\` opens and closes it.
    - Cards dock at the bottom of the canvas as full-width sheets, and the
      Embedding panel takes the canvas's width.
    - Checked at 375 × 812 on the Xenium demo.
- [x] **J. Switch over.** (M)
  - Make the new shell the default.
  - Delete `ControlHudShell`, `AppControlHud`, `CONTROL_HUD_TABS`,
    `control-hud.css` and the `?shell=` flag.
  - Rewrite `docs/ui-reference.md`.
  - Done 2026-11-11. The shell is the only layout; `?shell=` does nothing.
    - Deleted: the HUD shell and its eight tab panels (`DatasetHudPanel`,
      `LayerHudPanel`, `GeneHudPanel`, `TranscriptHudPanel`,
      `MagicLensHudPanel`, `AnnotationHudPanel`, `RoiHudPanel`,
      `CellHudPanel`), `CONTROL_HUD_TABS`, `readShellVersionFromLocation`,
      `useAppControlIds`, the HUD state (`activeControlHudTab`, collapse)
      and each loading task's `tabId`, and blocks only the HUD used
      (`CopyLinkButton`, the measure switch). `control-hud.css` is gone; the
      block styles it held moved to `controls.css`.
    - The transcript capability check runs when the Transcripts section is
      open (it ran when the tab was), and the diagnostics dump records the
      open panels instead of the tab.
    - The info drawer renders its sections only while open, and the cards
      move to its right while it is open, so it never covers them.
    - deck.gl's event root leaves the tab order (it sat focusable inside an
      `aria-hidden` host), which axe found once its walk covered the new
      places. The walk now opens every layer section, the drawer, the
      dataset menu, Help, Settings and the Embedding panel; the baseline lost
      the old HUD's label mismatch.
    - Tests: `openControls` and `CONTROL_AREAS` (unit and E2E) open the
      dataset menu, the drawer, a section, a popover or the Embedding panel.
      Tests that used the Dataset tab without opening it now open the
      dataset menu or Diagnostics, as 15.0-D asked. Tests that drew with
      `Draw Box`, scanned with `Scan Lens` or read `Cell Info` now use the
      tools, `Summarise View` and the cards. Two live tests raced the
      160 ms debounced link write: the Visium library test now waits for
      `genes=` in the link, and the Atera test loads its second link as a
      fresh page instead of a hash change and reload.
    - `docs/ui-reference.md` is rewritten by area (top bar, layer panel,
      cards, Embedding panel, canvas, info drawer, narrow screens), and the
      other docs name the new homes of the old tabs' controls.

## 15.3 Start Screen, Help, Recovery

- [x] **A. Start screen with examples fetched from GitHub (F15).** (M)
  - A URL field and an Open button.
  - **Example gallery.** Fetch the index when the start screen opens, from
    `EXAMPLES_INDEX_URL`.
    - The default is
      `https://raw.githubusercontent.com/cellgeni/explorer/main/examples/index.json`.
    - A build can override it with `VITE_EXAMPLES_INDEX_URL`. This is the
      app's first use of `import.meta.env`, so add the type declaration.
    - Give the request a 5 s timeout and parse it with
      `parseExamplesIndex`. That parser accepts `version: 1`, skips invalid
      entries, ignores unknown fields, and renders text only, never HTML.
    - Keep the result for the session in `sessionStorage`, wrapped in
      try/catch.
    - Each card shows name, platform, description and source/licence.
    - A card opens `?dataset=<manifestUrl>` on the current origin, never the
      entry's `viewerUrl`, so self-hosted copies stay on their own host.
    - If the fetch fails, show "Examples couldn't be loaded from GitHub" with
      Retry, plus the built-in demo dataset (`DEMO_DATASET_URL`). The start
      screen is never empty.
  - Up to 8 recent datasets, which can be removed. They are stored in
    `localStorage`, wrapped in try/catch.
  - A "What can I open?" link.
  - The demo is no longer prefilled in the URL box.
  - `?dataset=` links skip the start screen.
  - Done 2026-11-11. `StartScreen` (`src/features/start/`) covers the canvas
    until a load starts, and comes back with the error above the form when
    a load fails with nothing else open. It has the open-dataset form
    without the boundary limit (Settings has it), "What can I open?" (the
    user guide's Loading data on GitHub), Recent and Examples.
    - `EXAMPLES_INDEX_URL` reads `VITE_EXAMPLES_INDEX_URL`, declared in
      `src/vite-env.d.ts`. `fetchExamplesIndex` gives up after 5 s;
      `parseExamplesIndex` keeps id, name, an http(s) `manifestUrl`,
      platform, description and source (repository, accession, licence, and
      an http(s) link), skips entries without the first three and duplicate
      ids, and stops at 48. The parsed list is kept in `sessionStorage` per
      index URL; Retry clears it. Unit tests read the repository's own
      `index.json` through the parser.
    - The index is read through App's dependencies
      (`dataset.loadExamplesIndex`), so unit tests never reach GitHub, and
      only when the start screen or the dataset menu opens.
    - Cards and recent entries are links to `?dataset=<url>` on this
      deployment. A plain click opens the dataset in place, through the same
      load as `Load Dataset`, so the 15.1-F rules apply and the page is not
      reloaded; a modified or middle click opens a new tab.
    - On failure: "Examples couldn't be loaded from GitHub." (or the
      configured host) with Retry, and `DEMO_EXAMPLE`, the Xenium demo. An
      empty index also shows the demo.
    - Recent (`useRecentDatasets`) records each dataset when it is ready,
      with the name the title uses and its platform, in `localStorage`;
      when storage refuses, the list lasts for the page. Node 25 has a
      `localStorage` global that jsdom does not replace, so tests pass a
      `memoryStorage()`.
    - The dataset name menu lists Recent and Examples under the form, as
      15.2-B left for this step.
    - The store's address starts empty. App tests still start from the
      demo's address, set in `beforeEach`, as if it had been typed.
      `openControls('open-dataset')` uses the start screen while it shows.
    - E2E: every test in `app.spec.ts` answers the index from
      `examples/index.json` (`tests/e2e/examples.ts`). New smoke tests open
      the first example in place (its manifest answered locally and pointed
      at the tiny H5AD), show the fallback with the request failing, and
      skip the start screen for `?dataset=`. A nightly `@live` test in
      `examples.spec.ts` reads the real index. The axe walk covers the start
      screen and the menu; its menu links are 24 px tall for WCAG 2.2
      target size.
- [x] **B. Help (F22).** (S)
  - A `?` popover listing the shortcuts and linking to the user guide and
    dataset docs.
  - The list comes from the same `SHORTCUTS` table the key handlers use.
  - Add info tooltips for LOD, QV, Boundary limit and Combine genes.
  - Done 2026-11-11. Help (`HelpMenu` in `TopBar.tsx`) is controlled, and
    `?` opens and closes it except while typing (`isHelpKey`, which allows
    Shift); `?` is in `SHORTCUTS`. Under the shortcuts, Guides links to the
    user guide, its Loading data section, Host your own data and the UI
    reference on GitHub (`HELP_LINKS`, `shell/docLinks.ts`, which the start
    screen's "What can I open?" also uses), in a new tab.
  - The zoom keys are listed as `+` and `-`, the keys typed; the table said
    `−` (U+2212), which no key types.
  - `InfoTip` is a new primitive (with a required `title`, so the audit and
    the `@ts-expect-error` list cover it): a 24 px ⓘ button named "About
    {term}" with a wrapping Tooltip that describes it. Tooltip gained
    `align="start"` and `wide`, so the text stays inside the layer panel.
  - Tips sit beside `Expression detail` and the Transcripts `Detail` (both
    LOD), `Min QV`, `Boundary limit` (Settings and Advanced) and `Combine
genes`; their texts are in `shell/helpText.ts` and follow
    `docs/ui-reference.md`. `helpText.test.tsx` renders each block and
    checks the description.
- [x] **C. Undo (F17).** (M)
  - Show an Undo toast for 8 s after: Clear selection; delete a selection,
    shape or class; remove an annotation set; Clear GeoJSON; remove a gene
    set.
  - Opening another dataset adds a browser history entry so that Back returns
    to the previous one. Today `useShareableUrlHash` only replaces the entry.
  - Done 2026-11-11. `useUndoToast` (`app-shell/`) holds one offer
    (message and undo); `UndoToast` shows it at the bottom of the canvas in
    a `.viewer-toasts` stack with the 15.1-F load toast. It goes after 8 s,
    except while hovered or focused, which give it the full time again;
    Ctrl+Z or Cmd+Z undoes outside text fields; Undo runs once. A newer
    offer replaces it, and another dataset dismisses it.
  - `useUndoableRemovals` wraps the removals App hands the section models
    and the Selection card: Clear selection (cells and Visium HD bins), a
    class, a metadata track, Clear Annotations (with one selection until
    15.4-A, "remove an annotation set" and "delete a selection" are these),
    a shape and Clear (GeoJSON). Each takes a snapshot first; Undo restores
    it only if the state it covers changed in exactly one commit since (the
    removal's), so it never throws away later work. A cleared selection is
    drawn again under its name, rerunning its queries, unless a newer one
    exists.
  - Saved gene sets live in the gene picker, so `removeSavedGeneSet` offers
    its own Undo through `GeneSelectionModel.onOfferUndo`, which puts the
    set back at its index (`withGeneSetAt`) unless one with that name was
    saved since.
  - History: `useShareableUrlHash` pushes an entry when the link's dataset
    differs from the one the address names (the hash's, else the query
    string's), and replaces it otherwise, so the start screen, a link's own
    dataset and every other change keep one entry. On `popstate` to an
    entry for another dataset it reloads the page, which restores that
    entry's whole link (view, genes, panels), and writes nothing more.
    Loading through history in place would have restored only the dataset.
- [x] **D. Cancel (F17).** (M)
  - Add a Cancel button to tasks that can be cancelled: ROI genes, exact
    transcripts, embeddings, Magic Lens, cell details, diagnostics.
  - Each task maps to its abort ref (`App.tsx:512–532`) and resets its state
    to idle, so it leaves the list.
  - Show a percentage where it is known.
  - Done 2026-11-11. `createLoadingTasks` marks nine tasks `cancellable`
    (`CancellableLoadingTaskId`): the dataset load, diagnostics, transcripts,
    the Magic Lens scan, embeddings, cell details, the cell z distribution,
    ROI cells and ROI genes. `LoadingIndicator` gives each a `Cancel` button
    named after the task ("Cancel querying ROI genes") and never folds them
    into "+n more".
    - App gives ViewerCore one stable `onCancelLoadingTask`, backed by a ref,
      which calls the owning workflow only for a task still in the list. The
      buttons sit in the notification stack, outside `MemoDeckGL`; the
      ViewerCore test checks that a new list, a new percentage and a press of
      Cancel do not re-render deck.gl.
    - Each cancel invalidates the task's request (`invalidateLatestRequest`),
      returns its state to idle and logs "Cancelled …". A cancel is not an
      error and shows no error card.
    - ROI (`useRoiWorkflow`): `handleCancelRoiGenes` keeps the ROI and its
      cells; `handleCancelRoiCells` drops the ROI, as Clear does. Visium HD
      ROI genes use the same request refs, so they cancel too.
    - Transcripts (`useTranscriptWorkflow`): `cancelTranscriptLoad`. The
      loading state keeps the state shown before it (`previousState`), and
      `transcriptLayerCancelled` goes back to it; an earlier error becomes
      idle. `transcriptViewportKeyRef` keeps the cancelled key, so the effect
      does not start the read again for the same view; per-gene (Atera)
      density keeps its own cancelled key. The manual-load key is cleared, so
      `Load exact viewport` shows and works again.
    - Magic Lens: `handleCancelMagicLens` leaves the lens on. Its last query
      key stays, so the cursor lens scans again only when it moves.
    - Embeddings: back to the embeddings on offer
      (`analysisEmbeddingLoadCancelled`), or idle when none were listed.
    - Cell details: `useCellDetailWorkflow` now returns `cancelCellDetails`,
      which stops the details and the z distribution. Neither starts again
      until another cell or dataset is selected.
    - Diagnostics: `handleCancelDatasetDiagnostics`.
  - `useDatasetLifecycle` returns `cancelDatasetLoad`. A pending load
    (15.1-F) is aborted and dropped and the open dataset stays, so a stalled
    load no longer keeps `Load Dataset` disabled. A load with nothing on
    screen is aborted and cleared as a failed one is (`clearUnreadyDataset`,
    now shared with the failure path), with `loadState` idle.
  - Percentages: only the Xenium exact transcript read knows how far it has
    got. `loadTranscriptZarrViewport` reads the view's level-0 tiles one by
    one and reports the share read (`onProgress`); the list shows whole
    percents, and only changes re-render the app. The Parquet metadata step
    after it (up to 1.5 s) runs at 100%. The Parquet exact path, Atera,
    density reads, ROI genes, embeddings, Magic Lens, cell details,
    diagnostics and dataset loads have no count to report and show none.
  - Not cancellable: dataset preparation, the gene panel, images and custom
    layers, boundaries, gene expression, annotation sets and labels, the
    transcript check, Visium HD expression profiles and projection, auto
    contrast and the ROI transcript export. Each could join the same way.
  - Beyond the plan: ROI cells and the cell z distribution can be cancelled
    too, and "transcripts" covers density reads as well as exact points.
  - Tests cover the model, the indicator, the no-redraw check, each
    workflow's cancel (including no restart for the same inputs and the
    transcript layer going back to its earlier points), both dataset-load
    cases, tile progress, and two App tests (diagnostics; a replacing load).

## 15.4 Selections And Analysis

Can be skipped after 15.3 ships if time is short.

- [x] **A. Multiple selections (F13).** (L)
  - List selections in Annotations by class, each with rename, colour,
    visibility, delete and Go to.
  - A new drawing adds a selection, and the card shows the active one.
  - `roi=` stores the active selection.
  - Done 2026-11-11. `useSelectionList` (`src/features/roi/`) keeps the
    selections for the open dataset (and Visium library), with the pure
    `selectionListModel`. It sits above the ROI workflows, which still hold
    one ROI, the active selection's, so cells, genes, exports, Magic Lens and
    Cancel are unchanged.
    - Drawing on cells, spots or bins adds "ROI n" in the next of 8 bright
      colours (the first is the old overlay yellow) and runs it. Choosing a
      name in the list runs it again, since results are not kept per
      selection; the data layer's caches make that quick.
    - The active selection is the list's choice while the workflow holds an
      ROI, so a cancelled cells query or a Visium HD bin size change leaves
      none active and the selection listed.
    - The Selection card's × is now `Close selection`, which keeps the
      selection; `Delete` (danger) removes it. Delete in the card or the list
      offers Undo, which puts it back at its index and, if it was the card's
      and no other is, shows it again. This replaces 15.3-C's Clear selection
      undo. `ROI name` renames the selection. `Save ROI` no longer renames to
      the next "ROI n".
    - Annotations › Selections (`SelectionListBlock.tsx`): swatch, visible,
      the name (`Show {name}`, pressed when active), area, `Go to`, `Rename`
      (inline; Enter or blur keeps, Esc reverts) and `Delete`. The header
      says "2 selections · 1 shape". Not on images, where drawing still makes
      GeoJSON shapes.
    - Canvas: `ViewerCore` takes `selectionOutlines`. The card's selection is
      drawn as before in its own colour (`--selection-color`); other visible
      ones are dashed SVG outlines beside `MemoDeckGL`, covered by the
      no-redraw test. Hiding Annotations hides the dashed ones.
    - `roi=` is still the card's selection. The link replay moved from both
      ROI workflows into the list: it waits until ROI drawing is allowed
      (Xenium preparation, Visium HD bins), so a Visium HD link no longer
      runs before its bins load, and a saved selection with the same outline
      is shown instead of a copy (a Visium off-tissue toggle replays the
      link). While it waits, the address leaves out `roi=`.
    - "By class" is read as one row per selection, as classes are listed;
      selections are not grouped further.
    - A review before the PRs found, and this fixes: the link rounds
      coordinates to 0.001, so a replayed ROI now matches a saved outline
      within that (a Visium off-tissue toggle added a copy); drawing while
      ROI drawing is not allowed (a Visium HD level load, Xenium
      preparation) is kept, as before 15.4-A, and only a link's ROI waits;
      the list is keyed on the SpatialData coordinate system and scale too;
      and coming back to a dataset starts empty, while a reload of the same
      view keeps the list.
- [x] **B. Enriched genes (F13).** (L, with a method note in the docs)
  - The Selection card's Genes tab ranks genes by log2 fold change of mean
    expression inside the selection versus a matched sample outside it, reusing
    the ROI warm-up sample.
  - It shows the % of cells expressing inside and outside, with a minimum %
    filter. "Most abundant" stays as a second sort.
  - Clicking a gene sets `Colour by` to Gene expression.
  - Done 2026-11-11. The method note is in `docs/ui-reference.md` (Selection
    › Genes tab). `roiEnrichmentModel` holds the pure parts: the reference
    sample, the outside filter, the fold change and `rankRoiGenes`.
    - The reference ("matched sample") is one per dataset: 8 runs of 64
      consecutive cells spread through the overview, which is in matrix row
      order, so where the matrix is stored by cell a run reads one or two
      chunks; random cells would touch a chunk each. On Visium HD, runs of
      the loaded bins. On Xenium the overview index is the matrix row, so
      the fast row path is used. The demo's Zarr matrix has no cell-major
      arrays, so its ROI genes read `cell_feature_matrix.h5`: the first read
      took 60 s (as before), then the comparison for a 37,000-cell box took
      91 ms and the 10,000-cell refinement 1.1 s, and the striatum box
      ranked STRIP2, EBF1, BCL11B, DACH1 and PDE10A first.
    - "Reusing the ROI warm-up": the warm-up now also reads the whole
      reference after its 32-cell read, so a selection's comparison (the
      reference cells outside its outline, by `roiSelectionContains`) comes
      from the IndexedDB byte cache. AnnData platforms have no warm-up and
      read it with the first selection.
    - Order per selection: the 32-cell preview, then the comparison, then
      the full refinement. Every read now asks for all genes (`ALL_GENES`),
      not the top 10, so each can be compared. The comparison is its own
      state (`roiReferenceState`) and its errors stay there; Cancel ROI
      genes and Clear reset it.
    - Fold change: log2((mean in + 0.1) / (mean out + 0.1)), means over the
      sampled cells with zeros. Minimum % (default 10%) applies to both sorts;
      up to 20 genes show. Until the comparison is ready, Enriched lists by
      count and says why.
    - A gene's row (`Colour cells by {gene}`) makes it the only selected
      gene and sets Colour by to Gene expression, so each click shows one
      gene; adding it to a list would have shown a combined score.
    - The review before the PRs found that a Visium HD selection with no
      bins returned before cancelling the previous selection's read, so its
      genes (and now its comparison) landed on the empty one; that read is
      now cancelled.
- [x] **C. Transcript gene legend.** Each gene gets a colour swatch, an eye
      toggle and its count, in the Transcripts section and in the legend, as in 10x
      Explorer. Colours can be edited. (M)
  - Done 2026-11-11. `useTranscriptGeneLegend` and the pure
    `transcriptGeneLegendModel` (`src/features/transcripts/`) build one list
    for the Transcripts section (`TranscriptGeneListBlock.tsx`, under Genes)
    and the canvas legend ("Transcripts", the first 12, then "+n more in
    Transcripts").
    - It applies while exact points are coloured by Feature: the selected
      genes in order under Selected genes, or the 24 genes with most points
      in view under All features. Counts are the points loaded in view.
      Density squares and QV colours have no per-gene colour, so the section
      says so instead.
    - Colours: a selected gene takes the first of 12 colours (the first 8
      are the old feature palette) that no other selected gene has, and
      keeps it: the gene list is sorted, so colours by position would move
      when a gene is added. Other genes keep their colour from the name, as
      before. An edited colour is kept per gene for the session
      (`transcriptGeneColors`). Not in the link.
    - The eye hides a gene's points on the client (`hiddenTranscriptGenes`,
      reset per dataset), so nothing is read again. The legend's checkboxes
      are the same eyes: `ViewerLegend` now passes the section id, and App
      routes `transcript-genes` to the genes and the rest to annotation
      classes.
    - The point layer takes the colour and hidden set
      (`transcriptPointsToLayerData` options), looking each gene's colour up
      once. The legend follows the points loaded, not those drawn, so hiding
      every gene in view keeps it (found on the demo: hiding SNAP25, the only
      gene in view, removed the legend).
    - Checked on the Xenium demo at 2 µm scale with GFAP and SNAP25 and
      exact points: four SNAP25 points listed and drawn yellow, hidden and
      shown again from the section and the legend.
    - The review before the PRs found that hidden genes stayed hidden under
      QV colours, where the list and Show All are not shown; hiding now
      applies only while points are coloured by gene.
- [x] **D. Minimap.** (M)
  - Draw the coarsest image pyramid level with a small `TileCache` and
    `drawMorphologyTileChannels` (`rendering/morphologyCanvas.ts:62`).
  - Use `flatImage` for Visium, and the cell extent when there is no image.
  - Draw the viewport rectangle from `viewportBbox`. Click or drag to move the
    view.
  - Done 2026-11-11. `ViewerMinimap` (`src/components/`) with the pure
    `viewerMinimapModel` (layout, view box, click to target, dot sample).
    - It renders a second `MorphologyCanvas` with a view state that fits the
      dataset's extent (`fitExtent`) into the minimap, so the image path is
      the existing one: `bestLevel` picks the coarsest level, and the canvas
      keeps its own `TileCache` (24 tiles, 2 requests), drawn by
      `drawMorphologyTileChannels`; Visium's `flatImage` the same way.
    - With no image it draws up to 6,000 cells (or bin corners) as dots
      rather than an empty extent, so the tissue's shape shows.
    - The view box comes from `viewportBbox`; a click centres the view there
      at the same zoom, and a drag follows the pointer.
    - It is outside `MemoDeckGL`, and the no-redraw test covers showing it.
      Settings › `Show minimap` (on, for the session) and screens under 860
      px hide it.
    - Checked on the Xenium demo: the DAPI channel at its coarsest level,
      98 × 168 px; after zooming in, a click moved the view to that place.
    - The review before the PRs found the minimap blank with every channel
      off; it now shows the dots then, by one rule for both places.
- [x] **E. µm axes.** An optional setting. (S)
  - Done 2026-11-11. Settings › `Show axes` (off, for the session) draws
    rulers along the top and left edges of the canvas
    (`src/components/ViewerAxes.tsx`, `viewerAxesModel.ts`), as the bottom
    edge holds the legend, the readout and the zoom buttons.
    - Ticks are at the smallest 1, 2 or 5 × 10ⁿ at least 80 px apart, in the
      scale bar's unit: µm, image px with `Mouse coordinates` px, or "units"
      for a SpatialData store without a scale. The unit closes the top ruler;
      the left ruler's labels read bottom to top.
    - Ticks under the corner or at the far edge are left out. The rulers are
      `aria-hidden` (the coordinate readout says the same), sit beside
      `MemoDeckGL`, and the no-redraw test covers them.
    - Checked on the Xenium demo: −6,000 to 16,000 µm across the fitted view
      in 2,000 µm steps, and 200 µm steps four zoom steps in.

## Review After M4 (2026-11-11)

The user asked for a review of the work so far before 15.3. Two read-only
passes checked the Done notes against the code and looked for bugs, one over
15.0 and 15.1 and one over 15.2.

Fixed in one PR after 15.3-D:

- A link with `tool=magic-lens` (or a version 1 `tab=magic-lens`) turned
  the lens off when its dataset loaded: the commit set it from `lens=`,
  which version 2 links never write. It now follows the link's tool.
- One Esc press did two things: closing a popover, the drawer, the
  Embedding panel or a tooltip also left the active tool. `useDismiss` now
  takes Escape in the capture phase and marks it handled, the drawer, the
  Embedding panel and a shown tooltip mark theirs, and App's Esc listener
  skips a handled press.
- Removing the last class, or `Clear Annotations`, switched any colour mode
  to transcript count, so cells coloured by a gene lost their colours. Only
  the annotations mode (and metadata, for Clear) changes now.
- Version 2 links dropped `cellBounds=1` and `nucleusBounds=1` as defaults,
  but a load defaults them by platform (nucleus off on Xenium), so turned-on
  nucleus outlines reopened off. Both are always written.
- The legend said "Loading expression" for good when expression failed or
  was waiting; it now says "Expression unavailable".
- Changing a SpatialData view option reloaded the address box, which after a
  failed load (15.1-F) holds the failed URL; it reloads the open dataset.

Open, for 15.5 or later:

- **Load and link state** (fixed in 15.5-A). During a pending load, a
  Visium HD bin or LOD request for the old dataset can still land after the
  new one commits
  (`visiumHdBinRequestId` is not moved on). The commit applies the gene
  scale, density scale, point colour and exact limit captured when the load
  started, undoing changes made meanwhile. `groups=` from the opening link
  is written for another dataset until its annotations load. A link with
  `groups=` ignores its own `cellColor` once the set loads. Copy Link copies
  `location.href`, which is up to 160 ms behind a change.
- **Shell** (the first three fixed in 15.5-B, the rest in 15.5-D).
  `panel=info` alone reopens with Cells expanded. Crossing 860 px
  remounts the layer sections, losing a gene search. `card=` keeps only
  overview cells, not bins or boundary picks. Focus is lost when a card,
  the Embedding panel or the narrow tool menu closes. The tool `toolbar`
  has no arrow-key movement, card tabs no Home and End, the resize grip no
  value, and two annotation headings are out of order.
- **Smaller** (fixed in 15.5-B). The `+` and `-` keys zoom half a level and
  the buttons a whole one. Load errors where every probe answered a 4xx other
  than 401, 403 and 404 are reported as "blocked". "Gene expression" is
  offered in Cell color with no genes. 15.1-I's Atera graphclust default never
  runs (Atera loads through the AnnData path). Esc in the drawer's address
  field closes the drawer.
- **Cleanup** (done in 15.5-C). Unused CSS from the HUD (`.magic-lens-scope-segmented`,
  `.measurement-control*`, `.section-heading-*`, `.status-chip`, `.eyebrow`,
  `.annotation-size-plot*`), the Magic Lens Min QV leftovers
  (`handleMagicLensMinQvChange`, `capabilities.magicLensMinQv`, `lensQv=`),
  the feature-circle renderer (15.1-J), `createOverviewViewState`, and the
  `danger` Button variant. The tokens' "5.4:1 on its own tint" holds on
  surfaces 0–2 only (4.7:1 on surface 3, still AA). The 15.1-L
  manifest-defaults gap is still open (fixed in 15.5-A).

## 15.5 Close-Out

A to C take the open items from the [review after M4](#review-after-m4-2026-11-11)
(user, 2026-11-12: "implement all of 15.5"); D to F are the close-out
proper. The re-run (E) comes after the fixes, so it checks what ships.

The review of 2026-11-10 walked through eight tasks, but this plan never
listed them. Written down in 15.5 from the findings each one turned up:

1. Open a dataset: from the start screen, an example or a typed address (F4,
   F5, F15).
2. Colour cells by a gene and read the legend (F1, F2, F9, F10).
3. Show the clusters and hide one (F1, F14).
4. Inspect one cell (F3).
5. Select a region and read its genes (F12, F13).
6. Show the transcripts of the selected genes (F11).
7. Share the view, and reopen the link (F16).
8. Recover: a bad address, a removal to undo, a long query to cancel (F4, F5,
   F17).

- [x] **A. Load and link state.** (S)
  - Done 2026-11-12.
  - A load's commit now invalidates Visium HD bin-size and LOD reads
    (`visiumHdBinRequestIdRef`, which has no abort controller), so one for
    the old dataset cannot land on the new one.
  - The commit sets the gene scale, density scale, point colour and exact
    limit from the link, or else keeps the current value through a
    functional update. Before, it applied the values captured when the load
    started, undoing changes made while it was pending. The four `controls`
    inputs of `useDatasetLifecycle` are gone.
  - `groups=` from the opening link is kept only for its own dataset, until
    one of its sets loads or the dataset's sets are listed without a match.
    The link's sets are also applied only to that dataset.
  - A link's set loads under the link's own `cellColor`
    (`loadAnnotationGroup(…, { switchColorMode: false })`). A hand-written
    link with neither `xv` nor `cellColor` still colours by the set, as
    choosing it would.
  - `Copy Link` and `Share` copy the link for the current state:
    `useShareableUrlHash` formats the hash at once, writes the address after
    160 ms as before, and returns the current link.
  - The 15.1-L manifest-defaults gap: links leave out values equal to the
    loaded dataset's manifest defaults (kept as `datasetManifestDefaults`)
    rather than the app's, so a value set back to the app default is written.
    An empty `genes=` now means "no genes", for a manifest that sets genes.
- [x] **B. Shell and smaller fixes.** (M)
  - Done 2026-11-12. The shell items of the open list that are not
    accessibility (those are in D), and every "smaller" one.
  - `panel=` lists exactly what is open: `panel=info` is the drawer with
    every section closed. With the drawer or Embedding open and the sections
    at their default, the link writes the default section out
    (`defaultExpandedSections`: Cells, or Image without cells). Version 2
    links from 15.2-H to 15.5 that wrote `panel=info` for "default sections
    and the drawer" now open with the sections closed. An old link's
    `tab=cell` maps to `panel=cells,embedding`.
  - The layer panel and the narrow bottom sheet are one element tree
    (`LayerPanel` with a `sheet` prop; only the header differs), so crossing
    860 px keeps a gene search, a transcript search, a custom layer URL and a
    rename in progress. The `Sheet` primitive had no other use and is gone.
    The sheet's handle sits in an `h2`, like the docked panel's heading.
  - `card=` also restores a Visium HD bin (`bin:<id>`) and an outline with no
    cell (`boundary:<id>`), once loaded in the link's view, and only for the
    link's dataset; another selection first cancels it.
  - `+` and `-` zoom one level, as the buttons do (`ZOOM_STEP`).
  - Detection answered only by other 4xx statuses (400, 405, 410, 429) is
    "Request refused" (`refused`, code `http`) with the statuses, not
    "Request blocked".
  - `Cell color` offers Gene expression once a gene is picked (or while it is
    the mode, as from a link).
  - Atera picks graphclust, or the first set, on the AnnData path too.
  - Esc in a drawer text field, such as the address, leaves the field; a
    second Esc closes the drawer.
- [x] **C. Cleanup.** (S)
  - Done 2026-11-12. Behaviour is unchanged apart from old links' `lensQv=`,
    which had no effect and is now ignored.
  - CSS with no user, found by checking every class in `src/styles` against
    the sources: the HUD's `.magic-lens-scope*`, `.magic-lens-radius-control`,
    `.measurement-control*`, `.section-heading-*`, `.status-chip`, `.eyebrow`
    and `.annotation-size-plot*` rules, plus `.annotation-size-axis`, `-row`,
    `-label`, `-list`, `.annotation-set-toggle` and `.deck-layer-surface`
    (about 300 lines). `diagnostic-check-*` is built from a status and stays.
  - The Magic Lens Min QV chain: `magicLensMinQv` state and its threading,
    `handleMagicLensMinQvChange`, `normalizeMagicLensMinQv`, the query key's
    QV part, `capabilities.magicLensMinQv` and `lensQv=` in links. The open
    item, now under [Phase 5](05-production-polish.md#closed-open-items), is
    closed by its removal.
  - The feature-circle transcript renderer (`createTranscriptFeatureCircleLayer`
    and its branches): no reader made `feature-circle` bins since 15.1-J, so
    `glyphType` is now only `density`.
  - `createOverviewViewState`, which only tests used.
  - The `danger` Button variant stays: 15.4-A's card `Delete` uses it. Its
    `shell-card-delete` class had no CSS and is gone.
  - `tokens.css` says the role-on-tint contrast is 5.4:1 on surfaces 0–2 and
    4.7:1 on surface 3.
- [x] **D. Accessibility pass.** (M)
  - the axe baseline from 15.0-F is empty;
  - a keyboard-only run of tasks 1–5;
  - focus order;
  - ARIA for the accordion, drawer and cards.
  - Done 2026-11-12.
  - **axe.** `tests/e2e/axe-baseline.json` is `{}`. The gene options are a
    `list` whose items carry `aria-setsize` and `aria-posinset` (a button
    cannot); the density scale preview is `role="img"`; the activity log and
    diagnostic check lists, which scroll, take focus and have names. The walk
    now also runs axe's best-practice rules, which found popover headings
    that skipped from `h1` to `h3` and the dataset menu's Recent and Examples
    regions named like the start screen's. A new smoke test checks the Cell
    and Selection cards, where axe found the legend's eyes under the 24 px
    target size of WCAG 2.5.8; legend rows are now 25 px apart.
  - **Keyboard run of tasks 1–5.** It found two tasks that needed a pointer:
    opening a cell (4) and selecting a region (5). While the spatial view has
    keyboard focus a ring marks its centre, and `Enter` opens the bin, or the
    cell or spot nearest the centre within 24 px, as a click would
    (`viewerKeyboardPick.ts`). With Box selection on, `Enter` selects the whole
    view, so a region is framed with the arrows and `+`/`-`. Lasso stays
    pointer-only; a free path is exempt from WCAG 2.1.1. Help lists `Enter`.
    The smoke test "runs the first five review tasks with the keyboard alone"
    does all five on the H5AD fixture with Tab, typing, Enter, Space, arrows
    and tool letters only, and fails if Tab cannot reach a control.
  - **Focus order.** Tab runs: skip link, top bar, info drawer (when open),
    the spatial view, cards, Embedding panel, layer panel, which follows the
    screen from left to right. Focus no longer falls to the page when
    something closes: a card that closes while focused hands focus to the
    card in its place, or the spatial view; a popover closed from inside (a
    tool picked from the narrow menu, a dataset opened from the menu) returns
    it to its trigger; the Embedding panel takes focus when it opens and
    gives it back to `Show Embedding`, as the drawer does (`useFocusReturn`,
    shared with the drawer).
  - **Headings.** The brand is the page's `h1` (read, not shown, under 860
    px). In the layer panel: `h2` Layers, `h3` sections, `h4` sub-headings
    (now also Selections and GeoJSON shapes, which were `h3`), and `h5` for
    a cluster set's name and Metadata tracks (`h4` and `h3` before). The info
    drawer's status panels are `h4` under its `h3` sections (they were `h2`).
    Popovers start at `h2`.
  - **ARIA.** The tool `toolbar` has one tab stop, on the active tool, and
    the arrows, `Home` and `End` move along it. Card tabs take `Home` and
    `End` too. The Embedding grip's description is its size, in a polite
    live region, so it is read after each change; a 2-D grip has no single
    `aria-valuenow`. Checked and unchanged: the layer sections are the APG
    accordion (`h3` > `button[aria-expanded][aria-controls]` > `region`
    labelled by the button); the drawer is a non-modal `dialog` labelled by
    its heading that returns focus on close; each card is a `region` named
    by its heading with a labelled close button; scrollable regions with
    focusable content and focus rings on everything that takes focus
    (`[tabindex='0']` and `summary` were missing one).
- [x] **E. Re-run the eight review tasks** on the Xenium demo and Census
      Visium at 1440, 1024 and 390 px, and record the results in the phase
      record. (S)
  - Done 2026-11-12. `scripts/review-tasks.mjs` runs the eight tasks against
    the dev server in headless Chromium with the GPU, one dataset and width at
    a time (1440×900, 1024×700, 390×844), and saves a screenshot per task and
    a JSON record. It picks and drags only on tissue that no card, legend,
    toast or minimap covers, and under 860 px closes the cards first, as on a
    phone. The first runs found four faults, fixed here, and every task
    passed once they were fixed:

    | Task           | Xenium demo (1.41 M cells)                                                                                                                                                             | Census Visium H5AD (370 spots)                                                               |
    | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
    | 1. Open        | Start screen lists 6 examples; ready 3.9–6.0 s after `Load`                                                                                                                            | Same; ready 1.0–4.6 s                                                                        |
    | 2. Gene        | SNAP25; legend "SNAP25, Expression per cell, 0–11" 3.6–5.3 s later                                                                                                                     | "ACTB" ranks ACTB first; "Expression per spot, 0–85" at once                                 |
    | 3. Clusters    | graphclust (12 classes) recolours the map with SNAP25 still selected; Cluster 1 hidden from the legend                                                                                 | pathologist_annotation, the first set with two or more classes (3); Normal Epithelium hidden |
    | 4. One cell    | Click opens the Cell card with a ring, and its details load                                                                                                                            | Spot card (865–1,824 genes)                                                                  |
    | 5. Region      | Box ROI card, "Compared with 448–512 cells outside", enriched genes (NKX2-1 +1.3), 11–17 s                                                                                             | 13–174 spots, about 3 s                                                                      |
    | 6. Transcripts | Legend "SNAP25 transcripts per 320 µm bin"                                                                                                                                             | Not offered on Visium                                                                        |
    | 7. Share       | `Share` copies a 428–431 character link; it reopens with the set, gene, ROI and cards                                                                                                  | 413–444 characters; same                                                                     |
    | 8. Recover     | A missing address toasts "Dataset not found … is still open"; Undo restores a removed class; `Cancel querying ROI cells` stops a second ROI (at 390 px the smaller box finished first) | Same, but the ROI query finishes before Cancel can be pressed                                |

  - **Fixed: shared loads failed when their first caller cancelled.** On
    Xenium a cell opened, or an ROI drawn, in the first 30 s after load stayed
    on "Loading" for good: its details, its z distribution and the ROI genes
    (over two minutes in a probe, with no request open). The range probe
    (`assertHttpRangeSupport`) is cached per file and ran under its first
    caller's signal, here the viewport warm-up ("Preparing cell feature
    matrix"), which the new cell or ROI cancels. The other callers got its
    `AbortError`, took it for their own and stopped silently. A `sharedLoad`
    (`src/utils/sharedLoad.ts`) now runs the probe, the whole-file H5 matrix
    (`loadH5Matrix`) and Visium HD's `feature_slice.h5` under its own signal,
    aborted only when every caller has; each caller stops at its own signal.
    In the probe the cell's 376 genes now arrive about 20 s after the click,
    and task 5 takes 15 s instead of 25.
  - **Fixed: cards covered the legend.** A tall card at 1440 px hid the legend
    and loading list. The card stack now ends 12 px above them (at least 240
    px tall) and scrolls; `ShellLayout` measures them into
    `--canvas-bottom-left-height`.
  - **Fixed: the failed-load toast covered the loading list's Cancel buttons.**
    Wider than 860 px, toasts centre between the legend and loading list and
    the minimap (`--canvas-bottom-left-width`, measured from the stack's widest
    child, and `--canvas-bottom-right-width`).
  - **Fixed: the Visium legend counted spots hidden off the tissue** (4,992 for
    a set the panel counted as 370). It uses the panel's placed-cell count
    (`placedAnnotationCellCount`, 15.1-I), and says spot or bin instead of cell
    on Visium and Visium HD.
  - **The findings the tasks cover hold:** F1 (task 3), F2 (2, 3, 6), F3 (4),
    F4 and F5 (8), F9 and F10 (2), F11 (6), F12 (5: the tool hint, Esc), F13
    (5 and 8: a second ROI, ranked genes), F14 (3: graphclust is the default
    set; Visium counts), F15 (1), F16 (7), F17 (8), and F18 (the 1024 px fit
    sits beside the panel). F6–F8 were checked by axe in D and in the
    screenshots.
  - **Recorded, not fixed** (in [Open Items](../open-items.md)):
    - For up to 4 s at a time in the first 30 s after the Xenium demo loads,
      the page does not respond: the viewport warm-up reads cells and a matrix
      sample on the main thread (the open item on main-thread exceptions).
    - Under 860 px an open card's sheet, up to 55% of the height, covers the
      legend, the zoom buttons and the minimap. Pinch, `F` and closing the
      card still work. (Fixed 2026-11-12; see
      [Closed Open Items](#closed-open-items).)
    - At 1024 px with the loading list showing there is no room between it
      and the minimap, so a toast overlaps one of them until dismissed.
      (Fixed 2026-11-12.)
    - Visium still says "cells" in the Clusters set total, Metadata track
      counts ("4,992 cells", every obs row) and the gene summary ("359
      positive cells across 370 slide cells").
    - No link parameter carries hidden classes, so the reopened view shows
      Cluster 1 again. (Fixed 2026-11-12: `hiddenClasses=`.)

- [x] **F. Record the outcome** in this phase, and update the out-of-date test
      inventory in [Testing And CI](../engineering.md#testing-and-ci). (S)
  - Done 2026-11-12. Phase 15 is complete, measured against its
    [goals](#goals-and-non-goals):
    - Every High and Medium finding (F1–F18) has its fix. The re-run (E)
      confirmed the ones the eight tasks reach; contrast and text size (F6,
      F7) rest on 15.0-A and 15.1-K and the axe walk, now with an empty
      baseline and best-practice rules (D).
    - The layout is the 10x Explorer model (15.2), the only shell.
    - Share links: version 1 links still open (15.1-L), and links leave out
      the dataset manifest's defaults rather than the app's (15.5-A). One
      meaning changed: `panel=info` from 15.2-H to 15.5 now opens with the
      sections closed (15.5-B).
    - Nothing is left from the [review after M4](#review-after-m4-2026-11-11).
      The re-run's open items are in [Open Items](../open-items.md).
  - [Testing And CI](../engineering.md#testing-and-ci) has a new inventory (2026-11-12) and its open list
    is updated: CI runs on every PR; coverage, SpatialData E2E and a
    Xenium-shaped golden bundle are still open.

## Testing

- **Unit tests.** Each new model gets pure tests: colour-mode resolution, gene
  ranking, error classification, version 1 → version 2 share state, `tab=`
  mapping, the shortcut table, fit with panel space, and contrast across token
  pairs.
- **Component tests.** Sections and cards are rendered directly, as the
  current panel tests already do. Those tests break only when a label changes.
- **`App.test.tsx`.** 45 of its 57 tests open tabs. After 15.0-D they all go
  through `openControls()`, so the shell swap only edits that helper.
- **E2E.**
  - All 13 tests in `app.spec.ts` click tabs. The 7 smoke tests stay in CI.
  - Add one test per review task (tasks 1–5) on fixtures. The axe check from
    15.0-F runs in every smoke test.
  - Live tests stay nightly.
  - `examples.spec.ts` keeps its status-text checks.
  - Smoke tests serve the examples index from the local
    `examples/index.json` through `page.route`. They also cover the "couldn't
    be loaded" fallback, so CI never depends on GitHub. One nightly live test
    fetches the real index.
  - A live Xenium test checks that selected-gene density names the gene in
    its legend and hover card.
- **Redraw guard.** Every new canvas overlay goes in the no-redraw test.
- **Screenshots.** Take them for review in PRs: start screen, each section,
  and each card at 1440×900. Use headless Chromium with
  `--use-angle=metal --enable-gpu`, which gets the real GPU on Apple Silicon.
  They are not pixel baselines, because GPU output varies.

## Docs To Update

Each PR updates the docs it affects. The full list:

- `docs/ui-reference.md`: rewrite by area (top bar, sections, cards, canvas,
  info drawer, start screen, settings, URL parameters) in 15.2-J. Edit it
  piece by piece before then.
- `docs/user-guide.md`: rewrite the task walkthroughs for the new layout.
- `docs/dataset-manifest.md`, plus `public/schemas/explorer-manifest.v1.json`
  ("Dataset tab" at :26, :146, :381; control names at :409–426; the
  `colorCellsBy` enum).
- `docs/architecture.md`: shell structure and platform gating.
- Control names in `docs/modalities/*.md`, `docs/host-your-own-data.md`,
  `docs/image-only-and-geojson.md` and `docs/zchunkstore.md`.
- `README.md:135`, `docs/README.md:10`, and `examples/README.md:29`. The
  examples README should also say that the app reads `index.json` from `main`
  at runtime.
- `docs/deploy-to-s3.md`: the start screen fetches from
  raw.githubusercontent.com, and `VITE_EXAMPLES_INDEX_URL` can change that.
- `docs/modalities/xenium.md`: selected-gene density.
- This plan: the phase record, plus row 10 of the reconciliation notes and the
  Phase 5.1 note
  once 15.1-J ships.

## Risks

| Risk                                                                 | Effect                                                                | Mitigation                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| New overlay props make `DeckGL` redraw                               | About 9 s per interaction in headless tests, and stutter on real GPUs | Put overlays next to `MemoDeckGL`, not inside it; memoise `controller` and `layers`; extend the no-redraw test   |
| Moving panels makes prop lists even longer                           | `App.tsx` gets harder to change                                       | Build the section models (15.2-A) before the new shell                                                           |
| Test churn (about 96 assertions depend on tabs, 228 on button names) | Slow PRs                                                              | Add the `openControls` helper first; keep button names; change casing only in CSS                                |
| Breaking share links or manifests                                    | Saved views stop working                                              | Keep the version 1 parser; add mapping tests; only add to the manifest enum                                      |
| 15.1-F changes how datasets load                                     | Load regressions                                                      | Its own PR, with tests on each platform and a live E2E run                                                       |
| Seven platforms with different controls                              | A platform's control gets missed                                      | Run the platform checklist on each PR; gate on capabilities                                                      |
| 15.4 grows                                                           | The redesign is delayed                                               | 15.4 is optional after 15.3                                                                                      |
| Wrapper components dodge `nativeTitleAudit`                          | Unlabelled controls get through                                       | Extend the audit to the primitives (15.0-B)                                                                      |
| The examples fetch fails (GitHub down, offline, blocked network)     | The start screen has no examples                                      | 5 s timeout; offer the demo dataset and a Retry; keep the result for the session; CI routes the request locally  |
| GitHub's raw cache (about 5 min) or a bad `index.json` on `main`     | New examples appear late, or the gallery breaks                       | A tolerant parser that skips bad entries; `npm run examples -- --check` stays in CI                              |
| Selected-gene density is slow with many genes                        | Slow panning with large gene sets                                     | Done in 15.1-J: each gene is read once and kept; over 32 new chunks (about 30 genes) nothing is read, with a why |

## Order And Size

| Milestone                  | Contents                                 | Size            | Fixes                                          |
| -------------------------- | ---------------------------------------- | --------------- | ---------------------------------------------- |
| M1 — Honest canvas         | 15.0 A–F; 15.1 A, B, C, D, E, G, H, K, M | about 7 weeks   | All High except F4; F8, F9, F10, F12, F19, F20 |
| M2 — Safe loading, sharing | 15.1 F, I, J, L                          | about 4 weeks   | F4, F11, F14, F16                              |
| M3 — New shell             | 15.2 A–J                                 | about 8–9 weeks | F3 (cards), F8 (drawer), F18, F21, F23         |
| M4 — Getting started       | 15.3 A–D                                 | about 2 weeks   | F15, F17, F22                                  |
| M5 — Selections            | 15.4 A–E                                 | about 4 weeks   | F13                                            |

- **Critical path:** 15.0-D → 15.1-A → 15.1-C → 15.2-A → 15.2-C → 15.2-J.
- **Can run in parallel:** 15.1-E and F (loading) alongside 15.1-A to D
  (colour and legend). 15.1-J (density) can start at any time, but its legend
  text needs 15.1-C.
- **Dark theme timing:** the dark theme arrives with the tokens in 15.0-A, so
  users see it in the first release, before the layout changes.
- **Releases:** tag a release after each milestone. M1 alone fixes most of
  what the review found.
- **Effort:** these sizes add up to about 6 months for one developer working
  without help. M1 and M2 together are about 40% of the effort.

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Sequencing:

- [x] Interface redesign, [Phase 15](#phase-15--interface-redesign): 41 tasks
      in five milestones. Milestones M1 (15 tasks) and M2 (4 tasks) are done;
      M3, the new shell (15.2), is done; M4 (15.3: start screen, Help, Undo,
      Cancel) is done; M5 (15.4: selections, enriched genes, transcript gene
      legend, minimap, axes) is done. The 15.5 close-out is done
      (2026-11-12).

Found by the [15.5-E](#155-close-out) re-run (2026-11-12):

- [x] Under 860 px an open card's sheet (up to 55% of the height) covers the
      legend, the zoom buttons and the scale bar. (The minimap is already
      hidden under 860 px.) Since 2026-11-12 `ShellLayout` measures the sheet
      into `--canvas-bottom-sheet-height`, and the zoom buttons, scale bar,
      pointer readout and legend stack sit above it; the legend scrolls in the
      room left.
- [x] At 1024 px with the loading list showing, a toast has no room between
      the list and the minimap and overlaps one of them. Partly fixed in 15.5-E:
      toasts centre in the gap, but keep a 280 px minimum width, so a narrower
      gap still overlaps. Since 2026-11-12, where the gap is under 304 px
      (280 plus 12 each side) the canvas gets `data-toast-raised` and toasts
      centre on it above both corners (`--toast-bottom`), never off the top.
- [x] Links do not carry hidden classes, so a shared view shows them again.
      Since 2026-11-12 `hiddenClasses=<id>,<id>` carries them (`%` and `,`
      inside an ID are escaped); they are applied once the link's set or
      annotation URL loads, and IDs not in the loaded labels are dropped.
