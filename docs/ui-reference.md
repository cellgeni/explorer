# UI Reference

Every UI component and user-facing control, with the source file that renders
it and the platforms that show it. For task-oriented instructions see the
[User guide](./user-guide.md); for how data reaches the UI see
[Architecture](./architecture.md).

Platform names used below: **Xenium**, **Atera**, **Visium**, **Visium HD**,
**H5AD**, **SpatialData**, **Image** (image-only sources).

## Layout

The layout follows 10x Explorer (UNIFIED_PLAN.md, Phase 15.2, D1): a top bar,
the canvas, and the layer panel docked on the right.

```text
<main class="app-shell">                       src/App.tsx
├── Skip link "Skip To Spatial View"
└── ShellLayout                                src/features/shell/ShellLayout.tsx
    ├── TopBar (48 px)                         src/features/shell/TopBar.tsx
    └── .shell-body
        ├── .shell-canvas
        │   ├── section.viewer-region → ViewerCore   src/components/ViewerCore.tsx
        │   │   ├── MorphologyCanvas (image tiles)   src/components/MorphologyCanvas.tsx
        │   │   ├── deck.gl canvas (cells, bins, boundaries, transcripts, ROI, shapes)
        │   │   ├── ROI drawing, measurement and Magic Lens overlays, hover tooltip
        │   │   ├── Bottom left: legend, loading indicator, viewport messages
        │   │   ├── Bottom centre: mouse coordinates
        │   │   ├── Bottom right: Zoom out, Zoom in, Fit to view; scale bar
        │   │   └── StartScreen, before a dataset opens   src/features/start/StartScreen.tsx
        │   ├── InfoDrawer (ⓘ, 380 px, left)   src/features/shell/InfoDrawer.tsx
        │   ├── CardStack (360 px, top left)    src/features/cards/CardStack.tsx
        │   └── EmbeddingWindow (top right)     src/features/shell/EmbeddingWindow.tsx
        └── LayerPanel (360 px, right)         src/features/shell/LayerPanel.tsx
```

