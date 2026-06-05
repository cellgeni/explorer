# Xenium Cell-Feature Matrix Compatibility

This note records the ROI gene-statistics performance finding and the strategy
for supporting older Xenium output bundles without relying on
`cell_feature_matrix.h5`.

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

The older Sob23 dataset at:

```text
https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328
```

has `cell_feature_matrix.zarr.zip`, but the Zarr only exposes the old
feature-major arrays. It does not expose `cell_features/csc/indptr`,
`cell_features/csc/indices`, or `cell_features/csc/data`.

For ROI top-gene queries the app therefore cannot answer the query from Zarr.
It falls back to `cell_feature_matrix.h5`. In the browser, that means fetching
and parsing the whole H5 file with `h5wasm`; this dataset's H5 is about 413 MiB.
The observed 18-20 second ROI gene preview cost is that cold H5 path, not the
32-cell preview sample.

The newer DU4 dataset at:

```text
https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00055__0087854__DU4-INT-0-FFPE-1-S2__20260511__123524
```

does expose the CSC arrays. Its observed Zarr layout included:

```text
cell_features/csc/indptr  shape [1290197]   dtype uint32
cell_features/csc/indices shape [57663616]  dtype uint16
cell_features/csc/data    shape [57663616]  dtype uint32
```

That is the layout needed for fast ROI top-gene reads.

## Strategy

Use the cell-feature matrix in this order:

1. Prefer `cell_feature_matrix.zarr.zip` when it contains
   `cell_features/csc/{indptr,indices,data}`. This is the normal path for XOA
   v3.1 and later output.
2. For older output, prefer a generated cell-major Zarr sidecar over H5. Host it
   beside the original matrix, for example:

   ```text
   cell_feature_matrix.zarr.zip
   cell_feature_matrix.cell_major.zarr.zip
   ```

   The sidecar should contain `cell_features/cell_id`, the original
   `cell_features` attributes, and `cell_features/csc/{indptr,indices,data}`.
   It does not need to duplicate the original feature-major arrays unless a
   consumer expects one combined matrix file.
3. Optionally add a chunk-index file for the Zarr ZIP once the cell-major layout
   exists. A ZIP chunk index can reduce central-directory and chunk-offset work,
   but it cannot make a feature-major matrix answer a cell-major ROI query.
4. Treat `cell_feature_matrix.h5` as an offline or compatibility source, not as
   the interactive ROI gene fallback. A browser-side H5 fallback is effectively a
   full-file download and parse before any ROI result can be produced.

The app should surface this as a matrix capability, not as a generic "Zarr is
slow" state:

```text
cell_feature_matrix.zarr.zip has CSC        -> ROI genes supported, fast path
cell_major sidecar has CSC                  -> ROI genes supported, fast path
only feature-major Zarr and H5 are present  -> ROI genes unsupported until sidecar is generated
```

HDF5-as-Zarr could be useful if a separate service or sidecar exposes H5 chunks
as range-readable arrays, but it still does not remove the need for cell-major
access. Generating explicit CSC arrays is the simpler compatibility target.

## Sidecar Contract

A compatibility sidecar should be a Zarr v2 ZIP with this minimum structure:

```text
(root)
+-- cell_features
    +-- cell_id
    +-- csc
        +-- data
        +-- indices
        +-- indptr
```

Expected array semantics:

- `cell_features/cell_id`: copied from the original matrix.
- `cell_features/csc/indptr`: `uint32`, length `number_cells + 1`.
- `cell_features/csc/indices`: `uint16`, feature index for each nonzero count.
- `cell_features/csc/data`: `uint32`, count for each nonzero cell-feature pair.
- `cell_features` attributes: copy `feature_keys`, `feature_ids`,
  `feature_types`, `number_cells`, `number_features`, and version fields from
  the original matrix.

If a dataset has more than 65,536 features, `uint16` cannot represent all
feature indices. Current Xenium panels are below that, and the app's current CSC
reader expects `uint16` indices like the 10x CSC output.

## Python: Generate A Cell-Major Sidecar

Install dependencies in an offline conversion environment:

```sh
python -m pip install "zarr<3" numpy numcodecs
```

The script below is intended to run as `make_xenium_cell_major_zarr.py` against
an old `cell_feature_matrix.zarr.zip`:

```sh
python make_xenium_cell_major_zarr.py \
  /path/to/cell_feature_matrix.zarr.zip \
  /path/to/cell_feature_matrix.cell_major.zarr.zip
```

Use `--include-csr` only when you want the output ZIP to be a complete enhanced
replacement containing both the original feature-major arrays and the generated
cell-major CSC arrays.

