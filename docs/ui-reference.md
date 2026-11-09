# UI Reference

Every UI component and user-facing control, with the source file that renders
it and the platforms that show it. For task-oriented instructions see the
[User guide](./user-guide.md); for how data reaches the UI see
[Architecture](./architecture.md).

Platform names used below: **Xenium**, **Visium HD**, **H5AD**,
**SpatialData**, **Image** (image-only sources).

## Layout

```text
<main class="app-shell">                       src/App.tsx
├── Skip link "Skip To Spatial View"
├── AppControlHud → ControlHudShell            src/features/control-hud/ControlHudShell.tsx
│   ├── Hide Controls / Show Controls
│   ├── Tabs: Dataset · Layers · Genes · Transcripts · Magic Lens · Annotations · ROI · Cell
│   └── One panel per tab
└── section.viewer-region
    └── ViewerCore                             src/components/ViewerCore.tsx
        ├── MorphologyCanvas (image tiles)     src/components/MorphologyCanvas.tsx
        ├── deck.gl canvas (cells, bins, boundaries, transcripts, ROI, shapes)
        ├── ROI drawing, measurement, Magic Lens overlays
        ├── Hover tooltip
        ├── Zoom + mouse coordinate readout, scale bar
        └── Loading indicator and viewport messages
```

`src/main.tsx` wraps `App` in `AppErrorBoundary`
(`src/components/AppErrorBoundary.tsx`), which shows "Application error" with a
`Retry` button if rendering throws.

### Control HUD

`ControlHudShell` is a floating panel (top right; narrower and height-capped on
small screens, see `src/styles/responsive.css`). `Hide Controls` collapses it.
A tab with a running task shows a loading dot.

| Tab         | Panel component                                                                                               | Hidden for     |
| ----------- | ------------------------------------------------------------------------------------------------------------- | -------------- |
| Dataset     | `AppDatasetHudPanel` → `src/features/control-hud/DatasetHudPanel.tsx`                                         | —              |
| Layers      | `AppLayerHudPanel` → `src/features/control-hud/LayerHudPanel.tsx`                                             | —              |
| Genes       | `AppGeneHudPanel` → `src/features/genes/GeneHudPanel.tsx`                                                     | Image          |
| Transcripts | `AppTranscriptHudPanel` → `src/features/transcripts/TranscriptHudPanel.tsx`                                   | All but Xenium |
| Magic Lens  | `src/features/roi/MagicLensHudPanel.tsx`                                                                      | Image          |
| Annotations | `src/features/annotations/AnnotationHudPanel.tsx`                                                             | —              |
| ROI         | `RoiHudPanel`, `VisiumHdRoiHudPanel`, or `GeometricRoiHudPanel` in `src/features/control-hud/RoiHudPanel.tsx` | —              |
| Cell        | `src/features/control-hud/CellHudPanel.tsx`                                                                   | Image          |

Tab order and labels come from `CONTROL_HUD_TABS`
(`src/features/app-shell/appShellModel.ts`). Before a dataset is ready the
Xenium adapter is used, so every tab is visible. If the active tab becomes
hidden, the HUD returns to Dataset. Clicking a transcript switches to the
Transcripts tab.

## Dataset Tab

