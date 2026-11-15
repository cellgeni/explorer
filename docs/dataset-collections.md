# Dataset Collections

A dataset collection is a JSON file that lists datasets to browse together,
such as the sections of one study. Open it with `collection=` in the
viewer's address:

```text
https://cellgeni.github.io/explorer/?collection=https://host/study/collection.json
```

The viewer opens the first dataset and lists the collection's datasets in a
bar under the canvas. Choosing one opens it in place of the current dataset
and keeps the selected genes, the annotation set and how cells are coloured,
so you can step through sections with the same gene or cell type. Only one
dataset is open at a time.

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
AnnData Zarr store on the group's bucket, which the viewer reads directly:

```json
{
  "$schema": "https://cellgeni.github.io/explorer/schemas/explorer-collection.v1.json",
  "version": 1,
  "name": "Spinal cord Xenium time course (SPCOX)",
  "root": "https://spco.cog.sanger.ac.uk/SPCOX/",
  "datasets": [
    { "dataset": "SPCOX-Sham-A-anndata.zarr", "name": "Sham-A", "group": "Sham" },
    { "dataset": "SPCOX-Sham-B-anndata.zarr", "name": "Sham-B", "group": "Sham" },
    { "dataset": "SPCOX-1dpi-A-anndata.zarr", "name": "1dpi-A", "group": "1 dpi" },
    {
      "dataset": "SPCO-snRNAseq-anndata.zarr",
      "name": "snRNA-seq atlas",
      "group": "snRNA-seq"
    }
  ],
  "defaults": { "genes": ["Aqp4"] }
}
```

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

| Key       | Required | Value                                                                                                                       |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `dataset` | Yes      | What `dataset=` opens: a dataset folder, file or store, or a [dataset manifest](./dataset-manifest.md). Relative or http(s) |
| `name`    | No       | Label in the bar. Without it, the bar shows the last part of the path. The top bar prefers the manifest's own name          |
| `group`   | No       | Group label, such as a time point or donor                                                                                  |

- Paths resolve like manifest paths: against `root` when set, otherwise
  against the collection's folder. Other schemes such as `s3://` are
  rejected.
- Each dataset may appear once, because the address names the open dataset
  by its URL.
- The bar lists groups in the order they first appear, each with its
  datasets in file order. Entries without a group are listed where they
  appear.
- An entry that points at a manifest gets that manifest's files, options and
  defaults. A collection does not repeat them.

### Defaults

The dataset manifest's cross-dataset display settings: `genes`,
`colorCellsBy`, `geneColorScale`, `geneScoreMode`, and `cellPointScale`, with
the [same values](./dataset-manifest.md#defaults). Layer toggles, opacities
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
- the loaded annotation set, its hidden classes and its class colours,
- the metadata column cells are coloured by.

The gene colour scale and the opacities stay as they are. A gene, set or
column missing from the next dataset is handled as it is for a shared link:
the gene is dropped and the set or column is not loaded.

### Class Colours

A class keeps its colour from one dataset to the next, including a colour
you picked. AnnData classes come in the order of their column's categories,
the order scanpy colours them in, so datasets with the same categories give
each class the same colour even when opened on their own or from a link. A
class that only the next dataset has takes the next free colour.

Each switch adds a browser history entry, so Back returns to the previous
dataset of the collection.

## Previews

Each dataset in the bar has a preview: its cells in grey, so the tissue
shows, and the cells that score above zero for the selected genes in the
gene colour scale, using the same `Combine genes` mode as the main view.
Where several cells share a pixel, the highest score shows, as the main view
draws the highest-scoring cells on top. Without genes, or when cells are
coloured by something else, previews show the tissue only.

While cells are coloured by an annotation set, previews show its classes in
the main view's colours instead. A class the main view has not coloured yet
takes the colour it will have when its dataset opens. Hidden classes stay
grey, so hiding all but one cell type (Alt-click its checkbox in the legend
or in Cells › Clusters) shows where it is in every section;
each preview then counts the cells of the shown classes (`1,204 cells`). The
bar's left side names the set and how many classes are hidden. A set is read
once per dataset and selection, like a gene.

- **One scale.** Every preview uses the same scale, from 0 to the highest
  score among the previews read so far. The bar's left side shows the gene
  and that maximum, and each preview its own highest score (`max 92`). The
  scale can rise as more previews are read.
- **What is read.** A preview reads every cell's position once per dataset,
  then the selected genes' scores, or the annotation set's classes, whenever
  the selection changes. Positions
  come from the same readers as the main view, so a previewed dataset
  opens faster when chosen. Beyond 200,000 cells, every Nth is drawn.
- **Grid.** `Expand` in the bar lays the previews out as a grid over the
  view, larger, with groups side by side where they fit, so a collection
  of about twenty sections fits on one screen. The layer panel stays open
  beside it, so changing the genes or the annotation set redraws the grid.
  Choosing a dataset opens it and returns to the bar, as do `Collapse` and
  Escape.
- **When.** Only previews in view, and those just beyond the bar's ends or
  the grid's edges, are read, four datasets at a time. None start while the main view loads a
  dataset. `Previews` in the bar turns them off and lists names only.
- **No preview.** Image-only and Visium HD datasets show "No cells to
  preview". A plain `.h5ad` over 64 MB shows its size instead: the viewer
  reads such a file whole, which only opening it should do.

How much a preview reads depends on how each dataset stores its expression
matrix. A matrix chunked by gene, such as an AnnData Zarr `X` written in
blocks of a few genes, gives one gene for all cells in one small read. A
sparse matrix stored cell by cell has to be read whole for one gene, which
is only practical for small datasets.

For SPCOX, a dataset's first preview reads about 1 MB in 55 requests, mostly
its cell table, and the eight previews in view fill about 5 s after the
first dataset opens. A new gene then reads 100 to 500 KB per section, about
2.7 s for the eight.

## The Address

The address keeps `collection=` next to `dataset=`, so a copied link reopens
the collection with the same dataset and view. Opening a dataset that is not
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

The schema is deployed with the viewer at
`/schemas/explorer-collection.v1.json`. Set `$schema` to that URL on your
viewer's host and editors such as VS Code will complete field names and flag
errors as you type.

## Known Limitations

- Datasets are shown one at a time. There are no side-by-side embedding and
  spatial views yet.
- Class colours are kept while you switch datasets, not written into the
  address: a link restores the set and its hidden classes with the dataset's
  own colours.
- Previews do not show metadata colouring.
- Previews are listed in the collection's order; they cannot be sorted by
  expression yet.
- A collection cannot be listed in the start screen's examples yet, or
  opened from `Load Dataset`.