The panel's sections and the cards are made of blocks from
`src/features/sections/` and `src/features/cards/`, each taking a model built
in `App.tsx` (see [architecture.md](architecture.md#section-models)).

`src/main.tsx` wraps `App` in `AppErrorBoundary`
(`src/components/AppErrorBoundary.tsx`), which shows "Application error" with a
`Retry` button if rendering throws.

The browser tab reads "{dataset} · Spatial Omics Explorer" once a dataset has
loaded. The name is the manifest's `name`, or else the last part of the URL
that is not `outs`, `explorer.json` or `experiment.xenium`. The favicon is
`public/favicon.svg`.

## Start Screen

Until a dataset opens, the canvas shows the start screen
(`src/features/start/StartScreen.tsx`, 15.3-A), "Open a dataset":

- The `Dataset or image URL` field, `Morphology image` and `Load Dataset`.
  The field starts empty. The boundary limit is in Settings.
- "What can I open?", a link to [Loading data](user-guide.md#loading-data)
  in the user guide.
- **Recent**: the last eight datasets opened in this browser, newest first,
  each with its name, platform and address, and a × button (`Remove {name}
from recent datasets`). Kept in `localStorage` (`explorer.recentDatasets`);
  without storage the list lasts until the page closes.
- **Examples**: a card per entry of `examples/index.json` with name,
  platform, description, and source and licence (the source links to the
  repository). The index is read when the start screen or the dataset menu
  first opens, from `EXAMPLES_INDEX_URL`
  (`src/features/start/examplesIndex.ts`): GitHub's raw `main` unless the
  build sets `VITE_EXAMPLES_INDEX_URL`. The request gives up after 5 s, and
  the result is kept in `sessionStorage` for the session. Entries without an
  id, a name or an http(s) manifest URL are skipped, and all text is shown as
  text.
- If the index cannot be read: "Examples couldn't be loaded from GitHub."
  with `Retry`, and the Xenium demo dataset as a card. An empty index also
  shows the demo.

Each example and recent dataset is a link to `?dataset=<url>` on this
deployment, never the index's `viewerUrl`. A plain click opens it in place,
as `Load Dataset` would; a middle or modified click opens a new tab. A link
that names a dataset skips the start screen. If a load fails with no other
dataset open, the start screen comes back with the error above the form
(`role="alert"`).

## Top Bar

| Item           | What it does                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Explorer`     | The app name                                                                                                                                                                                    |
| Dataset name ▾ | The loaded dataset's name (manifest name or folder), or "Open a dataset". Opens a menu with the [open-dataset form](#open-another-dataset), Recent and Examples ([start screen](#start-screen)) |
| Summary        | Platform and counts, e.g. "Xenium · 1.41 M cells · 5,001 genes"; "Opening {name}…" while one loads. A `status` region                                                                           |
| `Dataset info` | ⓘ: opens the [info drawer](#info-drawer). A badge counts load issues, and the name says so: "Dataset info (2 issues)"                                                                           |
| Tools          | Pan `P`, Box selection `R`, Lasso selection `L`, Measure `M`, Magic Lens `O`; the active one is pressed. A tool that cannot be used says why                                                    |
| Measure ▾      | While measuring: `Measure unit` (µm or px, starting at the mouse coordinate unit) and `Clear Measurement`                                                                                       |
| Magic Lens ▾   | `Radius` (10–500 µm, step 10; 80 µm) and `Summarise View`, which scans the whole view into the Magic Lens card                                                                                  |
| `Share`        | Copies the link (the address, which holds the view) and says "Link copied"                                                                                                                      |
| `Help`         | Lists the keyboard shortcuts, from `SHORTCUTS` (`src/features/shell/shortcuts.ts`), the table the key handlers read                                                                             |
| `Settings`     | See [Settings](#settings)                                                                                                                                                                       |

The tool letters, `F` and `\` work anywhere except in a text field, and leave
keys with Ctrl, Alt or Cmd alone (`useToolShortcuts`).

One tool is on at a time (`activeTool`, `src/features/app-shell/activeToolModel.ts`,
D8). Turning one on turns the others off. While a tool other than Pan is on,
the top of the canvas says what to do, such as "Drag to draw a box. Esc
cancels." Esc, anywhere except a text field, returns to Pan and drops a
half-drawn shape; finishing a box or lasso also returns to Pan.

- **Box selection** and **Lasso selection** draw a selection (see
  [ROI drawing](#roi-drawing)); its results open in the Selection card. On an
  image they draw a GeoJSON shape instead.
- **Measure**: drag in the view to measure; see
  [Distance measurement](#distance-measurement).
- **Magic Lens** is the cursor lens (D14): a circle follows the mouse and the
  Magic Lens card summarises the transcripts (Xenium) or expression (Visium
  HD) under it; queries are debounced by 320 ms. It is not offered on images,
  and says "Unavailable" where the platform cannot scan (Atera, Visium, H5AD,
  SpatialData). `Min QV` is hidden, because it changes nothing yet (F21).

### Settings

| Control             | Type              | Default                                    | Notes                                                                             |
| ------------------- | ----------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `Hover tooltips`    | Checkbox          | On                                         | Transcript tooltips ignore it                                                     |
| `Mouse coordinates` | Segmented µm / px | µm                                         | Also sets the scale-bar unit                                                      |
| `Boundary limit`    | Number            | 1–100,000; 2,500 (compact) or 50,000       | Most visible cells before boundary polygons are deferred. Disabled for Visium HD  |
| `Show debug info`   | Switch            | Off, or on with `?debug=1` (or `#debug=1`) | Shows the zoom number, and the deck.gl layer and budget lines in Diagnostics (D6) |

## Layer Panel

The layer panel is an accordion with a section per layer. Each header has a
checkbox that hides the layer (`Show {layer}`), the name, a one-line state and
a dot while the section's data loads; the header button opens and closes the
section. Cells is open at first, or the first section on an image. Sections
stay mounted while closed, so a gene search survives. `Hide layers (\)` (or
`\`) collapses the panel to a 40 px strip and gives the canvas the space.

| Section             | Shown for     | Header state                                         | The checkbox hides                                      |
| ------------------- | ------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Image               | All           | "3 of 27 channels · z 8 of 15 · +1 layer", or "80%"  | The image and custom layers                             |
| Cells (Spots, Bins) | All but Image | What colours them: "graphclust", "SNAP25", "4 genes" | Cells, boundaries and bins, and their legend            |
| Transcripts         | Xenium, Atera | "SNAP25 · density", "All features · points", "Off"   | The transcript overlay (the same as `Show transcripts`) |
| Annotations         | All           | "2 shapes"                                           | GeoJSON shapes                                          |

Hidden layers leave the deck.gl layer list (`cellsVisible` in
`createOverviewLayers`), so they cannot be hovered or picked. The link keeps
them (`hidden=`) and the open sections (`panel=`).

### Image

| Control                           | Type                                                   | Range / default                   | Notes                                                                     |
| --------------------------------- | ------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------- |
| `Dataset image opacity`           | Slider 0–100%, step 5                                  | 100%                              | With channel controls present, opacity is applied per channel             |
| `Z plane`                         | Slider over the planes; shows "plane / count · depth"  | Middle plane                      | When the dataset image is an OME-TIFF z-stack                             |
| `Tissue image`                    | Select: High-res, Low-res, None                        | High-res if present, else Low-res | Visium. Lists the images the dataset can place; switches in place; `vimg` |
| Image channels                    | `MorphologyChannelControls`                            | See below                         | When the image has channels                                               |
| `Custom image URL` + `Load Layer` | URL form                                               |                                   | Once a dataset is ready                                                   |
| Custom layer rows                 | Name, channel count, `x` remove, opacity slider (100%) |                                   | Per loaded custom layer                                                   |

#### Image Channel Controls

`src/features/morphology/MorphologyChannelControls.tsx`, one row per channel
(custom layer channels are named "Layer / Channel"):

| Control                            | Notes                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility checkbox (channel name) | First channel on for Xenium; first six on for Image and SpatialData. Turning on a channel that still has its default window auto-contrasts it         |
| Colour picker                      | Hidden for native RGB images                                                                                                                          |
| `Auto`                             | Recomputes the contrast window from the coarsest level. Runs on load for every channel, or only the channels that are on when there are more than six |
| Min / Max                          | Contrast window                                                                                                                                       |
| Histogram                          | 32 bins from the last auto-contrast                                                                                                                   |

### Cells, Spots or Bins

Titled Spots on Visium and Bins on Visium HD. Its parts, top to bottom:

**Appearance**

| Control                 | Type                         | Default                                          | Notes                                                                                                                                                    |
| ----------------------- | ---------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cell boundaries`       | Checkbox                     | On for Xenium and SpatialData; off for Visium HD | Shown for H5AD but has no effect (no polygons)                                                                                                           |
| `Nucleus boundaries`    | Checkbox                     | Off                                              | Visium HD, Atera                                                                                                                                         |
| `Show off-tissue spots` | Checkbox                     | Off                                              | Visium, when obs `in_tissue` marks spots off the tissue. Reloads the dataset without reading the file again; genes, colours and the ROI are kept. `voff` |
| `Cell fill opacity`     | Slider 0–100%, step 5        | 50%                                              |                                                                                                                                                          |
| `Cell boundary opacity` | Slider 0–100%, step 5        | 100%                                             |                                                                                                                                                          |
| `Bin size`              | Segmented: 16 µm, 8 µm, 2 µm | 16 µm if present, else 8 µm                      | Visium HD, in the "Visium HD dataset" panel with "Dataset type" and "Active bins" rows. Undetected tiers are disabled                                    |

**Colour by**

| Control          | Type   | Values / default                                                        | Notes                                                                                                                                                                                                                   |
| ---------------- | ------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cell color`     | Select | Gene expression, **Transcript count**, Cell area, Annotations, Metadata | Gene expression colours cells by the selected genes; the other modes ignore them. Annotations appears once annotations are loaded; Metadata once a metadata track is loaded (H5AD/SpatialData numeric obs, or imported) |
| `Metadata track` | Select | "{label} ({min}-{max})"                                                 | When `Cell color` is Metadata. H5AD/SpatialData tracks read their values on first selection                                                                                                                             |

**Genes**

| Control                 | Type                                       | Values / default                                               | Notes                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Gene selection`        | Search                                     |                                                                | Case-insensitive match on the name or [alias](./modalities/h5ad.md#index-and-gene-names): exact matches first, then name prefixes, alias prefixes and substrings. Leaves out selected genes, and says "{gene} is already selected" when a search finds only those. Picking a gene clears the search |
| Gene list               | Virtualized buttons (`GeneOptionList.tsx`) |                                                                | Click toggles a gene. Adding a gene switches `Cell color` to Gene expression                                                                                                                                                                                                                        |
| Selected-gene chips     | Chips with ×                               |                                                                | × (`Remove {gene}`) removes. Removing the last gene puts `Cell color` back to the mode used before                                                                                                                                                                                                  |
| `Gene set symbols`      | Textarea                                   | e.g. `Actb, Gad1, Slc17a7`                                     | Split on whitespace, comma, semicolon; matches names, then aliases                                                                                                                                                                                                                                  |
| `Apply Symbols`         | Button                                     |                                                                | Replaces the selection with matching genes                                                                                                                                                                                                                                                          |
| `Save Set` / `Set name` | Button + text                              |                                                                | Saves the selection and score mode for this session                                                                                                                                                                                                                                                 |
| Saved sets              | Apply / `x` buttons                        |                                                                | Apply restores genes and score mode                                                                                                                                                                                                                                                                 |
| `Combine genes`         | Select                                     | **Sum**, Mean, Z-score                                         | Shown with 2 or more genes: how they combine into one score per cell                                                                                                                                                                                                                                |
| `Gene scale`            | Select + gradient preview                  | Gold, Magma, Viridis, **Plasma**, Cividis, Teal, Rose, Glasbey | The gene colour bar                                                                                                                                                                                                                                                                                 |
| Status line             | Text                                       | e.g. "Expression exact region: N cells"                        |                                                                                                                                                                                                                                                                                                     |

**Clusters** (Xenium, Atera, Visium, H5AD, SpatialData; D4)

| Control                         | Type                         | Values / default                                                                                   | Notes                                                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Annotation set`                | Select                       | None, All, dataset groups; **graphclust** or the first group (Xenium), **None** (H5AD/SpatialData) | Groups come from `analysis.zarr.zip` or categorical `obs` columns. Columns that identify cells (`*_ontology_term_id`, `observation_joinid`, or more than 500 categories) are listed under "More columns"                                                         |
| `Load Annotations`              | Button                       |                                                                                                    | Loads the selected set and switches `Cell color` to Annotations                                                                                                                                                                                                  |
| `Clear Annotations`             | Button                       |                                                                                                    |                                                                                                                                                                                                                                                                  |
| `Export Annotations`            | Button                       |                                                                                                    | Downloads `annotations.csv`                                                                                                                                                                                                                                      |
| `Import File`                   | File input (`.csv`, `.json`) |                                                                                                    | CSV: a `cell_id`/`cellid`/`cell` column and a `label`/`annotation`/`group`/`cluster` column; extra numeric columns become metadata tracks. JSON: rows or `{label: [ids]}` (`src/data/customAnnotations.ts`). Cell IDs must be Xenium format (`/^[a-p]{8}-\d+$/`) |
| `Annotation URL` + `Import URL` | URL form                     |                                                                                                    | Same formats from a URL; saved in the share URL                                                                                                                                                                                                                  |

Loaded state:

- **Loaded annotations**: one list per set, headed by the set name, its cell
  total and a visibility checkbox. Each row has a colour picker, a visibility
  checkbox, the label without the set prefix, a bar of its size, its cell
  count and share of the set, and `×`. Visium spots hidden off the tissue are
  not counted.
- **Metadata tracks**: per track label, cell count, range, and `x`.

**Embedding**: `Show Embedding` opens the [Embedding panel](#embedding-panel).

**Advanced**: `Expression detail`, a select of **Auto LOD**, Exact region and
All cells.

`Expression detail` (`src/data/geneExpressionLod.ts`):

- **Auto LOD**: every cell on the slide for datasets of up to 500,000 cells.
  Larger datasets: a whole-slide sample when zoomed far out or more than
  100,000 cells are visible, the exact viewport when ≤ 50,000 are visible,
  otherwise a sample of the padded viewport. Samples keep every cell expressing
  the selected genes and thin only the cells without.
- **Exact region**: exact viewport when ≤ 50,000 cells are visible, sampled the
  same way above that.
- **All cells**: every cell on the slide.

For Visium HD, gene overlays colour bins (see
[Visium HD](./modalities/visium-hd.md#feature-read-paths)).

### Transcripts

Xenium and Atera. The header says what is shown ("SNAP25 · density", "All
features · points", "Off").

Atera stores transcripts per gene (see
[Atera](./modalities/atera.md#transcripts)), so on Atera:

- With Selected genes, density squares sum the selected genes, and Auto
  switches to exact points when the selected genes' count in view fits the
  budget. The `Exact points` meter shows that count, not the all-transcript
  cell estimate.
- With All features, or no genes selected, the layer is cell-summary squares
  from cell transcript counts, and Exact waits for genes.
- `Gene-only calls` is disabled, and transcripts have no FOV.
- Density always counts QV ≥ 20; `Min QV` applies to exact points.

| Control              | Type             | Range / default                                | Notes                                                                                  |
| -------------------- | ---------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Show transcripts`   | Checkbox         | Off                                            | Enables the overlay                                                                    |
| `Detail`             | Select           | **Auto**, Density, Exact                       | Auto shows exact points when the visible estimate fits the budget, else density        |
| `Exact points`       | Meter            | "{estimate} of {budget} points"                | Fills with the view's transcripts; warning colour over the budget                      |
| `Edit Max`           | Button           | Shows `Exact budget`                           | `Exact budget`: number, 1–1,000,000, step 1,000; 100,000; commits on Enter or blur     |
| `Feature filter`     | Select           | **Selected genes**, All features               | Selected genes needs at least one selected gene; applies to density and exact points   |
| Feature chips        | Chips with ×     |                                                | × (`Remove {gene} from transcript features`) removes it from the shared gene selection |
| `Feature search`     | Search           | Up to 24 results, ranked like `Gene selection` | Adds the gene and switches the filter to Selected genes                                |
| `Density color`      | Select + preview | **Thermal**, Magma, Viridis, Cividis, Teal     | Normalized to the largest square on the slide at the current square size               |
| `Point color`        | Select           | **Feature**, QV                                | Exact points                                                                           |
| `Min QV`             | Number           | 0–40; 20                                       | Exact points                                                                           |
| `Gene-only calls`    | Checkbox         | On                                             | Excludes control probes                                                                |
| `Transcript opacity` | Slider 0–100%    | 85%                                            |                                                                                        |
| `Point size`         | Slider 1–6 px    | 2 px                                           |                                                                                        |

At ≥ 80% of the budget, `Load exact viewport` must be pressed.

On Xenium (Phase 15.1-J), density follows `Feature filter` too: with Selected
genes the squares count only those genes (see
[Xenium](./modalities/xenium.md#transcripts)). If the newly selected genes
need more than 32 `density/gene` data chunks, nothing is drawn and the panel
says to select fewer genes. Auto's switch to exact points still uses the
all-transcript estimate, which is what an exact read scans.

The canvas legend names what the squares count and their size: "SNAP25
transcripts per 40 µm bin", "SNAP25 and AQP4 transcripts per …", "Transcripts
of 8 selected genes per …", "All transcripts per …", or "Transcripts in cells
per …" for cell-summary squares. The hover card's title says the same, and
for several genes it lists each gene's count in the square (top 4).

The section ends with the overlay status
(`src/features/transcripts/TranscriptStatusPanel.tsx`): source, rendered
count and query time; `Load exact viewport` when waiting; and the top groups
(gene, FOV, count; gene and count on Atera). Clicking a transcript or density
bin pins it in the [Transcript card](#cards).

### Annotations

GeoJSON shapes, on all platforms (`src/features/annotations/geometricAnnotationModel.ts`):

| Control          | Notes                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Import GeoJSON` | `.geojson` / `.json` Feature or FeatureCollection of Polygon/MultiPolygon. Coordinates default to pixels for Image, micrometres otherwise |
| `Export GeoJSON` | Downloads `geometric-annotations.geojson` in micrometres                                                                                  |
| `Clear GeoJSON`  | Removes all shapes                                                                                                                        |
| Shape rows       | Colour, visible, label, polygon count, `x`                                                                                                |

Import rules are in [Image-only and GeoJSON](./image-only-and-geojson.md).

## Cards

Cards are 360 px wide and stack at the top left of the canvas in this order,
scrolling when they outgrow it; a card that appears scrolls into view. While
the info drawer is open they move to its right. Closing a card clears what it
shows. Selection, Cell and Transcript cards have `Go To`, which shows what the
card is about (`zoomToBbox`).

| Card                     | Shown when                                                     | Close                                       |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------- |
| Selection (the ROI name) | A box or lasso selection exists (cells, spots, Visium HD bins) | `Clear selection`                           |
| New shape                | Box or Lasso selection is on, on an image                      | `Stop drawing`                              |
| Cell, Spot or Bin        | A cell, spot, bin or Visium HD cell is clicked                 | `Clear selected cell` (or spot, bin)        |
| Transcript               | A transcript or density bin is clicked (pinned)                | `Clear pinned transcript`                   |
| Magic Lens               | The Magic Lens tool is on, or `Summarise View` ran             | `Turn off Magic Lens` or `Clear Magic Lens` |

### Selection

Under the name, "6,229 cells · 943,210 µm²" (count and area), or what is
running ("Querying genes"). Then `ROI name` and, for cells, `Save ROI`, which
adds the selection as an annotation and colours by annotations; the name
increments after saving.

| Tab                         | Contents                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Genes                       | Top genes: count, % of total, % of cells, mean per cell (a 32-cell preview, then refined). Visium HD: ROI genes over bins |
| Cells (Spots, Bins)         | Cells, mean transcripts and mean area; for bins, the count, bin size and in-tissue count                                  |
| Transcripts (or Expression) | `Summarise Transcripts`: Magic Lens over the selection (D14). Expression where the lens counts UMIs or values             |

Exports: `Export GeoJSON` (`{name}-roi.geojson`), `Export Cells`
(`{name}-cells.csv`, up to 50,000 cells), `Export Transcripts`
(`{name}-transcripts.csv`, up to 100,000 transcripts; Xenium, also shown for
H5AD and SpatialData), or for Visium HD `Export Barcodes`
(`{name}-barcodes.csv`, up to 50,000 bins).

On an image, Box and Lasso selection draw GeoJSON shapes: the New shape card
names the next one (`Shape name`), and a finished shape joins the Annotations
section; no cell or gene queries run.

### Cell, Spot or Bin

A click on a cell, spot or bin selects it and opens this card. The selection is
marked over the canvas in the highlight colour: its outline when its boundary
or bin is drawn, otherwise a ring around the point. Esc on the canvas, or
closing the card, clears it.

- Cell (`src/features/cells/CellInfoPanel.tsx`). Xenium: ID, position,
  transcripts, nuclei, segmentation, annotations, shape metrics (area,
  diameter, eccentricity, axes, perimeter, circularity), and a "Z-axis
  transcripts" histogram. Visium, H5AD, SpatialData: ID, annotations and `obs`
  values ("Observations"); a Visium spot's barcode is its ID. Then a "Gene
  expression" list for the cell with a search filter
  (`CellGeneExpressionList.tsx`).
- Bin, Visium HD (`src/features/cells/GridCellInfoPanel.tsx`): barcode, bin
  size, tissue, array row/column, image pixel position; cell assignment from
  `barcode_mappings.parquet`; selected-gene score; and a bin expression profile
  with `Load Bin GEX` / `Refresh Bin GEX` and a gene filter.
- Cell, Visium HD segmentation boundary
  (`src/features/cells/BoundaryCellInfoPanel.tsx`): cell ID, annotation,
  segmentation, vertices, area, selected-gene score and `Load Cell GEX`.

### Transcript

The pinned transcript: gene, ID, FOV (not on Atera), cell, QV, X/Y, Z,
nucleus overlap and type. A pinned density bin shows its count, total, level,
source, bin size, selected and hidden counts, and its top genes.

### Magic Lens

"Move the cursor over the tissue…" while the cursor lens waits; then the scope,
transcripts (or UMIs), cells (or bins), gene count, selected-gene count and the
top 8 genes with bars (`src/features/roi/RoiPanels.tsx`). With the cursor lens
on, a circle and a compact summary also follow the mouse
(`src/components/viewerMagicLensOverlay.tsx`).

## Embedding Panel

The Embedding panel (UMAP, t-SNE or the dataset's `obsm` views) opens from
Cells › `Show Embedding` and closes with `Close embedding` or Esc
(`src/features/shell/EmbeddingWindow.tsx`). It sits at the top right of the
canvas, 360 × 400 px at first; the grip at its bottom left (`Resize the
embedding panel`) resizes it by dragging or with the arrow keys, from 280 ×
260 px up to the canvas, and the plot redraws at its new size.

| Control                                                   | Notes                                                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Embedding view`                                          | Dataset options (H5AD/SpatialData `obsm` keys) or UMAP / t-SNE                                                                                                   |
| `Load Embeddings`                                         | Loads the projection                                                                                                                                             |
| Scatter plot (`src/features/analysis/EmbeddingPanel.tsx`) | Up to 120,000 points; coloured by annotation when active; ROI members yellow; selection pink. Click selects the nearest cell or bin and centres the spatial view |

## Canvas

### Legend

`ViewerLegend` (`src/components/ViewerLegend.tsx`) sits at the bottom left,
above the loading indicator, and explains what the canvas shows. The `Legend`
header collapses it. It has a section for each of these, scales first and
category lists last:

- `Cell color` Gene expression: the genes (up to three names, then "+n"),
  "Expression per cell" or "{Sum|Mean|Mean z-score} of n genes per cell", and
  the gene scale from 0 to its maximum.
- `Cell color` Annotations: the set name and the first 12 labels, each with a
  visibility checkbox, swatch and cell count, then "+n more in Cells ›
  Clusters". The checkboxes are the same as those in Cells › Clusters.
- `Cell color` Metadata: the track name and its range.
- `Cell color` Cell area: µm² on a square-root scale.
- Transcripts drawn as density: what the squares count ("SNAP25 transcripts per
  40 µm bin") with the density scale; or points coloured by quality: QV 0 to
  40+.

Transcript count, the default, has no legend. Hidden cells drop their legend.

### Navigation

Mouse: drag to pan, scroll or pinch to zoom, double-click to zoom in. Zoom is
clamped to −10…10; the fitted view is clamped to −10…4. The bottom right of the
canvas has `Zoom out (−)`, `Zoom in (+)` (a whole zoom level each) and `Fit to
view (F)`, above the scale bar.

The fitted view fills the canvas as measured, less 24 px on each side
(`fitExtentViewState`, `src/rendering/overviewViewState.ts`); before the canvas
is measured it assumes 720 px, and the first measurement fits again. A shared
link's `view` wins over the fit. Level of detail still measures zoom from the
720 px fit, so cells draw the same at a given scale.

Keyboard (`src/components/viewerNavigation.ts`; focus the spatial view first,
except for `F`):

| Key                | Action                                          |
| ------------------ | ----------------------------------------------- |
| Arrow keys         | Pan 64 screen px                                |
| Shift + arrow keys | Pan 256 screen px                               |
| `+` or `=`         | Zoom in by 0.5                                  |
| `-` or `_`         | Zoom out by 0.5                                 |
| `F`                | Fit the data to the view, from anywhere         |
| `Home`             | Return to the first view (the link's, or a fit) |
| `Esc`              | Clear the selected cell                         |

### Picking

Click (`ViewerCore.tsx`, `src/components/viewerPicking.ts`):

- Transcript point or density bin: pins it in the Transcript card.
- Visium HD bin: selects the bin (zoomed-out aggregate bins are not pickable).
- Cell point or boundary: selects the cell.
- Embedding point: selects the cell or bin and recentres the view.

### Hover Tooltips

`src/components/viewerHoverTooltips.tsx`. Suppressed while the cursor lens is
on or when `Hover tooltips` is off (except transcripts).

| Target           | Fields                                                                               |
| ---------------- | ------------------------------------------------------------------------------------ |
| Visium HD bin    | Barcode, bin, array row/col, image px, tissue, expression                            |
| Cell point       | ID, source, count, X/Y µm, transcripts, area, expression, genes, annotations         |
| Cell boundary    | ID, segmentation, annotation(s), X/Y, transcripts, area, vertices, expression, genes |
| Transcript point | Feature, ID, FOV (when present), cell, QV, X/Y µm, Z, nucleus overlap, distance      |
| Density bin      | Feature or "Transcript density bin", count, total, level, X/Y, hidden                |

### Distance Measurement

With the Measure tool on, drag in the view. Lines shorter than 3 screen px are
ignored. The label shows µm or px; pixel values use the image µm/px.

### ROI Drawing

Box: drag a rectangle. Lasso: drag freehand (points at least 4 screen px
apart, at least 3 points). ROIs smaller than 1 µm × 1 µm are ignored.

### Readouts And Messages

- Bottom centre: mouse X/Y in µm or px, and `Zoom N.NN` with debug info on.
- Bottom right: zoom buttons, then the scale bar (1/2/5 steps) in the `Mouse
coordinates` unit.
- Bottom left: the legend, the loading indicator (current task plus up to 3
  more) and viewport messages ("Loading overview cells…", "Reading OME-TIFF
  image…", errors).
- Empty state: "Please load a dataset".

## Info Drawer

ⓘ opens the info drawer (`src/features/shell/InfoDrawer.tsx`): 380 px wide, on
the left over the canvas, and not modal. Esc or `Close Dataset info` closes
it. Its sections render only while it is open.

| Section              | Contents                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Dataset              | Platform, exact counts (cells, spots or bins; genes), image ("4 channels · 15 z planes", "Tissue image", "None"), pixel size in µm/px, address |
| About                | The manifest's name, description, source, licence and citation, when it has them                                                               |
| View options         | The Visium summary and library, and the SpatialData coordinate system, image and scale, on those platforms                                     |
| Open another dataset | The open-dataset form, with `Boundary limit` under Advanced                                                                                    |
| Diagnostics          | `Diagnose Dataset`, the download, the report, "Data access notes (n)", load issues and the activity log; the layer stack lines in debug mode   |

### Open Another Dataset

The same form opens from the dataset name in the top bar, with Recent and
Examples below it, and shows on the [start screen](#start-screen)
(`OpenDatasetForm`, `src/features/sections/DatasetInfoBlocks.tsx`).

| Control                                                      | Type      | Values / default                       | Notes                                                                                                                                                     |
| ------------------------------------------------------------ | --------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dataset or image URL`                                       | URL input | Empty, or `dataset` from the share URL | Any supported source or [dataset manifest](./dataset-manifest.md); see [Architecture](./architecture.md#1-detection)                                      |
| `Morphology image` (`Tissue image` for Visium and Visium HD) | Checkbox  | On                                     | Read when `Load Dataset` is pressed; off skips the image                                                                                                  |
| `Boundary limit` (under Advanced)                            | Number    | As in [Settings](#settings)            | Not on the start screen                                                                                                                                   |
| `Load Dataset`                                               | Submit    |                                        | Resets genes, annotations, embeddings, ROI, selections, and Magic Lens results once the new dataset is ready; shows `Loading…` and is disabled until then |

The open dataset stays on screen and usable while another loads (Phase
15.1-F); the loading list shows "Loading dataset {name}". If the new one
fails, the open one stays and a toast at the bottom of the view says so
("Dataset not found: missing could not be opened; {open dataset} is still
open.", with the error's next step and `Dismiss`). Diagnostics lists the full
error until it is dismissed or another load starts. A Visium library or
off-tissue change also reloads this way: the controls show the new choice at
once, and the spots change when the reload is ready.

### View Options

| Control                        | Type             | Values / default                                | Notes                                                                                                                                  |
| ------------------------------ | ---------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Library`                      | Select           | The first library an obs library column names   | Visium `.h5ad` with several libraries in `uns/spatial`. Reloads the dataset without reading the file again; the ROI is cleared. `vlib` |
| `Coordinate system`            | Select           | Chosen automatically                            | SpatialData. Disabled with one coordinate system. Changing it reloads the store, and the image and units follow the new system         |
| `Image`                        | Select           | Highest-resolution image in the system, or None | SpatialData. Disabled with fewer than two images. Changing it reloads the store                                                        |
| `µm per unit` + `Set` / `Auto` | Number + buttons | Declared, estimated, or unknown                 | SpatialData. `Set` overrides the scale; `Auto` returns to declared or estimated units. A note shows where the scale came from          |

The Visium controls sit in a "Visium dataset" panel (`VisiumDatasetControls`)
with read-only rows: "Dataset type" (`Visium (Space Ranger)` or `Visium
(H5AD)`), "Spots" (spots shown × 55 µm, and how many are off the tissue),
"Library" (a select when the file has several), "Chemistry" when known, and
"Scale" (µm per pixel and its source). See
[Standard Visium](./modalities/visium.md#units-and-coordinates).

The SpatialData controls sit in a "SpatialData view" panel with a "Dataset
type" row (`SpatialDataDatasetControls`). See
[SpatialData](./modalities/spatialdata.md#catalog-and-view-selection) for how
the defaults are chosen and
[Units and extent](./modalities/spatialdata.md#units-and-extent) for the scale
sources.

### About

A dataset loaded through a [dataset manifest](./dataset-manifest.md) with a
`name`, `description`, or [`source`](./dataset-manifest.md#source) shows them
here (`DatasetAbout`): the source repository and accession link to the
deposit, followed by the licence and citation.

### Diagnostics

`Diagnose Dataset` runs `runDatasetDiagnostics` for the URL; the download icon
saves `xenium-diagnostics.json` (for every platform). Then
(`src/components/AppStatusPanels.tsx`):

| Panel                 | Shows                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagnostics           | Per-check pass / warning / fail with a summary line                                                                                                                                                                                                                                                                                                                                                            |
| Data access notes (n) | Closed by default. Holds the Matrix Warning (Xenium `cell_feature_matrix.zarr.zip` has no CSC arrays, so ROI gene stats use the slower H5 path) and Fallbacks (up to 16 notices when a slower or partial path was used)                                                                                                                                                                                        |
| Load issues           | Structured errors from any workflow (`role="alert"`). A dataset that does not load says why: "Dataset not found" (HTTP 404, or 403 from buckets that deny listing), "Access denied" (401), "Request blocked" (no response: CORS or network), "Host server error", or "Unsupported dataset layout" with the files it did find. It lists the first six files checked and offers `Run Diagnostics`. ⓘ counts them |
| Log (n)               | Closed by default. Up to 32 timestamped activity entries, newest first; `Clear` empties it                                                                                                                                                                                                                                                                                                                     |

With debug info on, the deck.gl layer count and the
[performance budget](./architecture.md#performance-budget) profile follow.

## Narrow Screens

Under 860 px wide (`useNarrowScreen`) the shell folds up:

- The tools fold into a menu: its button shows the active tool ("Tools:
  Pan"), and it lists each tool with its key and, when off, why. The brand is
  hidden, the summary chip is read out but not shown, and Share shows only its
  icon. The Magic Lens options appear only while the lens is on.
- The layer panel becomes a bottom sheet whose 56 px handle says "Layers" and
  what colours the cells ("Cells: graphclust"). Tapping it, or `\`, opens it
  to at most 65% of the screen.
- Cards dock at the bottom of the canvas as full-width sheets, above the
  layer sheet's handle, and the Embedding panel takes the canvas's width.

## Platform Availability

From the capabilities in `src/features/app-shell/platformAdapter.ts`:

| Feature                                        | Xenium                  | Atera            | Visium        | Visium HD         | H5AD             | SpatialData      | Image            |
| ---------------------------------------------- | ----------------------- | ---------------- | ------------- | ----------------- | ---------------- | ---------------- | ---------------- |
| Cells section                                  | ✓                       | ✓                | Spots         | Bins              | ✓                | ✓                | —                |
| Transcripts section                            | ✓                       | Selected genes   | —             | —                 | —                | —                | —                |
| All-feature transcripts                        | Native density + exact  | Cell summary     | —             | —                 | —                | —                | —                |
| ROI transcript export                          | ✓                       | —                | —             | —                 | —                | —                | —                |
| Magic Lens                                     | ✓                       | Unavailable      | Unavailable   | ✓                 | Unavailable      | Unavailable      | —                |
| Cell card                                      | Cell Info + Z histogram | Observations     | Observations  | Bin Info          | Observations     | Observations     | —                |
| Cell-id annotations                            | ✓                       | ✓                | ✓             | —                 | ✓                | ✓                | —                |
| GeoJSON shapes                                 | ✓                       | ✓                | ✓             | ✓                 | ✓                | ✓                | ✓                |
| Cell boundaries                                | ✓                       | ✓                | Spot outlines | Segmented outputs | —                | ✓ (shapes)       | —                |
| Nucleus boundaries                             | —                       | ✓                | —             | ✓                 | —                | —                | —                |
| Selection card                                 | Cells                   | Cells            | Cells (spots) | Bins              | Cells            | Cells            | New shape        |
| Bin size control                               | —                       | —                | —             | ✓                 | —                | —                | —                |
| SpatialData view options                       | —                       | —                | —             | —                 | —                | ✓                | —                |
| Visium image, library, and off-tissue controls | —                       | —                | ✓             | —                 | —                | —                | —                |
| Boundary limit                                 | ✓                       | ✓                | ✓             | Disabled          | ✓                | ✓                | ✓                |
| Morphology checkbox label                      | Morphology image        | Morphology image | Tissue image  | Tissue image      | Morphology image | Morphology image | Morphology image |

## Shareable URL

`src/data/shareableState.ts` writes the state to the URL hash (debounced
160 ms, with `xv=2`); query-string values are also read on startup, and hash
values win. Numbers are rounded to three decimals. Version 2 links leave out
every value that is at its default (`DEFAULT_SHAREABLE_STATE`), so a missing
parameter means the default. Version 1 links, which wrote every value, still
open as before. `Share` in the top bar copies the address and says "Link
copied".

| Parameter                                                                                                 | Meaning                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataset`                                                                                                 | The loaded dataset's URL (loaded automatically). Typing in the address box does not change it until that dataset loads                                                                                                                                                                                                                 |
| `annotationUrl`                                                                                           | Annotation import URL (imported automatically)                                                                                                                                                                                                                                                                                         |
| `groups`                                                                                                  | The dataset's own annotation set that was loaded, such as `analysis:0` (loaded automatically)                                                                                                                                                                                                                                          |
| `customImageUrl`, `customImageOpacity`                                                                    | Custom image layers (repeatable, in order)                                                                                                                                                                                                                                                                                             |
| `genes`                                                                                                   | Selected genes (comma-separated)                                                                                                                                                                                                                                                                                                       |
| `view`                                                                                                    | Target x, y, z, zoom                                                                                                                                                                                                                                                                                                                   |
| `roi`                                                                                                     | `box:minX,minY,maxX,maxY` or `lasso:x,y;x,y;…`                                                                                                                                                                                                                                                                                         |
| `tab`                                                                                                     | Read from older links, which named a control tab, and mapped: `dataset` → info drawer (not in a version 1 link, where every link said `dataset`), `layers` → Image, `genes` and `annotations` → Cells, `transcripts` → Transcripts, `roi` → `tool=box`, `cell` → the Embedding panel and `card=cell`, `magic-lens` → `tool=magic-lens` |
| `panel`                                                                                                   | The open layer sections (`image`, `cells`, `transcripts`, `annotations`), `info` (the info drawer) and `embedding`, comma-separated; left out while only the default section is open                                                                                                                                                   |
| `tool`                                                                                                    | The active tool: `box`, `lasso`, `measure` or `magic-lens`; left out for Pan. Replaces `lens=1`, which version 1 links still use                                                                                                                                                                                                       |
| `card`                                                                                                    | `cell:<id>`: the selected cell, selected again once the cells load                                                                                                                                                                                                                                                                     |
| `hidden`                                                                                                  | Hidden layers: `image`, `cells`, `annotations`                                                                                                                                                                                                                                                                                         |
| `scale`, `score`, `detail`, `cellColor`                                                                   | Gene scale, signature score, expression detail, cell colour mode. A version 1 link with `genes` opens in Gene expression whatever `cellColor` says, as such links looked before that mode existed                                                                                                                                      |
| `cellTrack`                                                                                               | Selected `Metadata` track id; written only when `cellColor=metadata`                                                                                                                                                                                                                                                                   |
| `coord`, `measureUnit`                                                                                    | `um` or `px`                                                                                                                                                                                                                                                                                                                           |
| `morphology`, `cellBounds`, `nucleusBounds`, `hoverTips`                                                  | Booleans                                                                                                                                                                                                                                                                                                                               |
| `boundaryLimit`                                                                                           | Boundary limit                                                                                                                                                                                                                                                                                                                         |
| `imgOpacity`, `cellFill`, `cellBoundary`                                                                  | Opacities (0–1)                                                                                                                                                                                                                                                                                                                        |
| `channels`                                                                                                | Enabled image channel IDs                                                                                                                                                                                                                                                                                                              |
| `z`                                                                                                       | Zero-based z plane of an OME-TIFF z-stack dataset image                                                                                                                                                                                                                                                                                |
| `tx`, `txDetail`, `txFilter`, `txGene`, `txBudget`, `txQv`, `txSize`, `txOpacity`, `txDensity`, `txColor` | Transcript controls. `txFilter` is the chosen `Feature filter`, not the All features shown while no gene is selected, so such a link leaves it out                                                                                                                                                                                     |
| `lensScope`, `lensRadius`, `lensQv`                                                                       | Magic Lens controls (`lens=1` in older links turns the lens on)                                                                                                                                                                                                                                                                        |
| `sdCs`, `sdImage`, `sdUm`                                                                                 | SpatialData coordinate system, image, and µm-per-unit override                                                                                                                                                                                                                                                                         |
| `vimg`, `vlib`, `voff`                                                                                    | Visium tissue image (`hires`, `lowres`, `none`), library (only with several), and `1` when off-tissue spots are shown                                                                                                                                                                                                                  |

A link with `dataset` skips the [start screen](#start-screen).
Dataset-specific values (genes, ROI, channels, z plane, boundaries, colour
modes, lens, SpatialData view)
are restored only when the loaded URL matches the shared `dataset`. A restored
ROI is re-run as "Shared ROI".

Not saved: the layer panel collapse, the measurement line, a selected bin
or Visium HD cell, a pinned transcript, saved gene sets, annotation colours
and visibility, and GeoJSON shapes.

## State

- `src/store/viewerStore.ts` (Zustand) holds the address box, which starts
  empty.
- Recent datasets are in `localStorage` and the example index in
  `sessionStorage` (see [Start screen](#start-screen)).
- All other UI state is React state in
  `src/features/app-shell/useAppDomainState.ts`, grouped by area
  (annotations, analysis, cells, dataset, genes, layers, Magic Lens,
  morphology, ROI, runtime, selection, transcripts, Visium HD), plus the open
  panels (`shellPanels` in `App.tsx`, written to the link as `panel=`).
- Blocks and cards make their own control element IDs with `useId`.
