# Standard Visium Modality

How the viewer reads standard Visium data: Visium v1 and v2 (CytAssist), 55 µm
spots on a 100 µm hexagonal lattice, 6.5 mm and 11 mm capture areas. It reads
two sources the same way:

- a Space Ranger `outs/` folder, and
- an AnnData `.h5ad` that carries the Visium layout in `uns/spatial/<library>`,
  as written by scanpy `read_visium`, squidpy, and CELLxGENE.

Both become platform `visium`. Visium HD has its own page:
[Visium HD](./visium-hd.md). For hosting requirements see
[Host your own data](../host-your-own-data.md#host-your-own-standard-visium-data).

## Detection

### Space Ranger Folder

`detectSpatialDataset` (`src/datasets/datasetFactory.ts`) tries standard
Visium after the `experiment.xenium`, `experiment.spatial`, and root Zarr
metadata probes, and before the Visium HD tiers. Six `HEAD` requests run in
parallel (`probeVisiumOutputs`):

| Path                                | Needed                                   |
| ----------------------------------- | ---------------------------------------- |
| `spatial/tissue_positions.csv`      | This or the next one (Space Ranger 2.0+) |
| `spatial/tissue_positions_list.csv` | Space Ranger 1.x name, no header row     |
| `spatial/scalefactors_json.json`    | Yes                                      |
| `filtered_feature_bc_matrix.h5`     | Yes                                      |
| `spatial/tissue_hires_image.png`    | No; offered as the tissue image if found |
| `spatial/tissue_lowres_image.png`   | No; offered as the tissue image if found |

A Visium HD `outs/` folder has none of the root files, so it falls through to
the Visium HD tier probes.

`createSpatialDataset` lazy-imports `createVisiumDataset`
(`src/datasets/visiumDataset.ts`), which returns an `AnnDataH5adDataset` built
from the folder (see [Space Ranger Files](#space-ranger-files)).

### H5AD With `uns/spatial`

A `.h5ad` URL is detected as `h5ad` from its suffix, as before. Whether it is
Visium is only known once the file is read: `readVisiumPlacement`
(`src/datasets/h5adDataset.ts`) treats it as Visium when

- the coordinates come from `obsm/spatial` or `obsm/X_spatial`, and
- `uns/spatial` has at least one child group with a `scalefactors` or `images`
  group (other children, such as CELLxGENE's `is_single`, are ignored).

`meta().platform` is then `visium`, and the load switches the app to the
Visium platform. Other `.h5ad` files load exactly as described in
[H5AD](./h5ad.md). Tables inside SpatialData and Atera stores are placed by
their store and never take the Visium layout.

### Dataset Manifest

A [dataset manifest](../dataset-manifest.md#standard-visium) with
`"platform": "visium"` can rename or move every Space Ranger file, including
gzipped ones. Files it names must answer `HEAD`; files it leaves out are probed
at their Space Ranger names, and a missing tissue image is left out. This is
how GEO samples load: GEO publishes each sample's Space Ranger files flat and
gzipped, for example `GSM6592057_M10_tissue_positions_list.csv.gz` and
`GSM6592057_M10_tissue_hires_image.png.gz`.

## Space Ranger Files

`readSpaceRangerVisium` (`src/datasets/visiumDataset.ts`) reads the positions,
scale factors, matrix, and analysis files in parallel, then builds an
in-memory AnnData table with the same layout scanpy writes
(`visiumAnnDataTable`). Everything after that is the AnnData reader.

| File                                                                                                              | Required | Library                                      | What is read                                                                                                                                                                                              | Used for                        |
| ----------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `spatial/tissue_positions.csv` or `spatial/tissue_positions_list.csv`                                             | Yes      | fetch + gunzip when gzipped                  | `barcode`, `in_tissue`, `array_row`, `array_col`, `pxl_row_in_fullres`, `pxl_col_in_fullres` (header or fixed order)                                                                                      | Spot centres, lattice fit       |
| `spatial/scalefactors_json.json`                                                                                  | Yes      | fetch + JSON (gzip allowed)                  | `tissue_hires_scalef`, `tissue_lowres_scalef`, `spot_diameter_fullres`, `fiducial_diameter_fullres`, `microns_per_pixel`                                                                                  | Image placement, units          |
| `filtered_feature_bc_matrix.h5`                                                                                   | Yes      | fetch whole file, `h5wasm` (up to 300 MB)    | `/matrix/barcodes`, `features/{name,id,feature_type}`, `data`, `indices`, `indptr`; root `library_ids`, `chemistry_description`, `software_version` attributes. Cell Ranger 2 per-genome groups also work | Spots (rows), genes, expression |
| `spatial/tissue_hires_image.png`, `spatial/tissue_lowres_image.png`                                               | No       | `HTMLImageElement`; `.gz` decompressed first | Whole image                                                                                                                                                                                               | Tissue underlay                 |
| `analysis/clustering/gene_expression_graphclust/clusters.csv`, then `analysis/clustering/graphclust/clusters.csv` | No       | fetch + CSV                                  | `Barcode,Cluster`                                                                                                                                                                                         | `graphclust` annotation set     |
| `analysis/{umap,tsne}/gene_expression_2_components/projection.csv`, then `…/2_components/…`                       | No       | fetch + CSV                                  | Barcode and two axes                                                                                                                                                                                      | `X_umap`, `X_tsne` embeddings   |
| `analysis/pca/gene_expression_10_components/projection.csv`, then `…/10_components/…`                             | No       | fetch + CSV                                  | Barcode and the first two components                                                                                                                                                                      | `X_pca` embedding               |

The table it builds:

- **Rows** are the filtered matrix barcodes that the positions file lists.
  Barcodes it does not list cannot be placed and are left out (logged).
- **obs**: `in_tissue`, `array_row`, `array_col`, `total_counts` (UMIs per
  spot), `n_genes_by_counts`, and `graphclust` when the clusters CSV exists.
  The numeric columns are `Metadata` colour tracks.
- **var**: feature names as the index, plus `gene_ids` and `feature_types`.
  Every feature type is kept, so Antibody Capture features appear next to
  genes.
- **X**: the matrix as CSR (10x stores features × barcodes in CSC, which is
  barcodes × features in CSR), with `int64` indices narrowed to `Int32Array`.
- **obsm**: `spatial` as (`pxl_col_in_fullres`, `pxl_row_in_fullres`), and the
  projections that cover every row.
- **uns**: `spatial/<library>/scalefactors` and `metadata`, where `<library>`
  is the matrix's first `library_ids` entry, else `visium`.

Not read: the raw matrix, the MEX `filtered_feature_bc_matrix/` folder,
`molecule_info.h5`, k-means clusterings, `diffexp/`, `spatial_enrichment.csv`,
`barcode_fluorescence_intensity.csv`, `cytassist_image.tiff`,
`aligned_fiducials.jpg`, `detected_tissue_image.jpg`, and the full-resolution
microscope image (it is a Space Ranger input, not an output).

## H5AD Layout Read

On top of the [H5AD layout](./h5ad.md#hdf5-layout-read):

| Path                                                                      | What is read                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `obsm/spatial` (or `X_spatial`)                                           | Spot centres in full-resolution pixels (integer or float)       |
| `obs/array_row`, `obs/array_col`                                          | Array indices for the lattice fit (optional)                    |
| `obs/in_tissue`                                                           | Spots with 0 are hidden (optional)                              |
| `obs/library_id` (or `library`, `sample`)                                 | Which library each row belongs to (only with several libraries) |
| `uns/spatial/<library>/scalefactors/*`                                    | Scalar datasets with the Space Ranger scale factor names        |
| `uns/spatial/<library>/images/{hires,lowres}`                             | `(height, width)` or `(height, width, 3 or 4)` arrays           |
| `uns/spatial/<library>/metadata/{chemistry_description,software_version}` | Shown in the Dataset tab                                        |

## Units And Coordinates

Data coordinates are full-resolution pixels × µm per pixel, origin top-left,
y down. `resolveVisiumUnits` (`src/datasets/visiumFormat.ts`) takes the first
of:

1. `microns_per_pixel` in the scale factors (Visium HD writes it; standard
   Visium usually does not).
2. **Spot grid.** A least-squares affine fit of spot pixels against
   `array_row`/`array_col` (`fitGridBasis`). One column index is 50 µm and one
   row 100 × √3 / 2 µm; the two estimates must agree within 5 %, which also
   rejects array indices that are not the Visium lattice.
3. **Spot pitch.** The median nearest-neighbour spot distance as 100 µm
   (`estimateUnitsFromVisiumSpots`), for AnnData without array columns.
4. **Spot diameter.** `spot_diameter_fullres` as 65 µm, the nominal size
   10x documents (60-70 µm). A notice under Fallbacks says distances are
   approximate.
5. Otherwise 1 pixel is shown as 1 µm, with the same notice.

The lattice fit uses every spot of the library, including spots off the
tissue, so the scale does not change with the off-tissue choice.

## Library And Off-Tissue Spots

`readVisiumSource` reads everything a placement needs once (every library's
scale factors, images, and metadata; the pixels; the obs library, `in_tissue`,
and array columns). `setVisiumView({ libraryId, showOffTissue })` then picks
what `placeVisiumView` places, without reading the file again:

- **Off-tissue spots.** Spots with `in_tissue` 0 are hidden by default
  (CELLxGENE files keep all 4,992 or 14,336 array spots; Space Ranger's
  filtered matrix already drops them), unless no spot is marked as under
  tissue. The Dataset tab's `Show off-tissue spots` checkbox places them.
- **Library.** With several libraries in `uns/spatial` (concatenated
  samples), the default is the first library that an obs library column
  (`library_id`, `library`, or `sample`) names; the Dataset tab's `Library`
  select picks another. Rows of other libraries are hidden, and the library's
  own scale factors, units, and images are used. Without such a column every
  row is placed with the chosen library's scale factors.

Either change goes through the normal load (`handleVisiumViewChange` in
`useVisiumControlsWorkflow`), which re-places spots, refits the view, and
re-runs expression and ROI queries. The dataset instance is cached per URL, so
the file is not downloaded again. Genes, colouring, and layer settings are
carried over from the shareable state; a library change clears the ROI,
because it belongs to another section.

The share link keeps `vimg` (`hires`, `lowres`, or `none`), `vlib` (only with
several libraries), and `voff=1`; a link opened later restores them.

## Spots

- Spots are 55 µm across, the capture area, not the 65 µm
  `spot_diameter_fullres`. Overview points carry the spot area as `cellArea`,
  and the Visium platform adapter sets `trueSizePoints`, so points and
  expression dots keep their physical size at every zoom instead of the usual
  screen-pixel cap.
- `elements(bbox)` returns each placed spot as a 32-sided polygon. These are
  the `Cell boundaries` layer, off by default; when on, outlined spots replace
  the points and fill when colouring by genes, annotations, or metadata.
- Selected-gene expression, annotations, metadata tracks, embeddings, the
  selected-spot profile, and ROI queries are the [H5AD read
  paths](./h5ad.md#feature-read-paths) over spots.

## Tissue Image

The tissue image is an `ImageSource` of kind `flat`: one image drawn under the
spots by `MorphologyCanvas`, image pixel `p` at `p / tissue_<kind>_scalef × µm
per pixel`.

- **Space Ranger.** The hires PNG URL, else the lowres one. A URL ending in
  `.gz` is fetched, decompressed with `DecompressionStream`, and drawn from an
  object URL.
- **H5AD.** `tissueImage(kind)` reads the `uns` array once and encodes it as an
  uncompressed 24-bit BMP object URL (`encodeImageArrayAsBmp`): uint8 as is,
  0-1 floats (scanpy's `read_visium` keeps matplotlib's floats) × 255, other
  ranges scaled to their maximum. Alpha is dropped and grayscale is repeated
  into RGB.
- An image needs its `tissue_<kind>_scalef`; without it the image is not
  offered.
- The Dataset tab's `Tissue image` select switches between `High-res`,
  `Low-res`, and `None` in place (`useVisiumControlsWorkflow`). Each library's
  images are encoded once.

## Load Sequence

`useDatasetLifecycle` (`src/features/app-shell/useDatasetLifecycle.ts`):

1. Applies the library and off-tissue choice from a shared link
   (`setVisiumView`). Space Ranger: sets the platform to `visium`. H5AD: sets
   `h5ad`, reads the file, and switches to `visium` when `visiumSummary()` is
   not null.
2. Logs the library, spot count, and units, and raises the units notice when
   the scale is approximate.
3. Fills the Dataset tab's Visium section (`visiumControlReady`).
4. Runs the shared AnnData overview (spots, genes, annotation sets, embedding
   options, metadata tracks). `Cell boundaries` defaults to off.
5. If `Tissue image` is enabled, loads the shared image choice, else high-res,
   else low-res, in the background.

Gating is in `VISIUM_PLATFORM_ADAPTER`
(`src/features/app-shell/platformAdapter.ts`): AnnData workflows, spot
outlines from `dataset.elements(bbox)`, true-size points, embeddings labelled
`spots`; transcripts, nucleus boundaries, and Magic Lens are off.

## Diagnostics

`runVisiumDiagnostics` (`src/data/datasetDiagnostics.ts`) checks the positions
and scale factors with `GET`, the filtered matrix and both tissue images with
`HEAD` (the matrix fails above 300 MB), and the graph-based clusters and UMAP
CSVs as optional. No Range support is needed: every standard Visium file is
read whole. A Visium `.h5ad` gets the H5AD diagnostics.

## Source Files

| File                                                                                  | Role                                                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/datasets/visiumFormat.ts`                                                        | File names, scale factors, positions, units, spot rings, clusters CSV, BMP |
| `src/datasets/visiumDataset.ts`                                                       | Space Ranger reader, 10x HDF5 matrix, in-memory AnnData table              |
| `src/datasets/h5adDataset.ts`                                                         | `uns/spatial` placement, spots, tissue images, in-memory AnnData source    |
| `src/datasets/datasetFactory.ts`                                                      | Folder and manifest detection, construction                                |
| `src/features/app-shell/useDatasetLifecycle.ts`, `useVisiumControlsWorkflow.ts`       | Load sequence; image, library, and off-tissue changes                      |
| `src/features/app-shell/platformAdapter.ts`                                           | `VISIUM_PLATFORM_ADAPTER`                                                  |
| `src/features/dataset/visiumModel.ts`, `src/features/control-hud/DatasetHudPanel.tsx` | Dataset tab section                                                        |
| `src/data/datasetDiagnostics.ts`                                                      | `runVisiumDiagnostics`                                                     |

## Known Limitations

- `spaceranger aggr` output (one `spatial/<library>/` folder per sample and
  `aggr_tissue_positions.csv`) is not detected; use one sample's `count`
  output, or a manifest per sample.
- A multi-library `.h5ad` shows one library at a time.
- The filtered matrix and `.h5ad` files are read whole, up to 300 MB (larger
  `.h5ad` files need a kerchunk reference, as for any H5AD; see
  [Large H5AD files](../h5ad-reference.md)). CELLxGENE Visium files are often
  over the limit only because of a full-resolution image in `uns`, which the
  reference skips.
- The full-resolution microscope image is not shown, only the hires and
  lowres images.
- Only the graph-based clustering is read from `analysis/`; k-means
  clusterings and differential expression are not.
- Antibody Capture features are listed with genes; a name shared with a gene
  gets a `-2` suffix.
- Magic Lens is unavailable, as for H5AD.
