# Examples

Public datasets from data repositories, ready to open in the viewer. Each
example is a [dataset manifest](../docs/dataset-manifest.md) that points at
the files where the repository hosts them, so nothing is copied. Opening an
example loads its manifest from GitHub:

```text
https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/<repository>/<example>.json
```

An example can also be a [dataset collection](../docs/dataset-collections.md),
opened with `collection=` instead and listed as a `collection of` its number
of datasets.

Any deployment of the viewer can open the same manifest URL. Changes to a
manifest on `main` reach the links within about five minutes (GitHub's raw
file cache), without a viewer release.

The viewer's start screen reads `index.json` from `main` at runtime and shows
each example as a card, so merging an example adds it to the gallery of every
deployment, also without a release. A card opens the manifest on the
deployment it is shown on, never the `viewerUrl` in the index. A build can
read another index with `VITE_EXAMPLES_INDEX_URL` (see
[Deploy to S3](../docs/deploy-to-s3.md#build-locally)).

<!-- examples:start -->

| Example                                                                                                                                                                                                                    | Platform        | What it shows                                                                                                                                                                                                                                                                                                                                                                                       | Source                                                                                                                                | Licence                    |                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| [Human skin, inflamed eczema (Xenium 5K)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/bia/S-BIAD2214.json)                                              | xenium          | Fresh-frozen adult skin from an inflamed eczema lesion on the Xenium Human 5K panel: 22,242 cells with transcripts and cell boundaries, from an atlas of skin fibroblasts.                                                                                                                                                                                                                          | [BioImage Archive S-BIAD2214](https://www.ebi.ac.uk/biostudies/BioImages/studies/S-BIAD2214)                                          | CC0 1.0                    | [manifest](bia/S-BIAD2214.json)                                  |
| [Human skin (MERSCOPE)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/bia/S-BIAD2376.json)                                                                | merscope        | MERFISH of normal adult human skin on a 499-gene panel: 3,003 cells segmented with Baysor, with their outlines, from a spatial census of skin across 15 anatomic sites; opens on COL1A1 (dermal fibroblasts).                                                                                                                                                                                       | [BioImage Archive S-BIAD2376](https://www.ebi.ac.uk/biostudies/BioImages/studies/S-BIAD2376)                                          | CC BY 4.0                  | [manifest](bia/S-BIAD2376.json)                                  |
| [Human tonsil, PhenoCycler 19-plex](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/bia/S-BIAD2491.json)                                                    | image           | Akoya PhenoCycler-Fusion scan of two FFPE human tonsil sections, stained with fresh (top) and lyophilized (bottom) antibodies, with 18 markers and DAPI, read directly from a 13 GB QPTIFF; opens on CD3 (T cells), CD20 (B cells), and Ki-67 (dividing cells).                                                                                                                                     | [BioImage Archive S-BIAD2491](https://www.ebi.ac.uk/biostudies/BioImages/studies/S-BIAD2491)                                          | CC BY 4.0                  | [manifest](bia/S-BIAD2491.json)                                  |
| [Fetal lung T, NK and ILC cells (UMAP)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/cellxgene/62315937-e268-4fa5-a032-8f7d776f3a3f.json)                | h5ad            | Single-cell RNA-seq of 4,778 T, NK and innate lymphoid cells from human fetal lung, shown on their UMAP with 14 annotated cell types.                                                                                                                                                                                                                                                               | [CELLxGENE 62315937-e268-4fa5-a032-8f7d776f3a3f](https://cellxgene.cziscience.com/collections/2d2e2acd-dade-489f-a2da-6c11aa654028)   | CC BY 4.0                  | [manifest](cellxgene/62315937-e268-4fa5-a032-8f7d776f3a3f.json)  |
| [Adult human heart (Visium)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/cellxgene/fe5b3268-ddd8-415a-9432-f1f95bfdb500.json)                           | h5ad            | Visium section of adult human heart over its H&E: 2,913 spots under tissue (4,992 on the array) with per-spot cell-type abundances (colour spots by Metadata), from a spatial atlas of cardiac niches.                                                                                                                                                                                              | [CELLxGENE fe5b3268-ddd8-415a-9432-f1f95bfdb500](https://cellxgene.cziscience.com/collections/3116d060-0a8e-4767-99bb-e866badea1ed)   | CC BY 4.0                  | [manifest](cellxgene/fe5b3268-ddd8-415a-9432-f1f95bfdb500.json)  |
| [Mouse embryo E9.0 (Slide-seqV2)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/cellxgene/fe70db78-88b8-4bf7-8449-7aa177d51978.json)                      | h5ad            | Slide-seqV2 puck of a whole E9.0 mouse embryo, 3,374 beads with cell-type annotations, from spatial maps of neural tube patterning.                                                                                                                                                                                                                                                                 | [CELLxGENE fe70db78-88b8-4bf7-8449-7aa177d51978](https://cellxgene.cziscience.com/collections/d74b6979-efba-47cd-990a-9d80ccf29055)   | CC BY 4.0                  | [manifest](cellxgene/fe70db78-88b8-4bf7-8449-7aa177d51978.json)  |
| [Human first-trimester decidua, invaded (Visium)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/geo/GSM9080376.json)                                      | visium          | Visium section of human first-trimester decidua basalis invaded by extravillous trophoblasts, over its H&E: 871 spots with whole-transcriptome expression (36,601 genes) read from GEO's Matrix Market files; opens on HLA-G (extravillous trophoblasts), from a study of how trophoblast invasion remodels the decidua.                                                                            | [GEO GSM9080376](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSM9080376)                                                       | No restrictions (NCBI GEO) | [manifest](geo/GSM9080376.json)                                  |
| [Human tonsil, imaging mass cytometry](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/idr/idr0054-tonsil.json)                                             | image           | Hyperion imaging mass cytometry of a human tonsil section with 27 metal-tagged antibodies, as OME-Zarr; opens on CD3 (T cells), CD19 (B cells), and CD68 (macrophages).                                                                                                                                                                                                                             | [Image Data Resource idr0054](https://idr.openmicroscopy.org/webclient/?show=project-701)                                             | CC BY 4.0                  | [manifest](idr/idr0054-tonsil.json)                              |
| [Mouse blastocyst, confocal z-stack (3D)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/idr/idr0062-blastocyst.json)                                      | image           | Confocal z-stack of a whole E3.5 mouse blastocyst, 236 planes stained for the nuclear lamina (Lamin B1) and DNA (DAPI), as OME-Zarr; opens in the 3D view, which you can rotate, and View › 2D steps through the planes.                                                                                                                                                                            | [Image Data Resource idr0062](https://idr.openmicroscopy.org/webclient/?show=project-801)                                             | CC BY 4.0                  | [manifest](idr/idr0062-blastocyst.json)                          |
| [Human breast cancer (Visium CytAssist, SpatialData)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/spatialdata-sandbox/visium_associated_xenium_io.json) | spatialdata     | Visium CytAssist section of FFPE human breast cancer over its H&E, read from a SpatialData Zarr store: 4,992 spots with whole-transcriptome expression (18,085 genes), from the study that pairs Visium with Xenium and single-cell data on serial sections.                                                                                                                                        | [SpatialData sandbox visium_associated_xenium_io](https://spatialdata.scverse.org/en/stable/tutorials/notebooks/datasets/README.html) | CC BY 4.0                  | [manifest](spatialdata-sandbox/visium_associated_xenium_io.json) |
| [Human liver serial sections, 3D (LYNX NIH_F5)](https://cellgeni.github.io/explorer/?collection=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/zenodo/21110855-liver-sections.json)                     | collection of 7 | Seven serial Xenium sections of human liver sample NIH_F5, 5 µm apart (01 to 08; the deposit has no section 03), on the 377-gene Multi-Tissue panel. Each section opens in its store's aligned coordinate system, which registers its cells to section 04, so the sections line up side by side and stack in 3D. Only section 04 shows its morphology image: the others' are rotated in that frame. | [Zenodo 21110855](https://zenodo.org/records/21110855)                                                                                | CC BY-NC-ND 4.0            | [collection](zenodo/21110855-liver-sections.json)                |

<!-- examples:end -->

The info drawer's About section (ⓘ `Dataset info` in the top bar) shows each
example's description, source, licence, and how to cite it. Please cite the
original data when you use it.

## Adding An Example

1. Check that the host allows the browser to read the files: it must send
   `Access-Control-Allow-Origin` and answer byte-range requests. See the
   [S3/CORS hosting playbook](../docs/s3-cors-playbook.md).
2. Add `examples/<repository>/<ACCESSION>.json`, or
   `<ACCESSION>-<slug>.json` when one accession has several examples. Use an
   absolute `root` or absolute file URLs: relative paths would resolve against
   this folder on GitHub.
3. Give it a `name`, a one-sentence `description`, and a `source` with
   `repository`, `accession`, `url`, `license`, and `citation`.
4. Run `npm run examples` to update `index.json` and the table above, and
   `npx vitest run src/datasets/exampleManifests.test.ts` to check the manifest.
5. Open it in the viewer with the manifest's raw GitHub URL, or with a local
   copy served over HTTP while it is not on `main` yet.

A collection is added the same way, with the same `name`, `description` and
`source`. Its datasets are URLs on the data host, or dataset manifests in a
folder named after it, such as `zenodo/21110855-liver-sections/`, which its
`root` names and the table does not list. The same test checks those
manifests.

The nightly live E2E run (`tests/e2e/examples.spec.ts`) loads every example
and fails when one no longer loads, for example after a repository moves its
files.

## Repositories That Cannot Be Read Directly

These send no CORS headers, so the browser cannot read their files. Mirror
the data (within its licence) to a bucket that does, and keep the original in
`source`:

- CELLxGENE Discover downloads (`datasets.cellxgene.cziscience.com`). Use the
  CELLxGENE Census bucket instead, which hosts the same H5AD files with CORS.
- 10x Genomics dataset downloads (`cf.10xgenomics.com`).
- The SpatialData sandbox (`s3.embl.de/spatialdata/spatialdata-sandbox`),
  which also only offers zipped stores.