| Control                                           | Type                         | Values / default                                 | Notes                                                                                                                               |
| ------------------------------------------------- | ---------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Dataset or image URL`                            | URL input                    | Demo Xenium URL, or `dataset` from the share URL | Any supported source or [dataset manifest](./dataset-manifest.md); see [Architecture](./architecture.md#1-detection)                |
| `Morphology image` (`Tissue image` for Visium HD) | Checkbox                     | On                                               | Read when `Load Dataset` is pressed; off skips the image                                                                            |
| `Boundary limit`                                  | Number                       | 1–100,000; default 2,500 (compact) or 50,000     | Max visible cells before boundary polygons are deferred. Disabled for Visium HD                                                     |
| `Load Dataset`                                    | Submit                       |                                                  | Resets genes, annotations, embeddings, ROI, selections, and Magic Lens results                                                      |
| `Bin size`                                        | Segmented: 16 µm, 8 µm, 2 µm | 16 µm if present, else 8 µm                      | Visium HD only. Undetected tiers are disabled. Shown with "Dataset type" and "Active bins" rows                                     |
| `Coordinate system`                               | Select                       | Chosen automatically                             | SpatialData only. Disabled with one coordinate system. Changing it reloads the store, and the image and units follow the new system |
| `Image`                                           | Select                       | Highest-resolution image in the system, or None  | SpatialData only. Disabled with fewer than two images. Changing it reloads the store                                                |
| `µm per unit` + `Set` / `Auto`                    | Number + buttons             | Declared, estimated, or unknown                  | SpatialData only. `Set` overrides the scale; `Auto` returns to declared or estimated units. A note shows where the scale came from  |
| `Diagnose Dataset`                                | Button                       |                                                  | Runs `runDatasetDiagnostics` for the URL                                                                                            |
| Download diagnostics                              | Icon button                  |                                                  | Saves `xenium-diagnostics.json` (for every platform)                                                                                |

The SpatialData controls sit in a "SpatialData view" panel with a "Dataset type"
row (`SpatialDataDatasetControls` in `DatasetHudPanel.tsx`). See
[SpatialData](./modalities/spatialdata.md#catalog-and-view-selection) for how
the defaults are chosen and
[Units and extent](./modalities/spatialdata.md#units-and-extent) for the scale
sources.

Status panels in the same tab (`src/components/AppStatusPanels.tsx`):

| Panel          | Shows                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Diagnostics    | Per-check pass / warning / fail with a summary line                                                  |
| Matrix Warning | Xenium `cell_feature_matrix.zarr.zip` has no CSC arrays (ROI gene stats will use the slower H5 path) |
| Fallbacks      | Up to 16 notices when a slower or partial path was used                                              |
| Issues         | Structured errors from any workflow (`role="alert"`)                                                 |
| Log            | Up to 32 timestamped activity entries, newest first; `Clear` empties it                              |

## Layers Tab

The header "Layer Stack" shows the deck.gl layer count and the
[performance budget](./architecture.md#performance-budget) profile.

| Control                           | Type                                                   | Range / default                                  | Platforms                                                          |
| --------------------------------- | ------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------ |
| `Cell boundaries`                 | Checkbox                                               | On for Xenium and SpatialData; off for Visium HD | All but Image. Shown for H5AD but has no effect (no polygons)      |
| `Nucleus boundaries`              | Checkbox                                               | Off                                              | Visium HD                                                          |
| `Hover tooltips`                  | Checkbox                                               | On                                               | All. Transcript tooltips ignore it                                 |
| `Dataset image opacity`           | Slider 0–100%, step 5                                  | 100%                                             | All. With channel controls present, opacity is applied per channel |
| `Cell fill opacity`               | Slider 0–100%, step 5                                  | 50%                                              | All but Image                                                      |
| `Cell boundary opacity`           | Slider 0–100%, step 5                                  | 100%                                             | All but Image                                                      |
| `Mouse coordinates`               | Segmented μm / px                                      | μm                                               | All. Also sets the scale-bar unit                                  |
| `Distance measure`                | On/Off toggle                                          | Off                                              | All. Turning it on cancels ROI drawing and the cursor lens         |
| `Measure unit`                    | Segmented μm / px                                      | Starts at the `Mouse coordinates` unit           | All                                                                |
| `Clear Measurement`               | Button                                                 |                                                  | All                                                                |
| Image channels                    | `MorphologyChannelControls`                            | See below                                        | When the image has channels                                        |
| `Custom image URL` + `Load Layer` | URL form                                               |                                                  | All, once a dataset is ready                                       |
| Custom layer rows                 | Name, channel count, `x` remove, opacity slider (100%) |                                                  | Per loaded custom layer                                            |

### Image Channel Controls

`src/features/morphology/MorphologyChannelControls.tsx`, one row per channel
(custom layer channels are named "Layer / Channel"):

| Control                            | Notes                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Visibility checkbox (channel name) | First channel on for Xenium; all channels on for Image and SpatialData |
| Colour picker                      | Hidden for native RGB images                                           |
| `Auto`                             | Recomputes the contrast window from the coarsest level                 |
| Min / Max                          | Contrast window                                                        |
| Histogram                          | 32 bins from the last auto-contrast                                    |

## Genes Tab

Header "Analysis" with a status chip ("{n} genes", "Loading", the expression
mode, …). Hidden for Image.

| Control                 | Type                                       | Values / default                                               | Notes                                                                                                                                 |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `Gene selection`        | Search                                     |                                                                | Case-insensitive substring; excludes selected genes                                                                                   |
| Gene list               | Virtualized buttons (`GeneOptionList.tsx`) |                                                                | Click toggles a gene                                                                                                                  |
| Selected-gene chips     | Buttons                                    |                                                                | Click removes                                                                                                                         |
| `Gene set symbols`      | Textarea                                   | e.g. `Actb, Gad1, Slc17a7`                                     | Split on whitespace, comma, semicolon                                                                                                 |
| `Apply Symbols`         | Button                                     |                                                                | Replaces the selection with matching genes                                                                                            |
| `Save Set` / `Set name` | Button + text                              |                                                                | Saves the selection and score mode for this session                                                                                   |
| Saved sets              | Apply / `x` buttons                        |                                                                | Apply restores genes and score mode                                                                                                   |
| `Signature score`       | Select                                     | **Sum**, Mean, Z-score                                         | How multi-gene selections combine                                                                                                     |
| `Gene scale`            | Select + gradient preview                  | Gold, Magma, Viridis, **Plasma**, Cividis, Teal, Rose, Glasbey | The gene colour bar                                                                                                                   |
| `Expression detail`     | Select                                     | **Auto LOD**, Exact region, All cells                          | See below                                                                                                                             |
| `Cell color`            | Select                                     | **Transcript count**, Cell area, Annotations, Metadata         | Annotations appears once annotations are loaded; Metadata once a metadata track is loaded (H5AD/SpatialData numeric obs, or imported) |
| `Metadata track`        | Select                                     | "{label} ({min}-{max})"                                        | When `Cell color` is Metadata. H5AD/SpatialData tracks read their values on first selection                                           |
| Status line             | Text                                       | e.g. "Expression exact region: N cells"                        |                                                                                                                                       |

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

## Transcripts Tab

Xenium only. Header chip shows the state (Off, Checking, "{n} points",
"{n} squares", Native LOD + exact, Unavailable, …).

| Control              | Type             | Range / default                            | Notes                                                                           |
| -------------------- | ---------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `Show transcripts`   | Checkbox         | Off                                        | Enables the overlay                                                             |
| `Detail`             | Select           | **Auto**, Density, Exact                   | Auto shows exact points when the visible estimate fits the budget, else density |
| `Exact budget`       | Number           | 1–1,000,000, step 1,000; 100,000           | At ≥ 80% of the budget, `Load exact viewport` must be pressed                   |
| `Feature filter`     | Select           | **Selected genes**, All features           | Selected genes needs at least one selected gene; applies to exact points        |
| Feature chips        | Buttons          |                                            | Remove from the shared gene selection                                           |
| `Feature search`     | Search           | Up to 24 results                           | Adds the gene and switches the filter to Selected genes                         |
| `Density color`      | Select + preview | **Thermal**, Magma, Viridis, Cividis, Teal | Normalized to the dataset/level count domain                                    |
| `Point color`        | Select           | **Feature**, QV                            | Exact points                                                                    |
| `Min QV`             | Number           | 0–40; 20                                   | Exact points                                                                    |
| `Gene-only calls`    | Checkbox         | On                                         | Excludes control probes                                                         |
| `Transcript opacity` | Slider 0–100%    | 85%                                        |                                                                                 |
| `Point size`         | Slider 1–6 px    | 2 px                                       |                                                                                 |

`TranscriptStatusPanel` (`src/features/transcripts/TranscriptStatusPanel.tsx`)
below the controls shows source, estimate, budget, rendered count, and query
time; `Load exact viewport` when waiting; top groups (gene, FOV, count); and
hovered and pinned transcript or density-bin cards with `Pin` / `Clear`.

## Magic Lens Tab

Hidden for Image. Functional for Xenium and Visium HD; H5AD and SpatialData
show "Unavailable".

| Control                        | Type                      | Values / default          | Notes                                          |
| ------------------------------ | ------------------------- | ------------------------- | ---------------------------------------------- |
| `Scope`                        | Segmented                 | **Cursor**, Viewport, ROI | ROI needs a drawn ROI                          |
| `Radius`                       | Slider 10–500 µm, step 10 | 80 µm                     | Cursor scope                                   |
| `Min QV`                       | Number 0–40               | 20                        | Xenium only; currently does not change results |
| `Enable Lens` / `Disable Lens` | Toggle                    |                           | Cursor scope; turns off distance measurement   |
| `Scan Lens`                    | Button                    |                           | Viewport and ROI scopes                        |

Results (`src/features/roi/RoiPanels.tsx`): scope, transcripts (or UMIs),
cells (or bins), gene count, and the top 8 genes with bars. With the cursor
lens on, a circle and a compact summary follow the mouse
(`src/components/viewerMagicLensOverlay.tsx`); queries are debounced by 320 ms.

## Annotations Tab

Header chip: "{n} labels", "Loading sets", "Unavailable", or "Idle".

### Cell Annotations

Xenium, H5AD, SpatialData.

| Control                         | Type                         | Values / default                                                         | Notes                                                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Annotation set`                | Select                       | None, All, dataset groups; **All** (Xenium), **None** (H5AD/SpatialData) | Groups come from `analysis.zarr.zip` or categorical `obs` columns                                                                                                                                                                                                |
| `Load Annotations`              | Button                       |                                                                          | Loads the selected set and switches `Cell color` to Annotations                                                                                                                                                                                                  |
| `Clear Annotations`             | Button                       |                                                                          |                                                                                                                                                                                                                                                                  |
| `Export Annotations`            | Button                       |                                                                          | Downloads `annotations.csv`                                                                                                                                                                                                                                      |
| `Import File`                   | File input (`.csv`, `.json`) |                                                                          | CSV: a `cell_id`/`cellid`/`cell` column and a `label`/`annotation`/`group`/`cluster` column; extra numeric columns become metadata tracks. JSON: rows or `{label: [ids]}` (`src/data/customAnnotations.ts`). Cell IDs must be Xenium format (`/^[a-p]{8}-\d+$/`) |
| `Annotation URL` + `Import URL` | URL form                     |                                                                          | Same formats from a URL; saved in the share URL                                                                                                                                                                                                                  |