```python
#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
from typing import Any

import numpy as np
import zarr


DEFAULT_NNZ_CHUNK = 2_097_152
DEFAULT_INDPTR_CHUNK = 1_048_576


def open_zarr(path: Path, mode: str = "r") -> tuple[Any, Any]:
    if path.suffix == ".zip":
        store = zarr.ZipStore(str(path), mode=mode)
    else:
        store = zarr.DirectoryStore(str(path))
    return zarr.group(store=store), store


def close_store(store: Any) -> None:
    close = getattr(store, "close", None)
    if close is not None:
        close()


def attrs_dict(node: Any) -> dict[str, Any]:
    asdict = getattr(node.attrs, "asdict", None)
    if asdict is not None:
        return dict(asdict())
    return dict(node.attrs)


def copy_attrs(src: Any, dst: Any) -> None:
    attrs = attrs_dict(src)
    if attrs:
        dst.attrs.put(attrs)


def read_array(array: Any, label: str) -> np.ndarray:
    print(f"reading {label}: shape={array.shape} dtype={array.dtype}", file=sys.stderr)
    return np.asarray(array[:])


def remove_existing_output(path: Path, force: bool) -> None:
    if not path.exists():
        return
    if not force:
        raise FileExistsError(f"{path} already exists; pass --force to replace it")
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def checked_uint32(values: np.ndarray, label: str) -> np.ndarray:
    if values.size == 0:
        return values.astype(np.uint32, copy=False)
    max_value = int(values.max())
    if max_value > np.iinfo(np.uint32).max:
        raise ValueError(f"{label} contains values too large for uint32")
    return values.astype(np.uint32, copy=False)


def build_csc(
    csr_indptr: np.ndarray,
    csr_indices: np.ndarray,
    csr_data: np.ndarray,
    n_cells: int,
    n_features: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if n_features > np.iinfo(np.uint16).max + 1:
        raise ValueError(
            "cell_features/csc/indices is uint16 in 10x output and in the "
            "current app reader; this dataset has too many features."
        )

    nnz = int(csr_indptr[-1])
    if nnz != int(csr_indices.shape[0]) or nnz != int(csr_data.shape[0]):
        raise ValueError(
            "CSR arrays are inconsistent: indptr[-1] must equal len(indices) "
            "and len(data)."
        )

    if csr_indices.size and int(csr_indices.max()) >= n_cells:
        raise ValueError("CSR indices contain a cell index outside number_cells")

    print("counting nonzeros per cell", file=sys.stderr)
    counts_per_cell = np.bincount(
        csr_indices.astype(np.int64, copy=False),
        minlength=n_cells,
    )
    if counts_per_cell.shape[0] != n_cells:
        raise ValueError("CSR indices contain a cell index outside number_cells")

    cumsum = np.cumsum(counts_per_cell, dtype=np.uint64)
    if cumsum.size and int(cumsum[-1]) > np.iinfo(np.uint32).max:
        raise ValueError("CSC indptr would exceed uint32")

    csc_indptr = np.empty(n_cells + 1, dtype=np.uint32)
    csc_indptr[0] = 0
    csc_indptr[1:] = cumsum.astype(np.uint32, copy=False)

    csc_indices = np.empty(nnz, dtype=np.uint16)
    csc_data = np.empty(nnz, dtype=np.uint32)
    write_pos = csc_indptr[:-1].copy()

    print(
        f"transposing feature-major CSR to cell-major CSC: "
        f"{n_features} features, {n_cells} cells, {nnz} nonzeros",
        file=sys.stderr,
    )
    for feature_index in range(n_features):
        start = int(csr_indptr[feature_index])
        end = int(csr_indptr[feature_index + 1])
        if end <= start:
            continue

        cells = csr_indices[start:end]
        values = csr_data[start:end]

        # 10x cell-feature rows are expected to be canonical: one value per
        # cell in each feature row. The fallback loop keeps the conversion
        # correct if a row unexpectedly contains duplicate cell indices.
        if cells.size != np.unique(cells).size:
            for cell, value in zip(cells, values):
                dest = int(write_pos[int(cell)])
                csc_indices[dest] = feature_index
                csc_data[dest] = value
                write_pos[int(cell)] += 1
        else:
            cell_positions = cells.astype(np.intp, copy=False)
            dest = write_pos[cell_positions].astype(np.intp, copy=False)
            csc_indices[dest] = feature_index
            csc_data[dest] = values
            write_pos[cell_positions] += 1

    if not np.array_equal(write_pos, csc_indptr[1:]):
        raise RuntimeError("CSC write positions did not match computed indptr")

    return csc_indptr, csc_indices, csc_data


def copy_array(src_group: Any, dst_group: Any, name: str) -> None:
    src = src_group[name]
    data = read_array(src, f"cell_features/{name}")
    dst_group.array(
        name,
        data=data,
        chunks=src.chunks,
        dtype=src.dtype,
        compressor=getattr(src, "compressor", None),
        overwrite=True,
    )


def write_sidecar(
    src_root: Any,
    dst_root: Any,
    csc_indptr: np.ndarray,
    csc_indices: np.ndarray,
    csc_data: np.ndarray,
    *,
    include_csr: bool,
    nnz_chunk: int,
    indptr_chunk: int,
) -> None:
    src_cf = src_root["cell_features"]
    dst_cf = dst_root.require_group("cell_features")

    copy_attrs(src_root, dst_root)
    copy_attrs(src_cf, dst_cf)

    cell_id = src_cf["cell_id"]
    dst_cf.array(
        "cell_id",
        data=read_array(cell_id, "cell_features/cell_id"),
        chunks=cell_id.chunks,
        dtype=cell_id.dtype,
        compressor=getattr(cell_id, "compressor", None),
        overwrite=True,
    )

    if include_csr:
        for name in ("indptr", "indices", "data"):
            copy_array(src_cf, dst_cf, name)

    csc = dst_cf.require_group("csc")
    src_indptr = src_cf["indptr"]
    src_indices = src_cf["indices"]
    src_data = src_cf["data"]

    csc.array(
        "indptr",
        data=csc_indptr,
        chunks=(max(1, min(indptr_chunk, csc_indptr.shape[0])),),
        dtype=np.uint32,
        compressor=getattr(src_indptr, "compressor", None),
        overwrite=True,
    )
    csc.array(
        "indices",
        data=csc_indices,
        chunks=(max(1, min(nnz_chunk, csc_indices.shape[0])),),
        dtype=np.uint16,
        compressor=getattr(src_indices, "compressor", None),
        overwrite=True,
    )
    csc.array(
        "data",
        data=csc_data,
        chunks=(max(1, min(nnz_chunk, csc_data.shape[0])),),
        dtype=np.uint32,
        compressor=getattr(src_data, "compressor", None),
        overwrite=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Generate cell_features/csc arrays for an older Xenium "
            "cell_feature_matrix.zarr.zip."
        )
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--include-csr",
        action="store_true",
        help="also copy original cell_features/{data,indices,indptr}",
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--nnz-chunk", type=int, default=DEFAULT_NNZ_CHUNK)
    parser.add_argument("--indptr-chunk", type=int, default=DEFAULT_INDPTR_CHUNK)
    args = parser.parse_args()

    remove_existing_output(args.output, args.force)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    src_root, src_store = open_zarr(args.input, "r")
    dst_root, dst_store = open_zarr(args.output, "w")
    try:
        src_cf = src_root["cell_features"]
        if "csc" in src_cf:
            print(
                "input already contains cell_features/csc; generating output anyway",
                file=sys.stderr,
            )

        attrs = attrs_dict(src_cf)
        cell_id = src_cf["cell_id"]
        csr_indptr = checked_uint32(
            read_array(src_cf["indptr"], "cell_features/indptr"),
            "indptr",
        )
        csr_indices = checked_uint32(
            read_array(src_cf["indices"], "cell_features/indices"),
            "indices",
        )
        csr_data = checked_uint32(
            read_array(src_cf["data"], "cell_features/data"),
            "data",
        )

        n_cells = int(attrs.get("number_cells", cell_id.shape[0]))
        n_features = int(attrs.get("number_features", csr_indptr.shape[0] - 1))
        if n_cells != int(cell_id.shape[0]):
            raise ValueError(
                f"number_cells={n_cells} does not match cell_id rows={cell_id.shape[0]}"
            )
        if n_features + 1 != int(csr_indptr.shape[0]):
            raise ValueError(
                f"number_features={n_features} does not match indptr length={csr_indptr.shape[0]}"
            )

        csc_indptr, csc_indices, csc_data = build_csc(
            csr_indptr,
            csr_indices,
            csr_data,
            n_cells,
            n_features,
        )

        write_sidecar(
            src_root,
            dst_root,
            csc_indptr,
            csc_indices,
            csc_data,
            include_csr=args.include_csr,
            nnz_chunk=args.nnz_chunk,
            indptr_chunk=args.indptr_chunk,
        )
    finally:
        close_store(dst_store)
        close_store(src_store)

    print(f"wrote {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

## Validation

After generating a sidecar, validate the shape and dtype before hosting it:

```python
import zarr

root = zarr.group(store=zarr.ZipStore("cell_feature_matrix.cell_major.zarr.zip"))
cf = root["cell_features"]
print(cf["cell_id"].shape, cf["cell_id"].dtype)
print(cf["csc/indptr"].shape, cf["csc/indptr"].dtype)
print(cf["csc/indices"].shape, cf["csc/indices"].dtype)
print(cf["csc/data"].shape, cf["csc/data"].dtype)
print(cf.attrs["number_cells"], cf.attrs["number_features"])
```

Expected:

- `csc/indptr.shape[0] == number_cells + 1`
- `csc/indices.shape[0] == csc/data.shape[0]`
- `csc/indptr[-1] == csc/indices.shape[0]`
- `csc/indices.dtype == uint16`
- `csc/data.dtype == uint32`

When hosted over HTTP, the sidecar needs the same CORS and byte-range support as
the original matrix ZIP.
