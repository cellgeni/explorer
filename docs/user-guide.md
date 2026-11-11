# Spatial Explorer User Guide

This guide walks through common tasks. For a control-by-control reference see
the [UI reference](./ui-reference.md).

## Loading Data

Open the dataset name menu in the top bar, paste a source URL in
`Dataset or image URL`, then choose `Load Dataset`. Supported sources are:

- Xenium output folders containing `experiment.xenium`.
- Standard Visium (55 µm spots) Space Ranger `outs/` folders.
- Visium HD Space Ranger output folders containing `binned_outputs/`.
- Direct AnnData `.h5ad` file URLs, including Visium files from scanpy,
  squidpy, or CELLxGENE.
- SpatialData Zarr store URLs, such as `sample.sdata.zarr`.
- Direct OME-TIFF, TIFF, QPTIFF, OME-Zarr, or validated NDPI image URLs.
- A [dataset manifest](./dataset-manifest.md) URL ending in `.json`.

Loading another dataset keeps the current one open until the new one is
ready. If the new one cannot be opened, for example because the address is
wrong, a message says why and the current dataset stays.

When a dataset folder contains an `explorer.json` manifest, the viewer reads
files from the locations it lists and applies its display defaults (genes,
cell colour, layer toggles, opacities, image channels). The activity log, in
the info drawer's Diagnostics section, shows `Using dataset manifest …` when
one is used.

`Morphology image` is enabled by default so the OME-TIFF layer loads with the
dataset when a source provides one. Visium and Visium HD relabel this control
as `Tissue image`. Disable it before loading when you only want cells, bins, or
overlays. Use `Boundary limit` (under Advanced, or in Settings) to control when
true Xenium cell polygons are requested for the current viewport.

The app detects the source platform before loading. Platform-specific controls
appear only when the active source supports them. For example, image-only
sources have no Cells or Transcripts section, Magic Lens or cell cards, while
Visium, Visium HD, H5AD, and SpatialData have no Transcripts section.

## Spatial Navigation

Use mouse pan and zoom for normal navigation. The spatial view is also keyboard
focusable:

- Arrow keys pan the spatial view.
- Shift plus an arrow key pans farther.
- `+` and `-` zoom in and out.
- `Home` resets to the fitted dataset view.

The URL hash updates with the current dataset URL, viewport, selected genes,
ROI, open panels, tool, cell card, hidden layers, and control state. `Share` in
the top bar copies the link to share the same view. Older links with `tab=`
still work.

## Layers And Genes

The layer panel's Image section controls dataset image opacity, image
channels, and custom image layers. Hover tooltips and the coordinate unit are
in Settings, and the Measure tool (`M`) measures distances. For an OME-TIFF
z-stack (such as Xenium `morphology.ome.tif` or Atera `morphology_3d/`),
`Z plane` picks the plane shown; it opens at the middle plane. Xenium, H5AD,
and cell-like views expose cell fill and boundary opacity under Cells ›
Appearance when cells are available. Visium HD exposes cell and nucleus
segmentation toggles there when segmented outputs are detected.

Custom image layers accept remote OME-TIFF or OME-Zarr URLs and render through
the same channel controls as dataset morphology.

The Cells section's Genes picker supports individual gene selection and
multi-gene signatures for Xenium, Visium HD, H5AD, and SpatialData. `Auto LOD`,
the default `Expression detail` under Advanced, loads expression for every
cell in datasets of up to 500,000 cells, the same as `All cells`, which
scores every cell on the slide. Larger datasets load the cells in view when
zoomed in. When zoomed out they load a sample that keeps every cell expressing
the selected genes and thins only the cells without. `Exact region` keeps the
current viewport exact when the region is small enough, and samples the same
way above that. Visium HD uses coarser bins when zoomed out. The default gene
scale is Plasma.

For H5AD and SpatialData, categorical and string `obs` columns load as
annotation sets, and numeric `obs` values appear in the Cell card for the
selected cell. Numeric `obs` columns are also listed as `Cell color` →
`Metadata` tracks as soon as the dataset loads; a track's values are read when
you first colour by it.

