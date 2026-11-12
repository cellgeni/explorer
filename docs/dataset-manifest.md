# Dataset Manifest

A dataset manifest is an optional JSON file, `explorer.json`, hosted with a
dataset. It tells the viewer:

- which platform the dataset is, so detection does not depend on file names;
- where each file is, so files can be renamed, moved into subfolders, or served
  from another host;
- how to show the dataset on first load: selected genes, cell colouring, layer
  toggles, opacities, image channels, and platform choices such as the
  SpatialData image or the Visium HD bin size.

A manifest also makes public data loadable where it is published: for example
a [GEO Visium sample](#standard-visium), whose files have GEO names.

Without a manifest, the viewer reads the standard file names described in
[Host your own data](./host-your-own-data.md). A manifest only needs the
fields that differ from those names.

The format is defined by
[`public/schemas/explorer-manifest.v1.json`](../public/schemas/explorer-manifest.v1.json)
(JSON Schema 2020-12) and enforced by `parseDatasetManifest`
(`src/datasets/datasetManifest.ts`).

## Where The Viewer Looks

There are two ways to use a manifest:

| Entered URL                                        | What happens                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A dataset folder, such as `https://host/run-7`     | The viewer reads `https://host/run-7/explorer.json` alongside the `experiment.xenium` probe. If it is a manifest, it describes the dataset. If it is missing, the viewer detects the platform from the file names. |
| A manifest file, such as `https://host/run-7.json` | The viewer reads that file. Any URL ending in `.json` is treated as a manifest, except Zarr `zarr.json` metadata. Use this to keep several manifests for one folder, or to keep manifests apart from the data.     |

When the viewer probes a folder:

- An `HTTP 403` or `404`, a network error, or a timeout means there is no
  manifest. Buckets that deny listing return `403` for missing keys.
- A response that is not a JSON object with a `platform` or `version` field is
  ignored, so hosts that answer every path with an HTML page or `{}` still
  work.
- A manifest that fails validation stops the load with an error. It is not
  silently ignored.

The manifest is fetched with `cache: no-cache`, so edits show on the next
load. It needs CORS like every other file but not byte-range support.

## Example

A Xenium run whose cell table and image were renamed, with the matrix on
another host:

```json
{
  "$schema": "https://viewer.example.org/schemas/explorer-manifest.v1.json",
  "version": 1,
  "platform": "xenium",
  "name": "Ovary AU14 S14",
  "files": {
    "cells": "tables/cells_resegmented.parquet",
    "cellBoundaries": "tables/cell_boundaries_resegmented.parquet",
    "cellFeatureMatrix": "https://cdn.example.org/au14/cell_feature_matrix.zarr.zip",
    "morphology": "images/morphology_focus_0000.ome.tif"
  },
  "defaults": {
    "genes": ["EPCAM", "PTPRC"],
    "colorCellsBy": "cell-area",
    "cellBoundaries": false,
    "channels": ["DAPI"],
    "imageOpacity": 0.8
  }
}
```

Every other file (`transcripts.parquet`, `gene_panel.json`, …) is read from
its standard name in the manifest's folder.

## Fields

| Field         | Required | Value                                                                                                 |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `version`     | Yes      | `1`                                                                                                   |
| `platform`    | Yes      | `xenium`, `atera`, `visium`, `visium-hd`, `h5ad`, `spatialdata`, or `image`                           |
| `name`        | No       | Display name, shown in the top bar, the info drawer, the log, and diagnostics                         |
| `description` | No       | What the dataset shows, shown in the info drawer's About section                                      |
| `source`      | No       | Where the data comes from. See [Source](#source)                                                      |
| `root`        | No       | Base for relative paths instead of the manifest's folder. Relative to the manifest, or an http(s) URL |
| `files`       | Varies   | Where the platform's files are. See [Files](#files)                                                   |
| `options`     | No       | Platform choices. See [Options](#options)                                                             |
| `defaults`    | No       | First-load display settings. See [Defaults](#defaults)                                                |
| `$schema`     | No       | Schema URL for editor completion and checking; the viewer ignores it                                  |

Unknown fields are errors, so a typo such as `"cell"` for `"cells"` is
reported instead of falling back to the standard name.

### Paths

Each path is either relative or an `http://` / `https://` URL. Relative paths
resolve against `root` when it is set, otherwise against the folder the
manifest is in. A leading `./` and trailing `/` are dropped; `../` is allowed.
Other schemes such as `s3://` are rejected: the browser can only read HTTP(S).

## Source

Where the data comes from, for viewers who want to find the original
deposit, check its licence, or cite it. Every field is an optional string;
the info drawer's About section shows the ones that are set, under the name
and description.

| Key          | Value                                                        |
| ------------ | ------------------------------------------------------------ |
| `repository` | Repository or host, such as `BioImage Archive`               |
| `accession`  | Accession or identifier there, such as `S-BIAD2214`          |
| `url`        | Landing page for the deposit; must be an `http(s)` URL       |
| `license`    | Data licence, such as `CC BY 4.0`                            |
| `citation`   | How to cite the data, such as the publication it accompanies |

The [examples](../examples/README.md) use `source` for every dataset.

## Files

### Xenium

All entries are optional. Leave one out to use the standard name.

| Key                     | Standard name                       | Notes                                                                                                           |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `experiment`            | `experiment.xenium`                 | Optional with a manifest. Supplies the pixel size and, when `morphology` is not set, the morphology image paths |
| `cells`                 | `cells.parquet`                     | Required to load, at whatever path                                                                              |
| `cellBoundaries`        | `cell_boundaries.parquet`           |                                                                                                                 |
| `transcripts`           | `transcripts.parquet`               |                                                                                                                 |
| `transcriptsZarr`       | `transcripts.zarr.zip`              |                                                                                                                 |
| `cellFeatureMatrix`     | `cell_feature_matrix.zarr.zip`      |                                                                                                                 |
| `cellFeatureMatrixH5`   | `cell_feature_matrix.h5`            |                                                                                                                 |
| `analysis`              | `analysis.zarr.zip`                 |                                                                                                                 |
| `genePanel`             | `gene_panel.json`                   |                                                                                                                 |
| `morphology`            | Image listed in `experiment.xenium` | Image paths inside `experiment.xenium` resolve against the dataset folder (or `root`)                           |
| `morphologyZchunkstore` | Next to the TIFF                    | [`.zchunkstore` sidecar](./zchunkstore.md) for the morphology image. Replaces the lookup next to the TIFF       |
| `umap`, `tsne`          | Searched under `analysis/`          | A projection CSV. Replaces the search for that embedding                                                        |

### Atera

All entries are optional. Leave one out to use the path in
`experiment.spatial`, or the standard name when that lists none. Atera
`options` must be empty.

| Key                     | Standard name                                     | Notes                                                                                                                         |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `experiment`            | `experiment.spatial`                              | Supplies the pixel size and the paths of the other files                                                                      |
| `cells`                 | `cells.zarr.zip`                                  | Cell and nucleus boundaries                                                                                                   |
| `cellFeatureMatrix`     | `cell_feature_matrix.zarr.zip`                    | Required to load                                                                                                              |
| `cscCellFeatureMatrix`  | `csc_cell_feature_matrix.zarr.zip`                | Selected-gene overlays                                                                                                        |
| `transcripts`           | `transcripts.zarr.zip`                            | Exact transcript points for selected genes                                                                                    |
| `binnedTranscripts`     | `binned_transcripts.zarr.zip`                     | Selected-gene transcript density                                                                                              |
| `morphology`            | `images.morphology_2d_filepath` in the experiment | Any OME-TIFF or OME-Zarr image                                                                                                |
| `morphologyZchunkstore` | Next to each TIFF                                 | [`.zchunkstore` sidecar](./zchunkstore.md) covering every `morphology_2d` channel file. Replaces the lookup next to the TIFFs |

### Standard Visium

Standard Visium (v1/v2, 55 µm spots) Space Ranger `count` output. All entries
are optional; `options` must be empty. Files the manifest names must answer
`HEAD`, or detection stops with an error naming the field. Files it leaves out
are probed at their Space Ranger names; a missing tissue image is skipped.
Every file is read whole, so no byte-range support is needed, and gzipped
copies (`.gz`) work.

| Key               | Standard name                                                                                          | Notes                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `tissuePositions` | `spatial/tissue_positions.csv`, then `spatial/tissue_positions_list.csv`                               | With or without a header row                                          |
| `scalefactors`    | `spatial/scalefactors_json.json`                                                                       |                                                                       |
| `filteredMatrix`  | `filtered_feature_bc_matrix.h5`                                                                        | Up to 300 MB                                                          |
| `hiresImage`      | `spatial/tissue_hires_image.png`                                                                       | Any image the browser draws; `.png.gz` and `.jpg.gz` are decompressed |
| `lowresImage`     | `spatial/tissue_lowres_image.png`                                                                      | As above                                                              |
| `clusters`        | `analysis/clustering/gene_expression_graphclust/clusters.csv`, then `analysis/clustering/graphclust/…` | `Barcode,Cluster` CSV, shown as the `graphclust` annotation set       |
| `umap`, `tsne`    | `analysis/<kind>/gene_expression_2_components/projection.csv`, then `analysis/<kind>/2_components/…`   | Projection CSV                                                        |
| `pca`             | `analysis/pca/gene_expression_10_components/projection.csv`, then `analysis/pca/10_components/…`       | The first two components are shown                                    |

GEO publishes each Visium sample's Space Ranger files flat, with the sample
name as a prefix, and gzipped. A manifest hosted anywhere loads them from GEO,
which allows browser reads:

```json
{
  "version": 1,
  "platform": "visium",
  "name": "GSM6592057 (M10)",
  "root": "https://ftp.ncbi.nlm.nih.gov/geo/samples/GSM6592nnn/GSM6592057/suppl/",
  "files": {
    "tissuePositions": "GSM6592057_M10_tissue_positions_list.csv.gz",
    "scalefactors": "GSM6592057_M10_scalefactors_json.json.gz",
    "filteredMatrix": "GSM6592057_M10_filtered_feature_bc_matrix.h5",
    "hiresImage": "GSM6592057_M10_tissue_hires_image.png.gz"
  }
}
```

See [Standard Visium](./modalities/visium.md).

### Visium HD

| Key                | Standard name                                          | Notes                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bins`             | The `binned_outputs/square_{002,008,016}um` that exist | A list of `{ "size": 2 \| 8 \| 16, "path": "<bin folder>" }`. Each bin may also set `tissuePositions`, `scalefactors`, `filteredMatrix`                                                                                            |
| `featureSlice`     | `feature_slice.h5`                                     |                                                                                                                                                                                                                                    |
| `barcodeMappings`  | `barcode_mappings.parquet`                             |                                                                                                                                                                                                                                    |
| `segmentedOutputs` | The `segmented_outputs/` files that exist              | Keys: `scalefactors`, `filteredMatrix`, `rawMatrix`, `cellSegmentations`, `nucleusSegmentations`, `nucleusInstanceMask`, `graphclustCellSegmentations`, `graphclustNucleusSegmentations`. When set, only the listed files are used |

Within a bin, files default to `<path>/spatial/tissue_positions.parquet`,
`<path>/spatial/scalefactors_json.json`, and
`<path>/filtered_feature_bc_matrix.h5`. The tissue images, barcode and feature
lists, and UMAP projection are always read from under `<path>`. The viewer
checks the three bin files with `HEAD` and stops with an error naming the
missing file. Without `bins`, the standard tiers under the manifest root are
probed as usual.

### H5AD, SpatialData, And Image

| Platform      | Key           | Value                                                                                                                                                                      |
| ------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `h5ad`        | `h5ad`        | Required. The `.h5ad` file; checked with `HEAD`                                                                                                                            |
| `spatialdata` | `store`       | Required. The Zarr store root                                                                                                                                              |
| `image`       | `image`       | Required. OME-TIFF, TIFF, QPTIFF, NDPI, or OME-Zarr; the type is taken from the suffix                                                                                     |
| `image`       | `zchunkstore` | Optional. [`.zchunkstore` sidecar](./zchunkstore.md) for a TIFF `image`, and for its channel files. Replaces the lookup next to the TIFF. Rejected for an OME-Zarr `image` |

## Options

| Platform      | Key                  | Value                                                                                 |
| ------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `visium-hd`   | `binSize`            | `2`, `8`, or `16`: the bin size shown first. Must be one of `bins` when `bins` is set |
| `spatialdata` | `coordinateSystem`   | Coordinate system to show                                                             |
| `spatialdata` | `image`              | Image element name, without `images/`                                                 |
| `spatialdata` | `micrometersPerUnit` | Scale for stores that do not declare one; shown as the `µm per unit` value            |

The SpatialData options are the starting view; the View options controls in
the info drawer start from them. Changing the coordinate system clears the
image and units, because both belong to one coordinate system. Changing the
image keeps the units, and `Auto` returns to the declared or estimated scale.
Other platforms take no options.

## Defaults

Display settings applied each time the dataset loads.

| Key                   | Control                 | Value                                                                         |
| --------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `genes`               | Gene selection          | Gene names; must match the gene panel exactly, including case                 |
| `colorCellsBy`        | `Cell color`            | `gene-expression`, `transcript-count`, `cell-area`, `annotations`, `metadata` |
| `geneColorScale`      | `Gene scale`            | `gold`, `magma`, `viridis`, `plasma`, `cividis`, `teal`, `rose`, `glasbey`    |
| `geneScoreMode`       | `Combine genes`         | `sum`, `mean`, `z-score`                                                      |
| `cellBoundaries`      | `Cell boundaries`       | `true` / `false`                                                              |
| `nucleusBoundaries`   | `Nucleus boundaries`    | `true` / `false`                                                              |
| `channels`            | Image channel toggles   | Channel names (case-insensitive) or IDs to turn on                            |
| `imageOpacity`        | `Dataset image opacity` | 0–1                                                                           |
| `cellFillOpacity`     | `Cell fill opacity`     | 0–1                                                                           |
| `cellBoundaryOpacity` | `Cell boundary opacity` | 0–1                                                                           |
| `transcripts`         | `Show transcripts`      | `true` / `false` (Xenium, Atera)                                              |

How defaults combine with other settings:

- A [shareable URL](./ui-reference.md#shareable-url) for the same dataset wins
  field by field: a link that sets `genes` keeps its genes, and the manifest
  fills in what the link leaves out. The link applies only to the first load.
  The app's links leave out values equal to the manifest's defaults, and
  write a value the user set back to the app default (such as `genes=` with
  no genes), so the manifest does not replace it.
- A value that is not one of the listed options, such as `"colorCellsBy":
"cluster"`, leaves the control at its default and adds a notice under
  Fallbacks, in the info drawer's Data access notes. Type errors, such as a
  string opacity, stop the load.
- `channels` entries that match no channel leave the platform's default
  channels on. An empty list turns every channel off.
- Opacities and `transcripts` are app-wide controls: they keep their value when
  another dataset without these defaults is loaded next.
- `colorCellsBy: "annotations"` takes effect once annotations are loaded.
- `genes` without `colorCellsBy` colours cells by gene expression. With
  `colorCellsBy` set to another mode, the genes are selected (for transcripts,
  or to switch to later) but cells use that mode.

## Errors And Diagnostics

- A manifest that cannot be read (when entered directly) or does not validate
  appears in the Issues list, in the info drawer's Diagnostics section, as
  "Dataset manifest is invalid", with the field at fault.
- A file named in the manifest that is missing fails where it is read, and the
  message shows the manifest path and the full URL. For files read by byte
  range, a `404`, or a `403` from a bucket that denies listing, is titled "File
  not found or not readable", so check the path rather than the host's Range
  support.
- `Diagnose Dataset` adds a `Dataset manifest` check and checks the files at
  their manifest locations. With a manifest, a missing `experiment.xenium` is a
  warning instead of a failure.

## Editor Support

The schema is deployed with the viewer at `/schemas/explorer-manifest.v1.json`.
Set `$schema` to that URL on your viewer's host (or a local copy) and editors
such as VS Code will complete field names and flag errors as you type.

## How It Works

1. `detectSpatialDataset` (`src/datasets/datasetFactory.ts`) reads the manifest
   (`readDatasetManifest`), validates it with `parseDatasetManifest`, and builds
   the detection from it (`detectFromManifest`). The detection result carries
   the manifest as `manifest`.
2. Detection registers the manifest for the entered URL with
   `setDatasetManifest` (`src/data/datasetFiles.ts`), and clears it when a
   later detection of the same URL finds none.
3. Readers receive the entered URL, as before, and ask for files by role:
   `datasetFileUrlFor(baseUrl, 'cells')` returns the manifest URL or the
   standard one, and `datasetFileLabelFor` gives the name used in messages.
   `datasetFileUrl(baseUrl, path)` resolves other relative paths, such as
   Visium HD bin files, against the manifest root and passes URLs through.
4. `useDatasetLifecycle` maps `defaults` onto share-URL fields
   (`manifestDefaultsToShareableState`,
   `src/features/dataset/datasetManifestModel.ts`) and applies them beneath any
   shared link.
5. `spatialDataSelectionFor` returns the viewer's SpatialData selection, or the
   manifest's `options` when there is none.
6. A `visium` manifest's file paths are resolved the same way and passed to
   `createVisiumDataset` (`src/datasets/visiumDataset.ts`).

A sidecar named by `morphologyZchunkstore` or `zchunkstore` reaches `openTiff`
as `zchunkStoreUrl`: `loadMorphologyImage` looks it up with `zchunkStoreUrlFor`
(`src/data/datasetFiles.ts`), and `AteraDataset` and `ImageOnlyDataset` pass it
for the image and, through `openChannelLoader`, for each channel file. It is
the only sidecar URL tried: if it is missing or does not match the TIFF, the
image loads without one, with the fallback notice. If the morphology image
turns out to be OME-Zarr, the sidecar is not used and a fallback notice says
so.

`src/datasets/datasetManifestSchema.test.ts` checks that the JSON Schema and
the parser accept the same fields and values.

## Known Limitations

- There is no way to declare a file absent. Optional files the manifest does
  not name are still probed at their standard names.
- The H5AD coordinate key, the annotation set to select, channel colours and
  contrast windows, and the initial camera cannot be set yet.
- Image type comes from the path suffix; a renamed OME-Zarr store needs to keep
  `.zarr` in its name.
