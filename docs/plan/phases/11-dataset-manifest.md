# Phase 11 — Dataset Manifest

Shipped 2026-11-09. Requested so that renaming a file such as `cells.parquet`
no longer breaks loading, and so a dataset can say how it should be shown.

## Product Decisions

- **DECISION:** One manifest file, `explorer.json`, read from the entered
  folder alongside the `experiment.xenium` probe; any other `.json` URL can be
  entered directly. Without one, detection is unchanged.
- **DECISION:** Readers keep receiving the entered URL. Detection registers the
  manifest for that URL (`setDatasetManifest`, `src/data/datasetFiles.ts`) and
  readers ask for files by role (`datasetFileUrlFor`), instead of threading a
  file map through every reader and workflow.
- **DECISION:** `defaults` reuse the share-URL fields, so they follow the
  shared-link restore path and a shared link wins field by field.
- **DECISION:** Strict validation with field-level messages; a typo must not
  silently fall back to a standard name. A JSON Schema ships with the app for
  editors, and a test keeps it in step with the parser.

## Delivered

- [x] `parseDatasetManifest` (`src/datasets/datasetManifest.ts`): version,
      platform, `root`, per-platform `files`, `options`, `defaults`; relative
      paths resolve against the manifest folder or `root`.
- [x] Detection from a manifest for all five platforms; Visium HD bins listed
      in the manifest are checked with `HEAD`.
- [x] Every hard-coded Xenium and Visium HD root file name goes through
      `datasetFileUrlFor`; messages name the manifest path
      (`datasetFileLabelFor`).
- [x] Xenium without `experiment.xenium` when the manifest names the image;
      manifest UMAP/t-SNE paths; Visium HD bin paths for projections.
- [x] Display defaults applied by `useDatasetLifecycle`
      (`src/features/dataset/datasetManifestModel.ts`); image channels by name
      or ID; unknown values reported under Fallbacks.
- [x] SpatialData `options` as the starting selection; Visium HD `binSize` as
      the default tier.
- [x] `DatasetManifestError` classified as "Dataset manifest is invalid";
      Diagnose Dataset adds a `Dataset manifest` check and checks manifest
      locations; `experiment.xenium` becomes a warning.
- [x] `public/schemas/explorer-manifest.v1.json` and
      `docs/dataset-manifest.md`.
- [x] Checked in the browser against the hosted Xenium demo (folder manifest
      with `root`, relocated `experiment.xenium`, defaults), a SpatialData
      manifest with `options`, and invalid and missing-file manifests.
- [x] A `404`, or a `403` from a bucket that denies listing, on a byte-range
      file is titled "File not found or not readable", and a `5xx` "Host server
      error", instead of "Byte-range requests blocked" (`assertHttpRangeSupport`,
      `createStructuredLoadError`).

## Later Additions

- [x] `defaults.cellPointScale` sets the `Cell point size` slider (#103,
      2026-11-15).
- [x] H5AD manifests take `files.image`, `files.labels`,
      `options.coordinates` and `options.labelColumn`, parsed by the same
      `parseImageAttachment` as a collection entry, and `files.h5ad` accepts
      an AnnData Zarr store or an Icechunk repository (#114, 2026-11-15).
- [x] `defaults.geneRange`: `[min, max]` in score units, `null` for Auto, and
      a top that may be a percentile such as `"p95"` (#128, 2026-11-16). A
      link's own `geneRange=` wins.
- [x] A reader chosen in place of detection, the ad hoc counterpart of a
      manifest's `platform` (#459, 2026-11-26; added to Open Items that day). A
      cog at the end of the `Dataset or image URL` field opens a system list
      of "Detect automatically" and the eight platforms; the choice goes
      into the link as `reader=`, and into Recent. **DECISION:** detection
      stays the way in and choosing is discouraged, so the cog has no text,
      sits in the field's padding, and is marked only while a reader is
      chosen. The reader reads no manifest and looks only for its platform's
      files (`detectWithReader` in `datasetFactory.ts`); a file opens as the
      chosen kind and a Zarr group whatever its root says. A load that fails
      with a chosen reader says so, and how to go back to detection. See
      [Choosing A Reader](../../user-guide.md#choosing-a-reader).

## Known Gaps

- [ ] Files cannot be declared absent, so optional standard names are still
      probed.
- [ ] Not configurable yet: H5AD coordinate key, annotation set to select,
      channel colours and contrast, initial camera.
- [x] No E2E test; the hosted fixtures are folders without manifests. Found
      closed on 2026-11-16: the smoke test that opens a gallery example
      answers its manifest with one naming the tiny H5AD fixture
      (`tests/e2e/app.spec.ts`), and the nightly run opens every example in
      `examples/` through its manifest (`tests/e2e/examples.spec.ts`).