Loaded state:

- **Set sizes**: bar plot per set with a `Visible` checkbox.
- **Loaded annotations**: per label colour picker, visibility checkbox, cell
  count, and `x`.
- **Metadata tracks**: per track label, cell count, range, and `x`.

### GeoJSON Shapes

All platforms (`src/features/annotations/geometricAnnotationModel.ts`):

| Control          | Notes                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Import GeoJSON` | `.geojson` / `.json` Feature or FeatureCollection of Polygon/MultiPolygon. Coordinates default to pixels for Image, micrometres otherwise |
| `Export GeoJSON` | Downloads `geometric-annotations.geojson` in micrometres                                                                                  |
| `Clear GeoJSON`  | Removes all shapes                                                                                                                        |
| Shape rows       | Colour, visible, label, polygon count, `x`                                                                                                |

Import rules are in [Image-only and GeoJSON](./image-only-and-geojson.md).

## ROI Tab

The panel depends on the platform.

### Cells (Xenium, H5AD, SpatialData)

| Control                   | Notes                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Draw Box` / `Draw Lasso` | Toggle drawing mode; turns off measurement                                                                      |
| `Clear`                   | Removes the ROI                                                                                                 |
| `ROI name`                | Default "ROI 1"; increments after saving                                                                        |
| Summary                   | Cells, mean transcripts, mean area                                                                              |
| Top ROI genes             | Count, % of total, % of cells, mean per cell (32-cell preview, then refined)                                    |
| `Save ROI`                | Adds the ROI as an annotation and colours by annotations                                                        |
| `Export GeoJSON`          | `{name}-roi.geojson`                                                                                            |
| `Export Cells`            | `{name}-cells.csv`, up to 50,000 cells                                                                          |
| `Export Transcripts`      | `{name}-transcripts.csv`, up to 100,000 transcripts (Xenium; the button is also shown for H5AD and SpatialData) |

