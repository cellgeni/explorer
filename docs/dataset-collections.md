# Dataset Collections

A dataset collection is a JSON file that lists datasets to browse together,
such as the sections of one study. Open it with `collection=` in the
viewer's address:

```text
https://cellgeni.github.io/explorer/?collection=https://host/study/collection.json
```

The viewer opens the first dataset and lists the collection's datasets in a
bar under the canvas. Choosing one opens it in place of the current dataset
and keeps the selected genes and how cells are coloured, so you can step
through sections with the same gene. Only one dataset is open at a time.

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
`colorCellsBy`, `geneColorScale`, and `geneScoreMode`, with the
[same values](./dataset-manifest.md#defaults). Layer toggles, opacities and
image channels belong to each dataset, so set them in that dataset's
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
- the `Cell color` mode, when it is gene expression, transcript count or cell
  area,
- the `Combine genes` mode.

Annotation and metadata colouring name one dataset's columns, so the next
dataset starts without them. The gene colour scale and the opacities stay as
they are. A gene missing from the next dataset's panel is handled as it is
for a shared link.

Each switch adds a browser history entry, so Back returns to the previous
dataset of the collection.

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

- Datasets are shown one at a time. There are no thumbnails, side-by-side
  embedding and spatial views, or shared annotation colours yet.
- A collection cannot be listed in the start screen's examples yet, or
  opened from `Load Dataset`.