Imported CSV/JSON annotations and metadata tracks (Cells › Clusters) currently
require Xenium-format cell IDs such as `aaabbbcc-1`, so files keyed by H5AD or
SpatialData obs names are rejected.

For Visium HD, selected-gene overlays read the dataset's `feature_slice.h5`
(required for gene overlays) and paint the active square-bin grid. The Cell
card becomes the Bin card and reports selected-gene scores separately from the
all-gene bin profile.

## Transcript Overlay

The Transcripts section is Xenium-only and controls the molecule overlay
separately from cell expression coloring. In `Auto`, low and medium zoom use
native Xenium `transcripts.zarr.zip` aggregate levels as transcript-count
density squares, colored by the number of transcripts in each square. With
the `Selected genes` filter the squares count only the selected genes; with
`All features`, or no genes selected, they count all transcripts. The legend
on the canvas says which, and the square size. `Auto` switches from the
density overview to exact transcript points when the view's transcripts fit
the exact point budget.

Use `Show transcripts` to enable the overlay. `Detail` selects `Auto`,
`Density`, or `Exact`. Under Advanced, the `Exact points` meter shows the
view's transcripts against the budget; `Edit Max` changes the budget. `Min QV`
and `Gene-only calls` filter exact transcript records. `Opacity` and
`Point size` affect only the transcript overlay.

Density square colors are normalized against the largest square on the whole
slide at the current square size, rather than only the visible viewport, so
the color scale stays stable while panning.

`Density` uses the native grid pyramid and renders up to 1,500 count squares in
the current viewport. Feature filters are applied by `Exact`, where individual
transcript records can be loaded and inspected.

Use `Feature filter` to switch between all features and the currently selected
genes. `Feature search` can add genes directly from the Transcripts section.
The `Point color` control colors exact transcript points either by feature
identity or by QV.

When exact mode is close to the configured point budget, the section shows
`Load exact viewport` instead of starting the fetch automatically. Use it when
you intentionally want to load that dense exact viewport.

Transcript hover details show transcript IDs. Click a transcript point or
aggregate bin to pin the same inspection details in the Transcript card; close
the card (`Clear pinned transcript`) to unpin it. Aggregate bins show
aggregate identity and counts, not individual transcript identity. Cell IDs
are filled from `transcripts.parquet` when that file is available for
per-transcript assignment metadata.

If `transcripts.zarr.zip` is unavailable, all-feature views can still show a
cell-summary transcript-count hint. Exact molecule points require a readable
`transcripts.parquet` or native transcript grid data.

## Annotations, ROI, And Embeddings

Use Cells › Clusters to load built-in analysis labels or import local CSV/JSON
cell annotations when the active platform supports cell-id annotations. H5AD
categorical `obs` tracks appear as annotation sets.

The layer panel's Annotations section exposes `GeoJSON shapes` when geometric
annotations are available. Import GeoJSON `Feature` or `FeatureCollection`
files containing Polygon or MultiPolygon geometry, edit shape colors and
visibility, remove shapes, or export the current shapes as GeoJSON.

Use the Box selection (`R`) or Lasso selection (`L`) tool to draw box or lasso
regions. The Selection card shows the ROI: Xenium ROIs can be saved as
annotations (`Save ROI`), export selected cells or transcripts, and inspect top
ROI genes. Visium HD ROIs select bins and export barcodes. On image-only
sources a New shape card opens, and drawn geometry is saved as GeoJSON shapes
in the Annotations section instead of querying cells or genes.

The Magic Lens tool (`O`) is available for Xenium and Visium HD. It shows a
lens at the cursor; its options set the `Radius`, and `Summarise View` scans
the whole view. Results appear in the Magic Lens card. Xenium lens scans
summarize cells, their transcript counts, and top genes from the cell-feature
matrix. Visium HD lens scans summarize UMIs and bins.

