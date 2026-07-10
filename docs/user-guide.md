# Spatial Explorer User Guide

## Loading Data

Paste a source URL in `Dataset or image URL`, then choose `Load Dataset`.
Supported sources are:

- Xenium output folders containing `experiment.xenium`.
- Visium HD Space Ranger output folders containing `binned_outputs/`.
- Direct AnnData `.h5ad` file URLs.
- Direct OME-TIFF, TIFF, OME-Zarr, or validated NDPI image URLs.

`Morphology image` is enabled by default so the OME-TIFF layer loads with the
dataset when a source provides one. Visium HD relabels this control as
`Tissue image`. Disable it before loading when you only want cells, bins, or
overlays. Use `Boundary limit` to control when true Xenium cell polygons are
requested for the current viewport.

The app detects the source platform before loading. Platform-specific controls
appear only when the active source supports them. For example, image-only
sources hide Genes, Transcripts, Magic Lens, and Cell tabs, while Visium HD and
H5AD hide Xenium transcript controls.

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

The `Layers` tab controls dataset image opacity, hover tooltips, coordinate
units, distance measurement, image channels, and custom image layers. Xenium,
H5AD, and cell-like views expose cell fill and boundary opacity when cells are
available. Visium HD exposes cell and nucleus segmentation toggles when
segmented outputs are detected.

Custom image layers accept remote OME-TIFF or OME-Zarr URLs and render through
the same channel controls as dataset morphology.

The `Genes` tab supports individual gene selection and multi-gene signatures for
Xenium, Visium HD, and H5AD. `Auto LOD` chooses an appropriate expression query
for the current zoom and viewport; `Exact region` keeps the current viewport
exact when the region is small enough. The default gene scale is Plasma.

For H5AD, categorical `obs` columns load as annotations and numeric or boolean
`obs` columns load as metadata tracks. Set `Cell color` to `Metadata` to color
cells by a loaded numeric track.

For Visium HD, selected-gene overlays use Feature Slice H5 when available and
paint the active square-bin grid. The `Cell` tab becomes `Bin Info` and reports
selected-gene scores separately from the all-gene bin profile.

## Transcript Overlay

The `Transcripts` tab is Xenium-only and controls the molecule overlay
separately from cell expression coloring. In `Auto`, low and medium zoom use
native Xenium `transcripts.zarr.zip` aggregate levels as transcript-count
density squares, colored by the number of transcripts in each grid cell. `Auto`
switches from the density overview to exact transcript points when the visible
transcript estimate is inside the exact point budget.

Use `Show transcripts` to enable the overlay. `Detail` selects `Auto`,
`Density`, or `Exact`; `Exact budget` caps how many exact points the viewport
may load; `Min QV` and `Gene-only calls` filter exact transcript records.
`Opacity` and `Point size` affect only the transcript overlay.

Density square colors are normalized against the native dataset/LOD count domain
rather than only the currently visible viewport, so the color scale stays stable
while panning and zooming.

`Density` uses the native grid pyramid and renders up to 1,500 count squares in
the current viewport. Feature filters are applied by `Exact`, where individual
transcript records can be loaded and inspected.

Use `Feature filter` to switch between all features and the currently selected
genes. `Feature search` can add genes directly from the transcript tab. The
`Point color` control colors exact transcript points either by feature identity
or by QV.

When exact mode is close to the configured point budget, the tab shows
`Load exact viewport` instead of starting the fetch automatically. Use it when
you intentionally want to load that dense exact viewport.

Transcript hover details show transcript IDs. Click a transcript point or
aggregate bin to pin the same inspection details in the Transcripts tab; use
`Pin` from a hover panel or `Clear` on the pinned panel to manage the pinned
entry. Aggregate bins show aggregate identity and counts, not individual
transcript identity. Cell IDs are filled from `transcripts.parquet` when that
file is available for per-transcript assignment metadata.

If `transcripts.zarr.zip` is unavailable, all-feature views can still show a
cell-summary transcript-count hint. Exact molecule points require a readable
`transcripts.parquet` or native transcript grid data.

## Annotations, ROI, And Embeddings

Use `Annotations` to load built-in analysis labels or import local CSV/JSON cell
annotations when the active platform supports cell-id annotations. H5AD
categorical `obs` tracks appear as annotation sets.

The same tab exposes `GeoJSON shapes` when geometric annotations are available.
Import GeoJSON `Feature` or `FeatureCollection` files containing Polygon or
MultiPolygon geometry, edit shape colors and visibility, remove shapes, or
export the current shapes as GeoJSON.

Use `ROI` to draw box or lasso regions. Xenium ROIs can be saved as
annotations, export selected cells or transcripts, and inspect top ROI genes.
Visium HD ROIs select bins and export barcodes. Image-only ROIs save drawn
geometry as GeoJSON shapes instead of querying cells or genes.

`Magic Lens` is available for Xenium and Visium HD. Xenium lens scans summarize
transcripts and cells with QV controls; Visium HD lens scans summarize UMIs and
bins without transcript QV controls.

The `Cell` tab loads UMAP/t-SNE or H5AD `obsm` embeddings when the dataset
provides them. Clicking an embedding point selects the matching spatial cell or
Visium HD bin. Selecting a spatial or embedding cell also loads metadata,
expression, shape metrics when boundary geometry is available, and, for Xenium,
a compact z-axis distribution of molecules/transcripts assigned to that cell.

## Visium HD

Visium HD datasets show a `Visium HD dataset` panel in the Dataset tab. Use the
bin-size segmented control to switch between detected 16 µm, 8 µm, and 2 µm
tiers. The 2 µm tier uses filtered matrix barcodes and a grid basis derived
from a coarser tier; it does not read the full 2 µm
`tissue_positions.parquet` for first paint.

When segmented outputs are present, `Cell boundaries` and `Nucleus boundaries`
load viewport-scoped segmentation overlays. Annotated segmentation GeoJSON
colors and labels are preserved where Space Ranger provides them.

## H5AD

H5AD sources render cells as points from `/obsm/X_spatial`, `/obsm/spatial`, or
a supported embedding such as `/obsm/X_umap`. The app reads genes from `var`,
observations from `obs`, and expression from `/X` for supported dense, CSR, and
CSC layouts.

Files up to 300 MB load through the browser HDF5 path. Larger hosted H5AD files
need a sibling kerchunk reference JSON named `DATASET.h5ad.json`.

## Image-Only Sources

Image-only sources render the image pyramid without requiring transcriptomics
files. Supported URL forms include `.ome.tif`, `.ome.tiff`, `.tif`, `.tiff`,
`.ome.zarr`, `.zarr`, `zarr.json`, `.zattrs`, and validated `.ndpi` files.

For image-only sources, use `Layers` for image channels and custom image layers,
`ROI` for box or lasso geometry, and `Annotations` for GeoJSON shape
import/export. Gene expression, transcripts, cell details, cell annotations, and
Magic Lens remain hidden because there are no cells or molecules to query.

## Diagnostics

`Diagnose Dataset` checks the detected source and required byte-range reads,
then summarizes optional assets for that platform. `Download Diagnostics` writes
a local JSON dump with current controls, active errors, diagnostics, performance
budget, and local telemetry events. Transcript diagnostics include detected
transcript capabilities, native LOD availability, current transcript controls,
exact-budget decisions, and summarized hovered or pinned transcript/bin
inspection state. No telemetry is sent off-device by the app.
