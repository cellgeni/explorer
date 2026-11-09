# Spatial Explorer User Guide

This guide walks through common tasks. For a control-by-control reference see
the [UI reference](./ui-reference.md).

## Loading Data

Paste a source URL in `Dataset or image URL`, then choose `Load Dataset`.
Supported sources are:

- Xenium output folders containing `experiment.xenium`.
- Visium HD Space Ranger output folders containing `binned_outputs/`.
- Direct AnnData `.h5ad` file URLs.
- SpatialData Zarr store URLs, such as `sample.sdata.zarr`.
- Direct OME-TIFF, TIFF, OME-Zarr, or validated NDPI image URLs.
- A [dataset manifest](./dataset-manifest.md) URL ending in `.json`.

When a dataset folder contains an `explorer.json` manifest, the viewer reads
files from the locations it lists and applies its display defaults (genes,
cell colour, layer toggles, opacities, image channels). The Log shows
`Using dataset manifest …` when one is used.

`Morphology image` is enabled by default so the OME-TIFF layer loads with the
dataset when a source provides one. Visium HD relabels this control as
`Tissue image`. Disable it before loading when you only want cells, bins, or
overlays. Use `Boundary limit` to control when true Xenium cell polygons are
requested for the current viewport.

The app detects the source platform before loading. Platform-specific controls
appear only when the active source supports them. For example, image-only
sources hide Genes, Transcripts, Magic Lens, and Cell tabs, while Visium HD,
H5AD, and SpatialData hide Xenium transcript controls.

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
Xenium, Visium HD, H5AD, and SpatialData. `Auto LOD` loads expression for
every cell in datasets of up to 500,000 cells, the same as `All cells`, which
scores every cell on the slide. Larger datasets load the cells in view when
zoomed in. When zoomed out they load a sample that keeps every cell expressing
the selected genes and thins only the cells without. `Exact region` keeps the
current viewport exact when the region is small enough, and samples the same
way above that. Visium HD uses coarser bins when zoomed out. The default gene
scale is Plasma.

For H5AD and SpatialData, categorical and string `obs` columns load as
annotation sets, and numeric `obs` values appear in the `Cell` tab for the
selected cell. Numeric `obs` columns are also listed as `Cell color` →
`Metadata` tracks as soon as the dataset loads; a track's values are read when
you first colour by it.

Imported CSV/JSON annotations and metadata tracks (Annotations tab) currently
require Xenium-format cell IDs such as `aaabbbcc-1`, so files keyed by H5AD or
SpatialData obs names are rejected.

For Visium HD, selected-gene overlays read the dataset's `feature_slice.h5`
(required for gene overlays) and paint the active square-bin grid. The `Cell`
tab becomes `Bin Info` and reports selected-gene scores separately from the
all-gene bin profile.

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
cells, their transcript counts, and top genes from the cell-feature matrix; the
`Min QV` control is shown for Xenium but does not yet change the result.
Visium HD lens scans summarize UMIs and bins.

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
`tissue_positions.parquet` for first paint. With 2 µm selected, the view shows
16 µm bins until you zoom in past zoom level 3.

When segmented outputs are present, `Cell boundaries` and `Nucleus boundaries`
load viewport-scoped segmentation overlays. Annotated segmentation GeoJSON
colors and labels are preserved where Space Ranger provides them.

## H5AD

H5AD sources render cells as points from `/obsm/X_spatial`, `/obsm/spatial`, or
a supported embedding such as `/obsm/X_umap`. The app reads genes from `var`,
observations from `obs`, and expression from `/X` for supported dense, CSR, and
CSC layouts.

Files up to 300 MiB are downloaded whole and opened with the browser HDF5
reader. Larger hosted H5AD files need a sibling kerchunk reference JSON named
`DATASET.h5ad.json`. See [H5AD](./modalities/h5ad.md) for the exact layout
the reader expects.

## SpatialData

SpatialData stores combine an AnnData table, shapes, labels, and images. The
app picks one coordinate system and image and logs them, together with any
elements it does not show, in the `Dataset` tab log. Table rows render as cells
placed on their annotated shapes or labels. Circles and polygons appear as cell
boundaries; labels (segmentation masks) are traced into cell outlines when you
zoom in below `Boundary limit`.

The `Dataset` tab shows the SpatialData view controls:

- `Coordinate system` and `Image` switch the view and reload the dataset.
- `µm per unit` shows the scale used for distances, scale bars, and areas, and
  where it came from (declared by the store, estimated, or set by you). Enter a
  value and press `Set` to override it, or `Auto` to go back. When the scale is
  unknown, distances are labelled as units.

Genes, annotations, embeddings, selected-cell profiles, and ROI summaries work
as they do for H5AD. Transcripts (`points`) and Magic Lens are not available for
SpatialData yet. See [SpatialData](./modalities/spatialdata.md) for how the
coordinate system, table, shapes, labels, and image are chosen.

## Image-Only Sources

Image-only sources render the image pyramid without requiring transcriptomics
files. Supported URL forms include `.ome.tif`, `.ome.tiff`, `.tif`, `.tiff`,
`.ome.zarr`, `.zarr`, `zarr.json`, `.zattrs`, and `.ndpi`. TIFFs must be tiled
with `SubIFD` pyramid levels; see
[Image-only and GeoJSON](./image-only-and-geojson.md#supported-image-urls).

For image-only sources, use `Layers` for image channels and custom image layers,
`ROI` (shown as `Geometry`) for box or lasso shapes, and `Annotations` for
GeoJSON shape import/export. Gene expression, transcripts, cell details, cell
annotations, and Magic Lens remain hidden because there are no cells or
molecules to query.

## Diagnostics

`Diagnose Dataset` checks the detected source and required byte-range reads,
then summarizes optional assets for that platform. With a dataset manifest, it
also reports whether the manifest is valid and checks files at the locations
the manifest gives. The download button next to
it writes a local JSON dump (`xenium-diagnostics.json`, for every platform)
with current controls, active errors, diagnostics, performance budget, and
local telemetry events. Transcript diagnostics include detected
transcript capabilities, native LOD availability, current transcript controls,
exact-budget decisions, and summarized hovered or pinned transcript/bin
inspection state. No telemetry is sent off-device by the app.