The Embedding panel, opened from Cells › `Show Embedding`, loads UMAP/t-SNE or
H5AD `obsm` embeddings when the dataset provides them. Clicking an embedding
point selects the matching spatial cell or Visium HD bin. Selecting a spatial
or embedding cell also opens the Cell card with metadata, expression, shape
metrics when boundary geometry is available, and, for Xenium, a compact z-axis
distribution of molecules/transcripts assigned to that cell.

## Standard Visium

Standard Visium datasets load from a Space Ranger `outs/` folder or from an
`.h5ad` with `uns/spatial`. Spots are drawn as 55 µm circles over the tissue
image and keep that size as you zoom. Colour them by genes, by `obs` columns
or the Space Ranger graph-based clusters (Spots › Clusters), or by numeric
columns such as `total_counts` (`Cell color` → `Metadata`). Turn on
`Cell boundaries` in Spots › Appearance to draw spot outlines.

The `Visium dataset` panel, in the info drawer's View options, shows the
library, how many spots are shown, and the scale. Spots off the tissue are
hidden at first (CELLxGENE files keep every array spot); tick
`Show off-tissue spots` in Spots › Appearance to include them. A file with
several sections has a `Library` select in the panel. Both reload the spots
without downloading the file again, and keep your genes and colouring. The
scale is fitted from the spot grid (spots are 100 µm apart), so distances and
the scale bar are in micrometres even though Space Ranger only records pixels.
When it can only be estimated from the nominal spot diameter, a notice in
Data access notes says so. Use `Tissue image` in the Image section to switch
between the high-res and low-res images or hide the image. The share link
remembers the image, the library, and the off-tissue choice.

To load a GEO sample, whose Space Ranger files are renamed and gzipped, write a
[dataset manifest](./dataset-manifest.md#standard-visium) that names them and
enter the manifest's URL.

## Visium HD

Visium HD datasets show a `Visium HD dataset` panel in Bins › Appearance. Use
the bin-size segmented control to switch between detected 16 µm, 8 µm, and
2 µm tiers. The 2 µm tier uses filtered matrix barcodes and a grid basis derived
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
`DATASET.h5ad.json`, or an Icechunk repository named `DATASET.h5ad.icechunk`;
[Large H5AD files](./h5ad-reference.md) explains how to generate one. An
Icechunk repository holding AnnData, SpatialData, or an OME-Zarr image opens
from its `.icechunk` URL. See [H5AD](./modalities/h5ad.md) for the exact layout the reader
expects.

## SpatialData

SpatialData stores combine an AnnData table, shapes, labels, and images. The
app picks one coordinate system and image and logs them, together with any
elements it does not show, in the activity log. Table rows render as cells
placed on their annotated shapes or labels. Circles and polygons appear as cell
boundaries; labels (segmentation masks) are traced into cell outlines when you
zoom in below `Boundary limit`.

The info drawer's View options section shows the SpatialData view controls:

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
`.qptiff`, `.ome.zarr`, `.zarr`, `zarr.json`, `.zattrs`, and `.ndpi`. TIFFs
must be tiled with `SubIFD` pyramid levels (QPTIFF uses its own layout); see
[Image-only and GeoJSON](./image-only-and-geojson.md#supported-image-urls).

For image-only sources, use the Image section for image channels and custom
image layers, the Box and Lasso selection tools (with the New shape card) for
box or lasso shapes, and the Annotations section for GeoJSON shape
import/export. Gene expression, transcripts, cell details, cell annotations,
and Magic Lens remain hidden because there are no cells or molecules to query.

## Diagnostics

In the info drawer's Diagnostics section, `Diagnose Dataset` checks the
detected source and required byte-range reads, then summarizes optional assets
for that platform. With a dataset manifest, it also reports whether the
manifest is valid and checks files at the locations the manifest gives. The
download button next to
it writes a local JSON dump (`xenium-diagnostics.json`, for every platform)
with current controls, active errors, diagnostics, performance budget, and
local telemetry events. Transcript diagnostics include detected
transcript capabilities, native LOD availability, current transcript controls,
exact-budget decisions, and summarized hovered or pinned transcript/bin
inspection state. No telemetry is sent off-device by the app.
