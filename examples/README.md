# Examples

Public datasets from data repositories, ready to open in the viewer. Each
example is a [dataset manifest](../docs/dataset-manifest.md) that points at
the files where the repository hosts them, so nothing is copied. Opening an
example loads its manifest from GitHub:

```text
https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/<repository>/<example>.json
```

Any deployment of the viewer can open the same manifest URL. Changes to a
manifest on `main` reach the links within about five minutes (GitHub's raw
file cache), without a viewer release.

<!-- examples:start -->

| Example                                                                                                                                                                                                     | Platform | What it shows                                                                                                                                                              | Source                                                                                                                              | Licence   |                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------- |
| [Human skin, inflamed eczema (Xenium 5K)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/bia/S-BIAD2214.json)                               | xenium   | Fresh-frozen adult skin from an inflamed eczema lesion on the Xenium Human 5K panel: 22,242 cells with transcripts and cell boundaries, from an atlas of skin fibroblasts. | [BioImage Archive S-BIAD2214](https://www.ebi.ac.uk/biostudies/BioImages/studies/S-BIAD2214)                                        | CC0 1.0   | [manifest](bia/S-BIAD2214.json)                                 |
| [Inflammatory skin, PhenoCycler 61-plex](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/bia/S-BIAD3788.json)                                | image    | Akoya PhenoCycler-Fusion whole-slide scan of eight skin sections taken after Xenium, with 61 protein markers, read directly from an 81 GB QPTIFF.                          | [BioImage Archive S-BIAD3788](https://www.ebi.ac.uk/biostudies/BioImages/studies/S-BIAD3788)                                        | CC0 1.0   | [manifest](bia/S-BIAD3788.json)                                 |
| [Fetal lung T, NK and ILC cells (UMAP)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/cellxgene/62315937-e268-4fa5-a032-8f7d776f3a3f.json) | h5ad     | Single-cell RNA-seq of 4,778 T, NK and innate lymphoid cells from human fetal lung, shown on their UMAP with 14 annotated cell types.                                      | [CELLxGENE 62315937-e268-4fa5-a032-8f7d776f3a3f](https://cellxgene.cziscience.com/collections/2d2e2acd-dade-489f-a2da-6c11aa654028) | CC BY 4.0 | [manifest](cellxgene/62315937-e268-4fa5-a032-8f7d776f3a3f.json) |
| [Adult human heart (Visium)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/cellxgene/fe5b3268-ddd8-415a-9432-f1f95bfdb500.json)            | h5ad     | Visium section of adult human heart, 4,992 spots with per-spot cell-type abundances (colour cells by Metadata), from a spatial atlas of cardiac niches.                    | [CELLxGENE fe5b3268-ddd8-415a-9432-f1f95bfdb500](https://cellxgene.cziscience.com/collections/3116d060-0a8e-4767-99bb-e866badea1ed) | CC BY 4.0 | [manifest](cellxgene/fe5b3268-ddd8-415a-9432-f1f95bfdb500.json) |
| [Mouse embryo E9.0 (Slide-seqV2)](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/cellxgene/fe70db78-88b8-4bf7-8449-7aa177d51978.json)       | h5ad     | Slide-seqV2 puck of a whole E9.0 mouse embryo, 3,374 beads with cell-type annotations, from spatial maps of neural tube patterning.                                        | [CELLxGENE fe70db78-88b8-4bf7-8449-7aa177d51978](https://cellxgene.cziscience.com/collections/d74b6979-efba-47cd-990a-9d80ccf29055) | CC BY 4.0 | [manifest](cellxgene/fe70db78-88b8-4bf7-8449-7aa177d51978.json) |
| [Human tonsil, imaging mass cytometry](https://cellgeni.github.io/explorer/?dataset=https://raw.githubusercontent.com/cellgeni/explorer/main/examples/idr/idr0054-tonsil.json)                              | image    | Hyperion imaging mass cytometry of a human tonsil section with 27 metal-tagged antibodies, as OME-Zarr; opens on CD3 (T cells), CD19 (B cells), and CD68 (macrophages).    | [Image Data Resource idr0054](https://idr.openmicroscopy.org/webclient/?show=project-701)                                           | CC BY 4.0 | [manifest](idr/idr0054-tonsil.json)                             |

<!-- examples:end -->

The Dataset tab shows each example's description, source, licence, and how to
cite it. Please cite the original data when you use it.

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