### Bins (Visium HD)

`Draw Box`, `Draw Lasso`, `Clear`, `ROI name`; summary of bins, bin size, and
in-tissue count; ROI genes; `Export GeoJSON`; `Export Barcodes`
(`{name}-barcodes.csv`, up to 50,000 bins).

### Geometry (Image)

`Draw Box`, `Draw Lasso`, and `Shape name`. A finished drawing becomes a
GeoJSON shape in the Annotations tab; no cell or gene queries run.

## Cell Tab

Hidden for Image. The detail heading reads "Bin Info" for Visium HD bins and
"Cell Info" otherwise.

### Embeddings

| Control                                                   | Notes                                                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Embedding view`                                          | Dataset options (H5AD/SpatialData `obsm` keys) or UMAP / t-SNE                                                                                                   |
| `Load Embeddings`                                         | Loads the projection                                                                                                                                             |
| Scatter plot (`src/features/analysis/EmbeddingPanel.tsx`) | Up to 120,000 points; coloured by annotation when active; ROI members yellow; selection pink. Click selects the nearest cell or bin and centres the spatial view |

### Cell Info (Xenium, H5AD, SpatialData)

`src/features/cells/CellInfoPanel.tsx`:

- Xenium: ID, position, transcripts, nuclei, segmentation, annotations, shape
  metrics (area, diameter, eccentricity, axes, perimeter, circularity), and a
  "Z-axis transcripts" histogram.
- H5AD/SpatialData: ID, annotations, and `obs` values ("Observations").
- "Gene expression" list for the selected cell with a search filter
  (`CellGeneExpressionList.tsx`).
- `Clear Cell`.

### Bin Info (Visium HD)

`src/features/cells/GridCellInfoPanel.tsx`: barcode, bin size, tissue, array
row/column, image pixel position; cell assignment from
`barcode_mappings.parquet`; selected-gene score; and a bin expression profile
with `Load Bin GEX` / `Refresh Bin GEX` and a gene filter. Clicking a
segmentation boundary shows the cell ID, annotation, segmentation, vertices,
area, selected-gene score, and `Load Cell GEX`. `Clear Bin` clears the
selection.

## Platform Availability

From `src/features/app-shell/platformAdapter.ts` and the tab rules in
`src/App.tsx`:

| Feature                   | Xenium                  | Atera            | Visium HD         | H5AD             | SpatialData      | Image            |
| ------------------------- | ----------------------- | ---------------- | ----------------- | ---------------- | ---------------- | ---------------- |
| Genes tab                 | ✓                       | ✓                | ✓                 | ✓                | ✓                | —                |
| Transcripts tab           | ✓                       | —                | —                 | —                | —                | —                |
| Magic Lens                | ✓                       | Unavailable      | ✓                 | Unavailable      | Unavailable      | —                |
| Magic Lens Min QV         | ✓                       | —                | —                 | —                | —                | —                |
| Cell tab                  | Cell Info + Z histogram | Observations     | Bin Info          | Observations     | Observations     | —                |
| Cell-id annotations       | ✓                       | ✓                | —                 | ✓                | ✓                | —                |
| GeoJSON shapes            | ✓                       | ✓                | ✓                 | ✓                | ✓                | ✓                |
| Cell boundaries           | ✓                       | ✓                | Segmented outputs | —                | ✓ (shapes)       | —                |
| Nucleus boundaries        | —                       | ✓                | ✓                 | —                | —                | —                |
| ROI panel                 | Cells                   | Cells            | Bins              | Cells            | Cells            | Geometry         |
| Bin size control          | —                       | —                | ✓                 | —                | —                | —                |
| SpatialData view controls | —                       | —                | —                 | —                | ✓                | —                |
| Boundary limit            | ✓                       | ✓                | Disabled          | ✓                | ✓                | ✓                |
| Morphology checkbox label | Morphology image        | Morphology image | Tissue image      | Morphology image | Morphology image | Morphology image |

## Viewer Interactions

### Navigation

Mouse: drag to pan, scroll or pinch to zoom, double-click to zoom in. Zoom is
clamped to −10…10; the fitted view is clamped to −10…4.

Keyboard (focus the spatial view first; `src/components/viewerNavigation.ts`):

| Key                | Action                   |
| ------------------ | ------------------------ |
| Arrow keys         | Pan 64 screen px         |
| Shift + arrow keys | Pan 256 screen px        |
| `+` or `=`         | Zoom in by 0.5           |
| `-` or `_`         | Zoom out by 0.5          |
| `Home`             | Reset to the fitted view |

### Picking

Click (`ViewerCore.tsx`, `src/components/viewerPicking.ts`):

- Transcript point or density bin: pins it in the Transcripts tab.
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
| Transcript point | Feature, ID, FOV, cell, QV, X/Y µm, Z, nucleus overlap, distance                     |
| Density bin      | Feature or "Transcript density bin", count, total, level, X/Y, hidden                |

### Distance Measurement

With `Distance measure` on, drag in the view. Lines shorter than 3 screen px
are ignored. The label shows µm or px; pixel values use the image µm/px.

### ROI Drawing

Box: drag a rectangle. Lasso: drag freehand (points at least 4 screen px
apart, at least 3 points). ROIs smaller than 1 µm × 1 µm are ignored.

### Readouts And Messages

- Bottom centre: `Zoom N.NN` and mouse X/Y in µm or px.
- Bottom right: scale bar (1/2/5 steps), in the `Mouse coordinates` unit.
- Bottom left: loading indicator (current task plus up to 3 more) and viewport
  messages ("Loading overview cells…", "Reading OME-TIFF image…", errors).
- Empty state: "Please load a dataset".

There is no on-canvas legend; colour bars are in the Genes (`Gene scale`) and
Transcripts (`Density color`) tabs.

## Shareable URL

`src/data/shareableState.ts` writes the state to the URL hash (debounced
160 ms, with `xv=1`); query-string values are also read on startup, and hash
values win. Numbers are rounded to three decimals.

| Parameter                                                                                                 | Meaning                                                              |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `dataset`                                                                                                 | Dataset URL (loaded automatically)                                   |
| `annotationUrl`                                                                                           | Annotation import URL (imported automatically)                       |
| `customImageUrl`, `customImageOpacity`                                                                    | Custom image layers (repeatable, in order)                           |
| `genes`                                                                                                   | Selected genes (comma-separated)                                     |
| `view`                                                                                                    | Target x, y, z, zoom                                                 |
| `roi`                                                                                                     | `box:minX,minY,maxX,maxY` or `lasso:x,y;x,y;…`                       |
| `tab`                                                                                                     | Active HUD tab                                                       |
| `scale`, `score`, `detail`, `cellColor`                                                                   | Gene scale, signature score, expression detail, cell colour mode     |
| `cellTrack`                                                                                               | Selected `Metadata` track id; written only when `cellColor=metadata` |
| `coord`, `measureUnit`                                                                                    | `um` or `px`                                                         |
| `morphology`, `cellBounds`, `nucleusBounds`, `hoverTips`                                                  | Booleans                                                             |
| `boundaryLimit`                                                                                           | Boundary limit                                                       |
| `imgOpacity`, `cellFill`, `cellBoundary`                                                                  | Opacities (0–1)                                                      |
| `channels`                                                                                                | Enabled image channel IDs                                            |
| `tx`, `txDetail`, `txFilter`, `txGene`, `txBudget`, `txQv`, `txSize`, `txOpacity`, `txDensity`, `txColor` | Transcript controls                                                  |
| `lens`, `lensScope`, `lensRadius`, `lensQv`                                                               | Magic Lens controls                                                  |
| `sdCs`, `sdImage`, `sdUm`                                                                                 | SpatialData coordinate system, image, and µm-per-unit override       |

Dataset-specific values (genes, ROI, channels, boundaries, colour modes, lens,
SpatialData view)
are restored only when the loaded URL matches the shared `dataset`. A restored
ROI is re-run as "Shared ROI".

Not saved: HUD collapse, measurement, selected cell/bin, saved gene sets,
annotation colours and visibility, and GeoJSON shapes.

## State

- `src/store/viewerStore.ts` (Zustand) holds the dataset URL.
- All other UI state is React state in
  `src/features/app-shell/useAppDomainState.ts`, grouped by area
  (annotations, analysis, cells, dataset, genes, layers, Magic Lens,
  morphology, ROI, runtime, selection, transcripts, Visium HD).
- Control element IDs come from `src/features/app-shell/useAppControlIds.ts`.
