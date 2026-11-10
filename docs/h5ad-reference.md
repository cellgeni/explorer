# Large H5AD Files (`.h5ad.json` References)

A `.h5ad.json` is a reference file, in
[kerchunk's reference format](https://fsspec.github.io/kerchunk/spec.html),
hosted next to an H5AD file. It lists every array in the file and the byte
range of each of its chunks, so the viewer can read the parts it needs with
Range requests instead of downloading the whole file. The viewer needs one for
H5AD files over 300 MiB.
[`scripts/make_h5ad_reference.py`](../scripts/make_h5ad_reference.py) writes
one with [VirtualiZarr](https://virtualizarr.readthedocs.io/).

## Do You Need One?

Only for files over 300 MiB (314,572,800 bytes). The viewer checks the size
with a `HEAD` request first (`readH5ad`, `src/datasets/h5adDataset.ts`):

- **Up to 300 MiB:** the whole file is downloaded with one `GET` and opened
  with `h5wasm`, the HDF5 library compiled to WebAssembly. The file sits in the
  tab's memory, and nothing shows until the download finishes. A reference
  next to such a file is not used.
- **Over 300 MiB:** the file is not downloaded. The viewer fetches
  `<H5AD URL>.json` and reads chunks of the H5AD through it. Without the JSON
  the load stops with "H5AD file is 318.0 MB, exceeding the browser load limit
  of 300.0 MB, and no readable kerchunk reference file was found at
  …/sample.h5ad.json." (Sizes in this message are MiB.)

If the server sends no `Content-Length`, the download starts anyway and
switches to the reference once it passes 300 MiB.

Why not read the H5AD directly with Range requests? An HDF5 file has no table
of contents. Where each array's chunks are is recorded in object headers and
B-tree nodes spread through the file, and each node points to the next, so
finding them over HTTP is a long chain of small reads that each wait for the
one before. The reference does that walk once, in advance, and stores the
result (see [Can It Be Made On The Fly?](#can-it-be-made-on-the-fly)).

## What It Contains

The JSON describes the H5AD as a Zarr v2 store, in kerchunk's reference
format version 1. An excerpt from a 333 MB CELLxGENE Visium heart file:

```json
{
  "version": 1,
  "refs": {
    ".zgroup": "{\"zarr_format\": 2}",
    "X/.zattrs": "{\"encoding-type\":\"csr_matrix\",\"encoding-version\":\"0.1.0\",\"shape\":[4992,32397]}",
    "X/data/.zarray": "{\"shape\":[1966115],\"chunks\":[7681],\"dtype\":\"<f4\",\"filters\":[{\"id\":\"zlib\",\"level\":4}],...}",
    "X/data/0": ["heart.h5ad", 8944, 3863],
    "X/data/1": ["heart.h5ad", 12807, 4021],
    "obs/_index/.zarray": "{\"shape\":[4992],\"chunks\":[1248],\"dtype\":\"|O\",\"filters\":[{\"id\":\"vlen-utf8\"}],\"compressor\":{\"id\":\"zlib\",\"level\":9},...}",
    "obs/_index/0": "base64:eNpdnUuSLseKhM+gV9D76MFdAsaADbB/66XcP3En86NMkknyihMZTx4ORP3..."
  }
}
```

- **Metadata keys** (`.zgroup`, `.zattrs`, `.zarray`): one per HDF5 group and
  dataset, with its attributes (AnnData's `encoding-type`, `_index`,
  `column-order`, …), shape, data type, chunk shape, and compression. HDF5
  gzip becomes the `zlib` filter.
- **Chunk keys** (`X/data/0`): `[file, offset, length]`, the position of that
  chunk's compressed bytes in the H5AD. No expression values are copied into
  the JSON.
- **Strings:** HDF5 variable-length strings (obs and var names, category
  labels, string columns, scalar strings in `uns`) are kept in the file's
  global heap, not in chunks, so they cannot be referenced by byte range.
  They are read when the reference is made and stored in the JSON,
  zlib-compressed and base64-encoded. They are most of the JSON's size.

Sizes written by `make_h5ad_reference.py`:

| File                                              | Cells × genes  | `/X`  | H5AD   | JSON   | JSON gzipped |
| ------------------------------------------------- | -------------- | ----- | ------ | ------ | ------------ |
| [PBMC3K][pbmc3k]                                  | 2,638 × 1,838  | Dense | 32 MB  | 68 KB  | 35 KB        |
| [CELLxGENE Visium, GEO GSM6592057][census-visium] | 4,992 × 35,477 | CSR   | 9 MB   | 484 KB | 309 KB       |
| [CELLxGENE Visium heart, HCAHeartST9383354][hrt]  | 4,992 × 32,397 | CSR   | 333 MB | 536 KB | 298 KB       |

[pbmc3k]: https://mp33.cog.sanger.ac.uk/public/h5ad/pbmc3k.h5ad
[census-visium]: https://cellxgene-census-public-us-west-2.s3.us-west-2.amazonaws.com/cell-census/2025-11-08/h5ads/60d5175f-f477-48b2-8396-ad76be2c3310.h5ad
[hrt]: https://cellxgene-census-public-us-west-2.s3.us-west-2.amazonaws.com/cell-census/2025-11-08/h5ads/4a9f7ec6-5de7-4e8a-acaa-d6d100a5ea58.h5ad

The heart file is large because of a full-resolution H&E image in
`uns/spatial/<library>/images/fullres` (18,000 × 31,960 × 3, 316 MB
compressed). The viewer never reads it.

## How The Viewer Uses It

`readH5adReferenceOrThrow` (`src/datasets/h5adDataset.ts`):

1. Fetches `<H5AD URL>.json`: the H5AD URL's path plus `.json`, with the H5AD
   URL's query string.
2. Points every chunk entry at the H5AD URL. The file name or URL stored in the
   JSON is ignored, so the JSON can be made from a local copy, and the two
   files can move together without regenerating it.
3. Opens the JSON as a Zarr v2 store (`ReferenceStore` from
   `@zarrita/storage`), builds the AnnData group tree from the metadata keys,
   and parses it with the same code as an in-memory file. Everything in
   [H5AD](./modalities/h5ad.md) and
   [Standard Visium](./modalities/visium.md) applies.
4. Reads chunks as Range requests to the H5AD, at most 6 at a time
   (`H5AD_REFERENCE_FETCH_CONCURRENCY`), only when they are needed:

| When                                  | What is read                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load                                  | Every `obs` column, the `var` index and gene-name column, the `obsm` coordinate matrix, and `/X/indptr` for sparse `/X`. Visium: scale factors and the `hires` or `lowres` image |
| Colour by a gene                      | CSR: `data` and `indices` for every cell in view, so all of `/X` at full view. CSC: that gene's column. Dense: the chunks that hold that gene                                    |
| Selected-cell profile, ROI gene stats | CSR and dense: those cells' rows. CSC: not available (`H5adAllGeneCscMatrixUnsupportedError`), because every gene's column would be read                                         |

Measured from the UK against the heart file on the CELLxGENE Census bucket
(AWS us-west-2), 2026-11-10:

- **Ready:** 37–39 s across runs, about 356 Range requests, 1.25 MB. The file
  has 126 numeric obs columns in 367 chunks, and each chunk is a round trip.
- **H&E `hires` image** (1,127 × 2,000): 6.5 s.
- **Colouring by MYH7** (CSR, 2,167 spots): 25 s.

The same file converted to CSC, with 150 ms added to each request: colouring
by MYH7 took 2 requests, 0.04 MB, and 0.17 s, against 770 requests, 4.6 MB,
and 19.6 s for CSR.

Load time follows the number of chunks in `obs`, `var`, and the coordinates,
times the round-trip time, more than the number of bytes.

## Generating One

Requirements: Python 3 with VirtualiZarr 2.8 or later (tested with 2.8.0 on
Python 3.12, with zarr 3.4). The H5AD must be on local disk.

```bash
pip install "virtualizarr[hdf]>=2.8"
```

```bash
python scripts/make_h5ad_reference.py /data/sample.h5ad
```

This writes `/data/sample.h5ad.json`. Use `-o PATH` to write elsewhere, and
`--all` to reference every group, not only those the viewer reads (for use
with other tools; see step 5 below). With [uv](https://docs.astral.sh/uv/), no
install step is needed:

```bash
uv run --no-project --python 3.12 --with "virtualizarr[hdf]>=2.8" python scripts/make_h5ad_reference.py /data/sample.h5ad
```

What the script does:

1. Stops if an array the viewer reads is lzf or szip compressed. VirtualiZarr
   references them, but the viewer cannot decode them. Warns if a dense `/X`
   over 64 MiB is one unchunked block.
2. Parses the file with VirtualiZarr's `HDFParser`, with
   `links_and_references=True`. Older AnnData files keep each categorical
   obs column's categories in an HDF5 object reference, which otherwise fails
   with `Object of type Reference is not JSON serializable`.
3. Writes each array with VirtualiZarr's kerchunk writer
   (`variable_to_kerchunk_arr_refs`), one array at a time.
4. Compresses the strings stored in the JSON with zlib. VirtualiZarr writes
   them uncompressed, which made the heart JSON 1.76 MB instead of 536 KB.
5. Skips `raw`, `layers`, `obsp`, `varm`, `varp`, and everything in `uns`
   except `uns/spatial`, and in `uns/spatial` it skips full-resolution
   images. The viewer opens every array in the reference at load, and it
   cannot open structured arrays such as scanpy's
   `uns/rank_genes_groups/scores`, so a reference with them fails to load.
6. Stores the bare file name as each chunk's URL. The viewer ignores it, and
   the full path repeated in every chunk entry makes the JSON larger.
7. Prints a note when `/X` is CSR (see [Choosing CSR Or CSC](#choosing-csr-or-csc)).

### Why Not VirtualiZarr's Own Writers

VirtualiZarr's usual route, `open_virtual_datatree(...)` and then
`.vz.to_kerchunk(...)`, does not work for AnnData:

- A DataTree can be written only to Icechunk, not to a kerchunk reference.
  The viewer reads kerchunk JSON, not Icechunk.
- A Dataset per group goes through xarray, which needs every array axis to
  have a dimension name. AnnData files have none, so VirtualiZarr names axis 0
  of every array `phony_dim_0`. xarray then rejects a group whose arrays
  differ in length, which every sparse matrix does, with
  `conflicting sizes for dimension 'phony_dim_0'` (for `X`, 4,993 values in
  `indptr` against 1,129,002 in `data`).

Writing one array at a time skips xarray's group check. The script reads the
parsed group tree from the `ManifestStore`'s private `_group` attribute, as
VirtualiZarr has no public accessor for it.

### Why Not kerchunk

kerchunk has been in maintenance mode since 15 September 2026
([fsspec/kerchunk#589](https://github.com/fsspec/kerchunk/pull/589)): bug
fixes only, and it points new projects to VirtualiZarr and Icechunk. Its
releases built on zarr 3 also fail on AnnData's strings, because zarr 3 no
longer accepts the NumPy `object` dtype kerchunk used for them (tested with
zarr 3.0, 3.1, and 3.4):

- 0.2.8 and 0.2.9 fail on the first string array, such as a category list:
  `Zarr data type resolution from object failed`.
- 0.2.10 uses zarr's `string` type instead, which zarr 3.0 does not have
  (`data type 'string' not understood`).
- With zarr 3.1 or later, 0.2.10 fails on scalar strings, which AnnData writes
  in `uns` (CELLxGENE's `uns/title`, scanpy's `uns/hvg/flavor`):
  `IndexError: too many indices for array`. It assigns `za[:] = value`, which
  zarr 3 rejects on a 0-d array.
- With that line patched, it fails on structured arrays such as scanpy's
  `uns/rank_genes_groups/scores`, again on the `object` dtype.

kerchunk 0.2.7 with zarr 2 still works, and its JSON loads in the viewer:

```bash
pip install "kerchunk==0.2.7" "zarr<3" h5py
```

```python
import json
from kerchunk.hdf import SingleHdf5ToZarr

refs = SingleHdf5ToZarr("sample.h5ad", inline_threshold=0, error="raise").translate()
with open("sample.h5ad.json", "w") as f:
    json.dump(refs, f)
```

Use `error="raise"`: with `error="warn"`, an array kerchunk cannot reference
(such as an lzf-compressed `/X/data`) is left out with only a warning, and the
viewer fails later with a less clear error. `SingleHdf5ToZarr.close()` does
not exist in 0.2.7.

## Can It Be Made On The Fly?

Not in the viewer today, and anywhere other than next to the file it is slow.

Making a reference reads only HDF5 metadata (object headers and chunk
B-trees) and the variable-length strings. It never reads expression values.
On local disk that takes under a second: VirtualiZarr parses the 333 MB heart
file in 0.4 s (2.5 s with Python start-up and imports), kerchunk 0.2.7 in
0.2 s.

Over HTTP it is slower. HDF5 spreads that metadata through the file, and
reads it with many small reads, each depending on the last. Parsing the heart
file straight from its Census URL, from the UK:

| Method                                         | Time         | Data read                | Requests |
| ---------------------------------------------- | ------------ | ------------------------ | -------- |
| VirtualiZarr with obstore `HTTPStore`          | 43 s         | 151 MB                   | 146      |
| kerchunk with fsspec, 1 MiB read-ahead blocks  | 101 s        | 324 MB (97% of the file) | 334      |
| kerchunk with fsspec, 64 KiB read-ahead blocks | 160 s        | 50 MB                    | 766      |
| Download with `curl`, then generate locally    | 18 s + 2.5 s | 333 MB                   | 1        |

So download the file, or run the script where the file already is (the
machine that wrote it, or a machine in the bucket's region), and generate the
reference once. Over a high-latency link, remote generation takes longer than
the download, and it reads a large part of the file anyway.

The viewer could do the same walk itself with an HDF5 reader over Range
requests ("Move remote HDF5 reads to a worker-backed lazy Range path" in
[UNIFIED_PLAN.md](../UNIFIED_PLAN.md), not done). It would face the same
chain of dependent reads before showing anything, on every load for every
user. A reference turns that into a one-off step.

## Writing An H5AD That Works Well

- **Compress with gzip, not lzf.** `adata.write_h5ad(path, compression="gzip")`.
  The viewer cannot decode lzf or szip, and h5py chunks compressed datasets
  automatically. Uncompressed files work too: anndata chunks sparse `/X`
  arrays anyway, but a dense `/X` written without compression is one block,
  read whole on the first gene.
- **Drop `obs` columns you do not need.** The viewer reads every one at load,
  one round trip per chunk.

### Choosing CSR Or CSC

| `/X` | Colour by a gene                                   | Selected-cell profile and ROI gene stats |
| ---- | -------------------------------------------------- | ---------------------------------------- |
| CSR  | Reads every cell in view; all of `/X` at full view | Yes                                      |
| CSC  | Reads one column per gene                          | No                                       |

For files where colouring by genes is the main use, CSC is much faster over a
reference. To convert, before writing:

```python
adata.X = adata.X.tocsc()
```

## Upload And Check

Upload the JSON next to the H5AD, with the same name plus `.json`:

```bash
aws s3 cp /data/sample.h5ad.json s3://bucket/path/sample.h5ad.json
```

- The JSON needs the same CORS rules as the H5AD
  ([S3/CORS hosting playbook](./s3-cors-playbook.md)). It is fetched whole, so
  it needs no Range support, and transfer compression is fine.
- The H5AD needs Range support and a `Content-Length` in `HEAD` responses.
- To check: the Dataset tab's log shows "Looking for H5AD reference …" and
  then "H5AD reference ready: N cells, M genes".

## Pitfalls

- **Regenerate when the H5AD is rewritten.** The viewer does not check that
  the JSON matches the file. A stale reference reads the wrong bytes, so
  chunks fail to decode or values are wrong.
- **Presigned URLs.** The JSON URL keeps the H5AD URL's query string. A token
  valid for both objects works; an S3 presigned URL is signed for one object,
  so the JSON request is refused.
- **Only JSON.** kerchunk's Parquet references and version 0 references (no
  `refs` key) are not read.
- **`Diagnose dataset` does not check the reference.** It checks only the
  H5AD.
