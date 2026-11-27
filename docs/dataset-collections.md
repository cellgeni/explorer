# Dataset Collections

A dataset collection is a JSON file that lists datasets to browse together,
such as the sections of one study. Open it with `collection=` in the
viewer's address:

```text
https://cellgeni.github.io/explorer/?collection=https://host/study/collection.json
```

A collection given where a dataset goes (`dataset=`, the dataset form, or a
folder whose `explorer.json` is a collection) reloads the viewer with it as
`collection=`.

An AnnData table that holds several sections opens as a collection too, one
dataset per section; see [Sections Of One Table](#sections-of-one-table).

The viewer opens the first dataset and lists the collection's datasets in a
bar under the canvas. Choosing one opens it in place of the current dataset
and keeps the selected genes, the annotation set and how cells are coloured,
so you can step through sections with the same gene or cell type. One
dataset is open at a time; sections registered to it can be shown
[side by side](#side-by-side) with it, sharing its view, and serial sections
with depths can be [stacked in 3D](#3d-stack).

The datasets of a collection are expected to share their genes and their
annotation and metadata columns, such as one `cell_type` column with the
same categories in every section.

The format is defined by
[`public/schemas/explorer-collection.v1.json`](../public/schemas/explorer-collection.v1.json)
(JSON Schema 2020-12) and enforced by `parseDatasetCollection`
(`src/datasets/datasetCollection.ts`).

## Example

[`docs/collections/spcox.json`](./collections/spcox.json) lists the 18
Xenium sections of the
[SPCOX spinal cord time course](https://www.sciatlas.org/SPCOX/), three per
time point, and the snRNA-seq atlas they are compared with. Each entry is an
AnnData Zarr store on the group's bucket, which the viewer reads directly,
and each section names its morphology image and its cell segmentation, two
OME-Zarr stores next to it. The sections' coordinates are pixels of that
image:

```json
{
  "$schema": "https://cellgeni.github.io/explorer/schemas/explorer-collection.v1.json",
  "version": 1,
  "name": "Spinal cord Xenium time course (SPCOX)",
  "root": "https://spco.cog.sanger.ac.uk/SPCOX/",
  "datasets": [
    {
      "dataset": "SPCOX-Sham-A-anndata.zarr",
      "image": "SPCOX-Sham-A-raw.zarr",
      "labels": "SPCOX-Sham-A-label.zarr",
      "coordinates": "image-pixels",
      "name": "Sham-A",
      "group": "Sham"
    },
    {
      "dataset": "SPCOX-1dpi-A-anndata.zarr",
      "image": "SPCOX-1dpi-A-raw.zarr",
      "labels": "SPCOX-1dpi-A-label.zarr",
      "coordinates": "image-pixels",
      "name": "1dpi-A",
      "group": "1 dpi"
    },
    {
      "dataset": "SPCO-snRNAseq-anndata.zarr",
      "name": "snRNA-seq atlas",
      "group": "snRNA-seq"
    }
  ],
  "defaults": { "genes": ["Aqp4"], "geneRange": [null, "p95"] }
}
```

[`docs/collections/gbm-space.json`](./collections/gbm-space.json) lists the
97 Visium sections of the
[GBM-space glioblastoma atlas](https://www.gbmspace.org/webatlas2/GBM),
grouped by patient, and its snRNA-seq atlas of 1,025,329 nuclei. The sections
open over their H&E, which the stores carry in `uns/spatial`. The atlas takes
about 30 s to open. The nine sections of patient AT15 are Visium CytAssist
11 mm, with counts about ten times higher than the others, so on a shared
scale (a top score typed in `Gene scale`) they leave the other sections dim.

[`examples/zenodo/21110855-liver-sections.json`](../examples/zenodo/21110855-liver-sections.json)
stacks seven serial Xenium sections of human liver from the
[LYNX study](https://zenodo.org/records/21110855), 5 µm apart, in
[3D](#3d-stack). It is in the start screen's examples. Each entry is a
dataset manifest in
[`21110855-liver-sections/`](../examples/zenodo/21110855-liver-sections/)
that opens the section's zipped SpatialData store in the store's `aligned` coordinate system, which registers
its cells to section 04, and sets the stores' scale, 0.2125 µm per unit.
Section 04, the reference, opens in `global` over its morphology image. The
other sections' images are rotated in `aligned`, so they are not shown. In
headless Chromium with the GPU, the first section and the previews in view
settle about 23 s after the link opens (48 MB), and the stack about 17 s
after `Stack in 3D` (34 MB more).

## Fields

| Field         | Required | Value                                                                                                    |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `version`     | Yes      | `1`                                                                                                      |
| `datasets`    | Yes      | The datasets, 1 to 500, in the order the bar lists them. See [Datasets](#datasets)                       |
| `name`        | No       | Display name, shown in the collection bar                                                                |
| `description` | No       | What the collection holds                                                                                |
| `source`      | No       | Where the data comes from, with the same keys as a [manifest's](./dataset-manifest.md#source) `source`   |
| `root`        | No       | Base for relative dataset paths instead of the collection's folder. Relative to the collection, or a URL |
| `defaults`    | No       | Display settings for the first dataset opened. See [Defaults](#defaults)                                 |
| `$schema`     | No       | Schema URL for editor completion and checking; the viewer ignores it                                     |

Unknown fields are errors, as in a dataset manifest.

### Datasets

| Key                 | Required | Value                                                                                                                                                                         |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataset`           | Yes      | What `dataset=` opens: a dataset folder, file or store, a [dataset manifest](./dataset-manifest.md), or [one section of a table](#sections-of-one-table). Relative or http(s) |
| `name`              | No       | Label in the bar. Without it, the bar shows the last part of the path. The top bar prefers the manifest's own name                                                            |
| `group`             | No       | Group label, such as a time point or donor                                                                                                                                    |
| `image`             | No       | An image to show under an AnnData dataset's cells. Relative or http(s). See [Images](#images)                                                                                 |
| `coordinates`       | No       | `micrometers` (default) or `image-pixels`: what the dataset's cell coordinates are in. Needs `image`                                                                          |
| `labels`            | No       | A segmentation drawn as cell boundaries: a label mask covering `image` (OME-Zarr or TIFF), or polygons (Parquet, GeoJSON, WKT). See [Labels](#labels). Needs `image`          |
| `labelsFormat`      | No       | `label-zarr`, `label-tiff`, `parquet`, `geojson` or `wkt`: the format of `labels` when its name does not tell it. Needs `labels`                                              |
| `labelsCoordinates` | No       | `micrometers` or `image-pixels`: what polygon coordinates are in. Defaults to `coordinates`. Needs `labels`                                                                   |
| `labelColumn`       | No       | The obs column holding each cell's label value, or its polygon's ID. See [Labels](#labels). Needs `labels`                                                                    |
| `coordinateSystem`  | No       | A name for registered coordinates, such as `patient-1`. See [Side by Side](#side-by-side)                                                                                     |
| `z`                 | No       | The section's depth in its coordinate system, in micrometres. See [3D Stack](#3d-stack). Needs `coordinateSystem`                                                             |
| `customImages`      | No       | Images to open over the dataset's own, for any platform: `[{ "url": path, "opacity": 0–1 }]`. See [Custom Image Layers](#custom-image-layers)                                 |

- Paths resolve and are checked like
  [manifest paths](./dataset-manifest.md#paths): against `root` when set
  (keeping a query on the root), otherwise against the collection's folder.
  Other schemes such as `s3://` are rejected.
- Each dataset may appear once, because the address names the open dataset
  by its URL.
- The bar lists groups in the order they first appear, each with its
  datasets in file order. Entries without a group are listed where they
  appear.
- An entry that points at a manifest gets that manifest's files, options and
  defaults, including an H5AD manifest's image and labels. A collection does
  not repeat them; an entry that names an image replaces the manifest's.

### Images

An AnnData table (an `.h5ad` file, an AnnData Zarr store or an Icechunk
repository) has no image of its own unless it is Visium. `image` names one
to show under its cells, as the dataset's image layer: OME-Zarr, including
`bioformats2raw` stores such as those Bio-Formats and WebAtlas write,
OME-TIFF, TIFF, QPTIFF, SVS or NDPI. The path resolves like `dataset`.
An OME-Zarr image needs `.zarr` in its own name or in the name of the store
it sits in, so an image group such as `sample.zarr/images/he` works. The
group is read on its own: a SpatialData store's coordinate transformations
are not, so its coordinates must match the table's as `coordinates` below
describes. To use them, open the whole store as SpatialData instead.

`coordinates` says how the table's `obsm` coordinates relate to the image:

- `micrometers`, the default: they are micrometres, as the viewer reads
  AnnData coordinates, and the image is placed by its own pixel size.
- `image-pixels`: they are the image's full-resolution pixels, as WebAtlas
  writes them. The viewer scales them by the image's micrometres per
  pixel, so the scale bar and distances are in micrometres. For SPCOX that is
  0.2125 µm per pixel.

The image then behaves as the dataset's own:

- It loads in the background once the cells are drawn, with its
  channels in the Image section. With `Morphology image` off it is not
  drawn, though `image-pixels` still reads its metadata to place the cells.
- Previews do not draw the image. With `image-pixels`, each preview reads the
  image's metadata (about 15 KB for SPCOX) to place its cells.
- A link that names a dataset as well as the collection opens the dataset once
  the collection is read, so it opens over its image.
- The image belongs to the collection: the same dataset opened on its own has
  none, until a collection that pairs it with one has been read in that tab.
  To give a dataset its image wherever it is opened, name it in the dataset's
  [manifest](./dataset-manifest.md#anndata-with-an-image) instead.
- Only AnnData tables take one. Other platforms, and Visium tables, keep their
  own image; an entry's `image` is then ignored, with a notice under
  Fallbacks. To open more images over a dataset of any platform, list them
  under [`customImages`](#custom-image-layers).
- To check alignment, zoom in until nuclei show in the image; each cell's
  point should sit on its nucleus.

See [Attached Image](./modalities/h5ad.md#attached-image) for how it is read.

### Custom Image Layers

`customImages` opens more images over a dataset's own, for any platform, as
the Image section's `Custom image URL` does: each Xenium section's focus
image with its post-Xenium H&E, for example.

```json
{
  "version": 1,
  "root": "https://bucket.example.org/study/",
  "datasets": [
    {
      "dataset": "run-7",
      "name": "Section 7",
      "customImages": [
        { "url": "run-7/post-xenium/he_registered.ome.tif" },
        { "url": "run-7/if_panel.ome.tif", "opacity": 0.6 }
      ]
    },
    {
      "dataset": "run-8",
      "name": "Section 8",
      "customImages": [{ "url": "run-8/post-xenium/he_registered.ome.tif" }]
    }
  ]
}
```

- Each `url` resolves like `dataset`, so against `root`, not against the
  dataset's folder.
- The list replaces the one the dataset's manifest gives in
  [`defaults.customImages`](./dataset-manifest.md#custom-image-layers); an
  empty list opens none. An entry without `customImages` opens the
  manifest's.
- The layers open as a manifest's do: in order, once the dataset is ready,
  each placed by its own pixel size from the dataset's origin, so an H&E
  must already be registered to the section. Links leave them out while they
  are what is shown, and a link that lists its own opens those instead.
- Like `image`, the list belongs to the collection: the dataset opened on its
  own opens its manifest's layers, until a collection that lists some for it
  has been read in that tab.
- A section shown beside the main view shows only its own image.

### Labels

`labels` names a segmentation to draw as the dataset's cell boundaries:

- a **label mask**, whose pixel values are cell labels and 0 is background: an
  OME-Zarr label image, including a `bioformats2raw` store such as the one
  WebAtlas publishes next to each section (`-label.zarr`), or a TIFF, such as
  Cellpose's `_cp_masks.tif`;
- or **polygons**, one per cell: Parquet (GeoParquet, a WKB or WKT column, or
  one row per vertex as in Xenium's `cell_boundaries.parquet`), GeoJSON, or
  WKT text.

These are the formats and readers of an image's
[imported segmentation](./image-only-and-geojson.md#imported-segmentations).
The format comes from the name (`.zarr`, `.tif`, `.parquet`, `.geojson`,
`.wkt`, `.csv`, …) unless `labelsFormat` sets it. A name that tells none,
such as `cells.zarr.zip` or `sample.zarr/0`, is read as OME-Zarr.

For example, a SPCOX section outlined by its Xenium run's
`cell_boundaries.parquet` instead of the WebAtlas mask, with the polygons in
micrometres while the cells are in image pixels:

```json
{
  "dataset": "SPCOX-Sham-A-anndata.zarr",
  "image": "SPCOX-Sham-A-raw.zarr",
  "coordinates": "image-pixels",
  "labels": "https://example.org/sham-a/outs/cell_boundaries.parquet",
  "labelsCoordinates": "micrometers",
  "name": "Sham-A",
  "group": "Sham"
}
```

- **Which cell (mask).** Label N outlines the cell whose label value is N.
  The values come from:
  1. `labelColumn`, an obs column of whole numbers or of strings of them.
     A column that is missing, or holds no whole numbers, shows as a
     `Cell boundaries` error when boundaries load.
  2. Without it, as for a SpatialData table: the table's SpatialData instance
     key (its `instance_key` attribute, or `uns/spatialdata_attrs`), else the
     shortest obs column with "label" in its name, whichever holds whole
     numbers for more than half the cells.
  3. Otherwise the obs names, as in Vitessce: label 12 is the cell named
     `12`. SPCOX's tables work this way.

  The log says which column matched. Labels that no cell has are not drawn.
  A SpatialData table's obs names need not be its labels: the Xenium ovary
  table in `AU14_S14_final.zarr` names its cells 0, 1, ..., keeps labels
  1, 2, ... in `cell_labels`, and has the cell barcode as its instance key.
  It matches by `cell_labels`, and all 905 cells in a 300 × 250 µm window
  sit inside their own outlines; by obs name, none would.

- **Which cell (polygons).** Each polygon's ID, read as for an imported
  segmentation (a `cell_id`, `label`, `EntityID`, `id` … column or property),
  names its cell: the cell whose `labelColumn` value is that ID, or, without
  `labelColumn`, whichever of the obs names, the instance key, and the obs
  columns with "label" in their name or named `cell_id`, `cell`, `id`,
  `barcode`, `EntityID`, `object_id` or `instance_id` holds the most polygon
  IDs. A SPCOX table names its cells 1, 2, ... and keeps the Xenium IDs
  (`aaaaeagj-1`) in obs `cell_id`, so Xenium polygons match by `cell_id`
  without naming it. The log says what matched and how many polygons
  (`16,597 of 16,597 polygons matched to cells by obs column cell_id`).
  Polygons that no cell has are not drawn, and a cell with several keeps its
  largest. A file that matches no cell shows as a `Cell boundaries` error
  naming one of its IDs.

- **Where.** A mask covers the same area as `image`, so its pixels are scaled
  to the image's extent. A mask on the image's own pixel grid, such as
  SPCOX's, lines up pixel for pixel; a downsampled one is stretched to fit.
  The mask's own pixel size is not used: bioformats2raw writes 1 when it has
  none. Polygon coordinates are in `labelsCoordinates`, by default the
  cells' `coordinates`: micrometres, as Xenium writes them, are used as they
  are, and image pixels are scaled by the image's pixel size. Polygons far
  beyond the image, or only in its top-left part, get a line in the log
  suggesting the other units.

- **Drawing.** `Cell boundaries` starts on, and outlines load for the view as
  for Xenium: once fewer than the Boundary limit's cells (50,000 by default)
  are in view. A [panel](#side-by-side) beside the main view draws them too
  when its boundaries button is on. A mask is read from the finest pyramid level whose pixels in
  view fit 16 million, and traced in the decode workers. A
  polygon file is read whole in a worker the first time boundaries load,
  then kept. Outlines are coloured like the cells; hovering one shows its
  cell.
- For SPCOX (headless Chromium with the GPU), the full view of Sham-A (16,597
  cells) reads its outlines from a coarse level: 8 label chunks, 0.8 MB. A
  field about 1.3 mm wide reads 12 chunks (1.4 MB) and one about 300 µm wide
  12 chunks (0.75 MB), each done within 2.6 s of zooming. A Xenium-style
  `cell_boundaries.parquet` for the same section (574,093 vertex rows,
  2.3 MB) is read in 4 requests and matched to all 16,597 cells; a label TIFF
  at a quarter of the image's resolution reads 3 requests (18 KB) for a field
  about 250 µm wide.

### Defaults

The dataset manifest's cross-dataset display settings: `genes`,
`colorCellsBy`, `geneColorScale`, `geneRange`, `geneScoreMode`, and
`cellPointScale`, with the [same values](./dataset-manifest.md#defaults).
`geneRange` puts every section's colours and previews on one fixed scale.
With a percentile top, such as `[null, "p95"]`, each section, open or
previewed, tops out at that percentile of its own scores. Layer toggles,
opacities
and image channels belong to each dataset, so set them in that dataset's
manifest.

- The defaults apply to the first dataset opened from the collection, over
  that dataset's own manifest defaults.
- A link that names a dataset as well as the collection is a shared view, so
  the link's settings apply instead.
- A value that is not one of the listed options is ignored, with a line in
  the log.

## Switching Datasets

Choosing a dataset in the bar opens it the way a shared link would, with:

- the selected genes,
- the `Cell color` mode,
- the `Combine genes` mode,
- the loaded annotation set, its hidden classes and class colours, and
  whether the set is hidden,
- the metadata column cells are coloured by.

The gene colour scale and the opacities stay as they are. A gene, set or
column missing from the next dataset is handled as it is for a shared link:
the gene is dropped and the set or column is not loaded.

The view fits the next dataset, unless both are in the same
[coordinate system](#side-by-side): then it stays where it is, so the same
place shows in the next section.

### Class Colours

A class keeps its colour from one dataset to the next, including a colour
you picked. AnnData classes come in the order of their column's categories,
the order scanpy colours them in, so datasets with the same categories give
each class the same colour even when opened on their own or from a link. A
class that only the next dataset has takes the next free colour.

Each switch adds a browser history entry, so Back returns to the previous
dataset of the collection. The first dataset a collection link opens replaces
the link's entry, so Back from it leaves the collection.

## Previews

Each dataset in the bar has a preview: its cells in grey, so the tissue
shows, and the cells that score above zero for the selected genes in the
gene colour scale, using the same `Combine genes` mode as the main view.
Where several cells share a pixel, the highest score shows, as the main view
draws the highest-scoring cells on top. Without genes, or when cells are
coloured by transcript count or cell area, previews show the tissue only.

While cells are coloured by an annotation set, previews show its classes in
the main view's colours instead. A class the main view has not coloured yet
takes the colour its dataset stores, or else the next free colour, in the
order the previews read the classes. It has that one colour in every
preview, panel beside the main view and the 3D stack. Hidden classes fade
to a faint grey, as in the main view, so hiding all but one cell type (Alt- or Shift-click its checkbox in the legend
or in Cells › Clusters, or press Enter on it) shows where it is in every section;
each preview then counts the cells of the shown classes (`1,204 cells`),
each once. A cell in a hidden class and a shown one (the `All` set) is
drawn in the shown one, as in the main view. The
bar's left side names the set and how many classes are hidden. A set is read
once per dataset and selection, like a gene. While a switch loads the next
dataset's set, previews show the tissue only; the classes they read are kept,
so they are coloured again, without another read, once it loads.

While cells are coloured by a metadata track (`Cell color` › `Metadata`),
previews show each cell's value of the track of the same ID in the main
view's metadata colours. Every preview, panel beside the main view and the
3D stack share one range: the open dataset's, widened to every value the
previews have read, so a colour is one value in every section. Sections of a
block can each hold a narrow part of the range, or one value (a depth such
as `z_um`), which on the open section's range alone would colour every other
section at its ends. The main view keeps its own range, the one its legend
gives. The bar's left side names the track and gives the shared range, which
can widen as previews further along are read. A dataset without the track,
such as one whose table lacks the column, shows the tissue only; so does any
dataset but the open one for an imported track, whose values only the open
dataset has. The open dataset's preview takes the values the main view has
read or imported.

- **Each its own scale, or one.** On Auto, or with a percentile top
  (`geneRange=,p95`), each preview runs from 0 to its own 99th (or that)
  percentile, so it shows where a gene is high within that section and one
  outlier cell does not wash the rest out. The percentile is of the
  preview's drawn pixels, each showing the highest of its cells, not of
  the cells: at 112 × 64 px a pixel covers many cells, so a percentile of
  the cells would leave most pixels at the top colour. A preview's top is
  therefore above the main view's for the same section. The bar's left
  side shows the gene and the percentile (`0 – p99`), and each preview its
  own top (`top 50`; its title adds the highest score). Typing a top score in
  `Gene scale` puts every preview on that one scale instead, to compare
  levels across sections; each preview then shows its highest score
  (`max 92`).
- **What is read.** A preview reads every cell's position once per dataset,
  then the selected genes' scores for every cell, the annotation set's
  classes, or the metadata track's values, whenever the selection changes.
  Positions
  come from the same readers as the main view, so a previewed dataset
  opens faster when chosen. Beyond 200,000 cells, every Nth is drawn, but
  every cell that scores and every cell of a small shown class is, so a rare
  cell type still shows. A stored NaN or infinite score counts as none, as in
  the main view.
  A preview that could not be read is tried again when it comes back into
  view.
- **Grid.** `Expand` (the arrows next to "Collection" in the bar) lays the previews out as a grid over the
  view, larger, with groups side by side where they fit, so a collection
  of about twenty sections fits on one screen. The layer panel stays open
  beside it, so changing the genes or the annotation set redraws the grid.
  Choosing a dataset opens it and returns to the bar, as do `Collapse` and
  Escape.
- **When.** Only previews in view, and those just beyond the bar's ends or
  the grid's edges, are read, four datasets at a time. None start while the main view loads a
  dataset. `Previews` (the picture icon next to "Collection") turns them off and
  lists names only.
- **No preview.** Image-only and Visium HD datasets show "No cells to
  preview". A plain `.h5ad` whose reported size is over 64 MiB shows its size
  instead: such a file is read by range, at a cost that depends on how it is
  laid out, so it is left to be opened, which reads it as usual.

How much a preview reads depends on how each dataset stores its expression
matrix. A matrix chunked by gene, such as an AnnData Zarr `X` written in
blocks of a few genes, gives one gene for all cells in one small read. A
sparse matrix stored cell by cell has to be read whole for one gene, which
is only practical for small datasets.

For SPCOX, a dataset's first preview reads about 1 MB in 55 requests, mostly
its cell table, and the eight previews in view fill about 5 s after the
first dataset opens. A new gene then reads 100 to 500 KB per section, about
2.7 s for the eight.

## Side by Side

Any datasets of a collection can be shown side by side, up to four at once.
Sections registered to each other open with one view: pan or zoom any of
them and the others follow. Others open with a view each, and can be linked
by hand.

### Registered Coordinates

Give each registered section the same `coordinateSystem`:

```json
{
  "version": 1,
  "datasets": [
    {
      "dataset": "p1-s1.zarr",
      "name": "S1",
      "group": "Patient 1",
      "coordinateSystem": "patient-1"
    },
    {
      "dataset": "p1-s2.zarr",
      "name": "S2",
      "group": "Patient 1",
      "coordinateSystem": "patient-1"
    },
    {
      "dataset": "p2-s1.zarr",
      "name": "S1",
      "group": "Patient 2",
      "coordinateSystem": "patient-2"
    },
    { "dataset": "atlas.zarr", "name": "snRNA-seq atlas" }
  ]
}
```

The name is the collection's own: entries with the same one have their cells
in one frame, so a point in one section is the same place in the others.
The viewer does not register sections. Their coordinates, as the viewer reads
them, must already be registered: an AnnData table's `obsm` coordinates
(micrometres, or image pixels scaled by the image's pixel size with
`coordinates: "image-pixels"`), a SpatialData store's coordinate system, or
a platform's own cell positions. Images must be placed in the same frame
without rotation, as the viewer only places images that are axis-aligned.
Entries without `coordinateSystem`, such as an atlas, are opened as before.

### Showing Sections

With a dataset of the collection open, the bar shows a `Show beside` toggle
(two columns) on every other dataset of the collection. Turn it on and the
dataset opens in a panel beside the main view; turn it off, or close the
panel with its ×, and it goes. Up to three panels show at once: two
viewers sit side by side, three in a row, four in a 2 by 2 grid; under
860 px they stack.

- **Panels.** A panel draws the section's cells from its
  [preview](#previews) data: every cell as a point 10 µm across, coloured as
  the main view colours cells: by the selected genes on the `Gene scale`
  (each section up to its own percentile, or a typed top shared by all), by
  the annotation set's classes, with hidden classes faded, or by a metadata
  track's values, over the range the previews share, with cells without a
  value faded. Otherwise cells are grey. Hovering a cell names it and its class or
  value, or gives its score. The
  panel's name heads it, with its top (`top 32`) or highest score.
- **Images.** The image button in a panel's header loads the section's
  image under its cells: the image the section opens with in the main view,
  without opening it there. The channels button beside it then lists the
  image's channels, to show, colour and window each one in that panel alone,
  as the Image section does for the main view; its `Cells` box hides the
  cells to see the image alone. A panel starts from the main view's colour
  and window for channels of the same name, so sections compare on one
  scale, and auto-windows the others. A section without cells, such as an
  image, shows its image at once.
- **Cell boundaries.** The boundaries button (two outlines) in a panel's
  header draws the section's cell boundaries in that panel: the outlines the
  section draws in the main view, from its own files or the collection's
  `labels`, read for the panel's view once fewer cells than the main view's
  `Boundary limit` are in it, after the panel's view rests for 180 ms, as
  the main view does. They are drawn as there: in each cell's colour,
  filled while cells are coloured, in place of the cell's point, with the
  main view's `Cell fill` and `Boundary` opacities, and hovering one names
  its cell. Zoomed out further, a note at the panel's foot says how many
  cells are in view; a section without boundaries says so instead. The
  panel keeps its dataset open while they are on, so a polygon file read
  whole is read once. Hiding the panel's cells (`Cells` in its channels
  popover) hides its outlines too. Outlines follow no z plane or time
  point: a label image's first is read.
- **The open dataset beside itself.** The Image section's `Show beside`
  opens the open dataset's own image in a panel, linked, with channels of
  its own, to compare channel sets of one image. It takes the image the
  main view has open rather than reading it again. It works with or without
  a collection, and closes when another dataset opens outside the
  collection.
- **What a panel does not show.** Nucleus boundaries, transcripts and the
  tools (selection, Magic Lens, measuring, cards) are the main view's only.
  To use them on a section, choose `Open` in its panel: it swaps places
  with the main view's dataset, which takes the panel's image and cell
  boundaries if the panel showed them.
- **Linked and unlinked.** A section registered to the open one (the same
  `coordinateSystem`) opens linked: it shows the same point at its centre at
  the same scale, and pan or zoom any linked viewer and the others follow.
  Fit, the zoom buttons, the minimap and the keyboard act on the main view,
  and linked panels follow. Any other section opens unlinked, fitted to its
  own cells, and pans and zooms on its own. The chain button in a panel's
  header links or unlinks it. Linking keeps the panel where it is, at an
  offset from the main view: line two sections up by hand, link them, and
  they move together. `Reset the offset` (the target button) puts a linked
  panel at the main view's centre and zoom; an unlinked panel has `Fit` in
  its place. Offsets move and zoom; they do not rotate.
- **What is read.** A panel reads what a preview reads, whether the bar shows
  previews or not, before the previews in view. Images, Visium HD and large
  plain `.h5ad` files have no preview, so their panels say why instead. A
  panel's image is read only while it is shown, tile by tile as the main
  view's is, with a smaller cache of decoded tiles.
- **Opening another section.** Choosing a panel's section swaps it with the
  open one, each viewer keeping what it shows. Choosing another section of
  the coordinate system in the bar keeps the view and the panels. Another
  dataset of the collection opens fitted, and the panels stay where they
  are, unlinked. A dataset outside the collection closes the panels. The
  panels change when the next dataset
  opens: while it loads, and if it cannot be opened or is cancelled, the open
  dataset keeps its own.

## 3D Stack

Serial sections registered to each other can be stacked in 3D, each at its
depth in the block, with the genes or cell types highlighted through all of
them. Give each section of the coordinate system a `z`:

```json
{
  "version": 1,
  "datasets": [
    { "dataset": "p1-s01.zarr", "name": "S01", "coordinateSystem": "patient-1", "z": 0 },
    { "dataset": "p1-s02.zarr", "name": "S02", "coordinateSystem": "patient-1", "z": 10 },
    { "dataset": "p1-s05.zarr", "name": "S05", "coordinateSystem": "patient-1", "z": 40 }
  ]
}
```

`z` is in the units the sections' cells are in, micrometres, such as each
section's distance from the first one cut. Sections need not be evenly
spaced or listed in order. Every section of a coordinate system has a `z`,
or none does; a collection that mixes them is refused, naming the entries.
The sections must be registered as for [side by side](#registered-coordinates):
the viewer places each at its depth but does not move, rotate or warp it.
A section whose cells have their own z (a third obsm `spatial` column) has
them drawn at its depth plus their z. Sections already combined in one file
with such a column need no collection: the Cells section's
[3D cell view](./ui-reference.md#3d-cell-view) shows them, and the file can
also be [split into its sections](#sections-of-one-table).
For SpatialData stores, a dataset manifest can open each section in the
coordinate system that registers it, as the
[LYNX liver collection](../examples/zenodo/21110855-liver-sections.json)
does.

With a stacked section open, the bar's `Stack in 3D` button (three layers)
shows every section of its coordinate system over the views. `2D View`, or
the button again, returns to them.

- **What is drawn.** Each section's cells from its [preview](#previews) data,
  as balls 10 µm across, coloured as the main view colours cells: by the
  selected genes on the `Gene scale` (each section up to its own percentile,
  or a typed top shared by all, as in the previews), by the annotation set's
  classes, or by a metadata track's values over the range the previews
  share, shown beside `Depth`. Cells that score for the genes, are in a shown class,
  or have a value of the track are solid. The others are a faint outline of
  the tissue that never hides a coloured cell; `Other cells` turns it off.
  Without genes, an annotation set or a metadata track, every cell is grey.
  `Cell point size` sizes the cells.
- **Depth.** Sections a few micrometres apart across millimetres of tissue
  are flat at their true spacing, so the stack opens stretched along z by a
  power of two, to about a quarter as deep as it is wide. `Depth` shows the
  stretch (×1 is the true spacing) and changes it from ×¼ to ×128.
- **Moving.** Drag to rotate, Shift-drag to pan, scroll to zoom; the
  fit button returns to the first view. The axes at the top right turn with
  the stack to show which way x (red), y (green) and z (blue) increase;
  clicking one turns the stack to look along it (y shows the sections side on,
  as layers), and clicking it again looks from the other side. Hovering a cell names its section and
  the cell and its class, or gives its score. The canvas is a Tab stop, as
  the [3D views](ui-reference.md#3d-view)' are: Shift with an arrow key
  rotates, arrow keys pan, + and − zoom, X, Y and Z look along an axis, and
  Home returns to the first view.
- **What is read.** Every section of the stack is read, whether the bar shows
  it or not, four at a time. The panel lists the sections still being read,
  and names those it cannot show: images, Visium HD and large plain `.h5ad`
  files have no preview, though the sections of one large table do.
- **Opening another section.** The bar stays under the stack. Choosing
  another section of the stack keeps it, and so does a section of another
  stacked coordinate system, which then shows its own stack. Any other dataset
  opens in 2D.

## Sections Of One Table

An AnnData table can hold several sections, its rows tagged by an obs
column, such as registered serial sections combined in one `.h5ad` with a
`section` column and each section's depth in `z_um`. Open the table with
`collection=` and the viewer splits it into one dataset per section:

```text
https://cellgeni.github.io/explorer/?collection=https://host/study/aligned.h5ad
https://cellgeni.github.io/explorer/?collection=https://host/study/aligned.h5ad%23obs.sample
```

The first form splits the table by its first obs column named `section`,
`section_id`, `section_name`, `slice`, `slice_id`, `sample`, `sample_id`,
`library_id`, `slide` or `slide_id` (any case), whether it holds labels or
numbers, as anndata stores whole-number IDs, with 2 to 500 values. The second
names the column: `#obs.<column>` after the table's URL, written
`%23obs.<column>` inside the viewer's address. A table without such a column
stops with an error that lists the columns it could be split by: label columns
with 2 to 500 values.
`.h5ad` files, AnnData Zarr stores and AnnData in Icechunk split alike. A
Visium table splits only into its libraries, by the obs column that names each
spot's `uns/spatial` library, whatever it is called (`library_id`, or
`spaceranger_id` when its values are the library names); each section shows
its library's spots on its own tissue image. Naming another column for a
Visium table stops with an error, since spots of several libraries have no one
image to sit on.

With such a column in the open table, the Cells section's `Open N Sections`
link opens the same collection.

- **Datasets.** One per value of the column, named by the value, in the
  column's order: a categorical's categories, numbers from lowest, else as
  first seen. Each is the table's rows with that value, with their cells,
  genes, obs columns, embeddings and gene values for the Plots panel.
- **Registered.** The sections share the table's obsm coordinates, so they
  are one [coordinate system](#registered-coordinates), named after the file,
  and can be shown [side by side](#side-by-side) with one view.
- **Depths.** A section's `z` is the value of a numeric obs column named `z`
  or `z_…` (`z_um`, `z_position`) shared by all its cells, else their third
  obsm `spatial` column when they share one. With a depth for every section
  the bar offers the [3D stack](#3d-stack); otherwise the sections are side
  by side only. Cells whose third `spatial` column varies within a section
  keep it relative to the section's `z`, which the stack adds back, so each
  cell is drawn at the z it has in the table. Opened on its own, such a
  section shows those relative depths.
- **One read.** The table is read once, by its own dataset, and each
  section is a view of its rows: switching sections, their previews and the
  stack read nothing more. The 64 MiB limit on [previews](#previews) of plain
  `.h5ad` files does not apply to them. EF6 skin's 116 MB `.h5ad` (14
  sections, 201,789 cells, from Sanger's bucket) listed its sections 12 s
  after the link opened, and switching sections took 0.3 s.

Each section has an address of its own, the table's URL and
`#obs.<column>=<value>`, percent-encoded:

```text
https://host/study/aligned.h5ad#obs.section=section_01
```

`dataset=` opens it on its own, named `aligned.h5ad · section_01` in the
top bar. A collection file can list sections this way, to give them its own
names, groups and depths, or to list only some:

```json
{
  "version": 1,
  "datasets": [
    {
      "dataset": "aligned.h5ad#obs.section=section_01",
      "name": "First",
      "coordinateSystem": "ef6",
      "z": 0
    },
    {
      "dataset": "aligned.h5ad#obs.section=section_14",
      "name": "Last",
      "coordinateSystem": "ef6",
      "z": 780
    }
  ]
}
```

## The Address

The address keeps `collection=` next to `dataset=`, so a copied link reopens
the collection with the same dataset and view, a `compare=` for each
section shown side by side, in order, with a `compareLink=` each when any
panel is not linked or unlinked as it opens by default (`1` linked or `0`
unlinked, then its offset or its own view as x, y and zoom), a
`compareImage=` each when any panel shows its image (`1` under its cells,
`only` alone) with its shown channels as `compareChannels=` (`-` for none),
a `compareBoundaries=` each when any panel draws its cell boundaries (`1`
for those that do), and `sectionView=3d` while the sections
are stacked in 3D (not the 3D camera). It keeps the bar's `Expand`
grid as `collectionView=grid`, with its `Size` as `collectionPreviewSize=`,
and `Previews` off as `collectionView=names`, so the bar opens the same way. Opening a dataset that is not
in the collection, from the dataset menu or `Load Dataset`, closes the
collection; so does the bar's close button.

A collection link without `dataset=` opens the first dataset. A collection
that cannot be read shows its error in the bar; without a `dataset=` to
open, the start screen opens too.
Opening a collection with `dataset=` instead of `collection=` stops with an
error that says so.

## Hosting

A collection needs CORS like a manifest, but not byte-range support. The
viewer reads it with `cache: no-cache`, so edits show on the next load. The
datasets it lists can be on any hosts the viewer can read.

## Editor Support

The schema is deployed with the viewer, at
`schemas/explorer-collection.v1.json` under the viewer's address: for the
hosted viewer,
`https://cellgeni.github.io/explorer/schemas/explorer-collection.v1.json`, as
in the [example](#example); for your own deployment, the same path under the
address the viewer is served from, including any subpath. Set `$schema` to
that URL and editors such as VS Code will complete field names and flag errors
as you type.

The schema catches blank names and paths, unknown fields, an entry listed
twice word for word, and options without what they need (such as `z` without
`coordinateSystem`). A collection for a newer `version` is refused for its
version first, as a manifest is. A collection file that does not answer
within 15 s, headers and body together, is reported as such, and one whose
body breaks off as broken off, not as "not JSON". The viewer checks more when it opens the collection: the
same dataset in two spellings (`a` and `./a/`), sections of one coordinate
system with and without `z`, and numbers too large to be finite, such as
`1e400`. A collection the schema passes can still stop the load, with a
message naming the entry.

## Known Limitations

- Panels beside the open dataset show their cells, image and cell
  boundaries only: no nucleus boundaries or transcripts, and no
  side-by-side embedding views. A panel's outlines are read at the image's
  first z plane and time point. Sections
  that are not registered are lined up by hand, by moving and zooming only.
- Panels draw every cell at one size, 10 µm across, so Visium spots are
  smaller than in the main view. So does the 3D stack.
- The 3D stack shows cells only: no images, boundaries or transcripts, and
  sections are placed only by depth, so registration (rotation, warping)
  must be done before the coordinates are written.
- Class colours are kept while you switch datasets, not written into the
  address: a link restores the set, its hidden classes and whether it is
  hidden, with the dataset's own colours.
- Previews do not show metadata colouring.
- Previews are listed in the collection's order; they cannot be sorted by
  expression yet.
- A collection cannot be opened from `Load Dataset`. Its card in the start
  screen's examples is a `collection=` link, which reloads the viewer
  rather than opening it in place.
- Labels need an image to be placed on.
