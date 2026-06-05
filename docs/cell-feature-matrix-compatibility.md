# Xenium Cell-Feature Matrix Compatibility

This note records the ROI gene-statistics performance finding and the current
strategy for older Xenium output bundles: use native CSC Zarr when it exists,
and use `cell_feature_matrix.h5` as the compatibility fallback. Do not generate
cell-major Zarr sidecars over H5.

## What Changed In 10x Output

10x documents `cell_feature_matrix.zarr.zip` as a sparse matrix of Q20
cell-feature counts. Older XOA documentation, including v1.9, describes only
the feature-major arrays under `cell_features`:

```text
cell_features/
  cell_id
  data
  indices
  indptr
```

Those arrays are effectively CSR by feature. `cell_features/indptr` has length
`number_features + 1`, and each row gives the nonzero cells for one feature.
This is good for drawing a small selected gene set, but bad for asking "what
are the top genes in these N cells?" because that query needs all nonzero
features for each ROI cell.

Current 10x documentation lists an additional cell-major CSC group:

```text
cell_features/
  csc/
    data
    indices
    indptr
```

10x's XOA v3.1 release notes explicitly say `cell_feature_matrix.zarr.zip`
became zstd-compressed and gained a CSC matrix representation for Xenium
Explorer performance. XOA v3.0 release notes mention chunked Zarr output, but
the first explicit CSC addition is v3.1.

References:

- 10x latest Zarr output docs:
  https://www.10xgenomics.com/support/software/xenium-onboard-analysis/latest/advanced/xoa-output-zarr
- 10x XOA v1.9 Zarr output docs:
  https://www.10xgenomics.com/support/software/xenium-onboard-analysis/1.9/analysis/xoa-output-zarr
- 10x XOA v3.1 release notes:
  https://www.10xgenomics.com/support/software/xenium-onboard-analysis/3.1/release-notes/release-notes-for-xoa

## Observed Failure Mode

Older datasets have `cell_feature_matrix.zarr.zip`, but the Zarr only exposes
the old feature-major arrays. It does not expose
`cell_features/csc/indptr`, `cell_features/csc/indices`, or
`cell_features/csc/data`.

For ROI top-gene queries the app therefore cannot answer the query from older
Zarr alone. It falls back to `cell_feature_matrix.h5`. In the browser, that
means fetching and parsing the whole H5 file with `h5wasm`; one observed H5 is
about 413 MiB. The observed 20-30 second ROI gene preview cost is that cold H5
path, not the 32-cell preview sample.

Newer datasets expose the CSC arrays. One observed Zarr layout included:

```text
cell_features/csc/indptr  shape [1290197]   dtype uint32
cell_features/csc/indices shape [57663616]  dtype uint16
cell_features/csc/data    shape [57663616]  dtype uint32
```

That is the layout needed for fast ROI top-gene reads.

## Strategy

Use the cell-feature matrix in this order:

1. Prefer `cell_feature_matrix.zarr.zip` when it contains
   `cell_features/csc/{indptr,indices,data}`. This is the normal fast path for
   XOA v3.1 and later output.
2. For older output where Zarr is feature-major only, use
   `cell_feature_matrix.h5` as the ROI gene-statistics fallback. This is slower
   because browser-side H5 currently requires a full-file fetch and parse before
   any ROI result can be produced.
3. If both native CSC Zarr and readable H5 are unavailable, report ROI gene
   statistics as unsupported by default. Transcript aggregation can remain an
   explicit diagnostic or one-off fallback, but it is not the default
   interactive ROI path.

The app should surface this as a matrix capability, not as a generic "Zarr is
slow" state:

```text
cell_feature_matrix.zarr.zip has CSC       -> ROI genes supported, fast path
feature-major Zarr plus H5 is present      -> ROI genes supported, H5 fallback
feature-major Zarr and no readable H5      -> ROI genes unsupported by default
```

The code should not look for, generate, or document
`cell_feature_matrix.cell_major.zarr.zip`. Native 10x CSC Zarr remains the
preferred fast path; H5 is the compatibility path for older output.

## Implementation Notes

- Keep `h5wasm` as the production H5 reader.
- Keep `jsfive` deferred unless a real H5-only dataset fails under `h5wasm` but
  is readable through `jsfive`.
- Keep selected-gene expression reads able to use older feature-major Zarr,
  because selected-gene queries are feature-oriented.
- Keep ROI top-gene reads on per-cell sparse counts: native CSC Zarr first,
  then H5 fallback.
