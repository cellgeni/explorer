# Xenium Explorer User Guide

## Loading Data

Paste a Xenium output directory URL in `Dataset URL`, then choose `Load Dataset`.
The URL should point at the folder that contains files such as
`experiment.xenium`, `cells.parquet`, and `cell_feature_matrix.zarr.zip`.

`Morphology image` is enabled by default so the OME-TIFF layer loads with the
dataset. Disable it before loading when you only want cells and overlays. Use
`Boundary limit` to control when true cell polygons are requested for the current
viewport.

## Spatial Navigation

Use mouse pan and zoom for normal navigation. The spatial view is also keyboard
focusable:

- Arrow keys pan the spatial view.
- Shift plus an arrow key pans farther.
- `+` and `-` zoom in and out.
- `Home` resets to the fitted dataset view.

The URL hash updates with the current dataset URL, viewport, selected genes,
ROI, and control state. Copy the browser URL to share the same view.

## Layers And Genes

The `Layers` tab controls image opacity, cell fill opacity, and cell boundary
opacity. Boundary opacity also controls the outline of point marks.

The `Genes` tab supports individual gene selection and multi-gene signatures.
`Auto LOD` chooses an appropriate expression query for the current zoom and
viewport; `Exact region` keeps the current viewport exact when the region is
small enough. The default gene scale is Plasma.

## Transcript Overlay

The `Transcripts` tab controls the molecule overlay separately from cell
expression coloring. In `Auto`, low and medium zoom use native Xenium
`transcripts.zarr.zip` aggregate levels as transcript-count density squares,
colored by the number of transcripts in each grid cell. `Auto` switches from
the density overview to exact transcript points when the visible transcript
estimate is inside the exact point budget.

Density square colors are normalized against the native dataset/LOD count domain
rather than only the currently visible viewport, so the color scale stays stable
while panning and zooming.

`Density` uses the native grid pyramid and renders up to 1,500 count squares in
the current viewport. Feature filters are applied by `Exact`, where individual
transcript records can be loaded and inspected.

Transcript hover details show transcript IDs. Cell IDs are filled from
`transcripts.parquet` when that file is available for per-transcript assignment
metadata.

If `transcripts.zarr.zip` is unavailable, all-feature views can still show a
cell-summary transcript-count hint. Exact molecule points require a readable
`transcripts.parquet` or native transcript grid data.

## Annotations, ROI, And Embeddings

Use `Annotations` to load built-in analysis labels or import local CSV/JSON
annotations. Use `ROI` to draw box or lasso regions, save them as annotations,
export ROI cells or transcripts, and inspect top ROI genes.

The `Cell` tab loads UMAP/t-SNE projections when the dataset provides standard
analysis CSVs. Clicking an embedding point selects the matching spatial cell.

## Diagnostics

`Diagnose Dataset` checks the manifest and required byte-range reads, then
summarizes optional dataset assets. `Download Diagnostics` writes a local JSON
dump with current controls, active errors, diagnostics, performance budget, and
local telemetry events. No telemetry is sent off-device by the app.
