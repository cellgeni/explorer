# Large H5AD Files (`.h5ad.json` And `.h5ad.icechunk` References)

A reference lists every array in an H5AD file and the byte range of each of its
chunks, so the viewer can read the parts it needs with Range requests instead
of downloading the whole file. The viewer needs one, hosted next to the H5AD,
for files over 300 MiB. It reads two forms:

- **`sample.h5ad.json`:** one JSON file in
  [kerchunk's reference format](https://fsspec.github.io/kerchunk/spec.html).
- **`sample.h5ad.icechunk/`:** an [Icechunk](https://icechunk.io/) repository,
  a folder of files whose chunks are virtual references to byte ranges of the
  H5AD. Icechunk is the format VirtualiZarr writes by default, and Python
  tools can open it with xarray and zarr.

[`scripts/make_h5ad_reference.py`](../scripts/make_h5ad_reference.py) writes
either with [VirtualiZarr](https://virtualizarr.readthedocs.io/). The two give
the viewer the same arrays; the JSON loads a little faster (see
[JSON Or Icechunk?](#json-or-icechunk)).

## Do You Need One?

Only for files over 300 MiB (314,572,800 bytes). The viewer checks the size
with a `HEAD` request first (`readH5ad`, `src/datasets/h5adDataset.ts`):

- **Up to 300 MiB:** the whole file is downloaded with one `GET` and opened
  with `h5wasm`, the HDF5 library compiled to WebAssembly, in a worker. The
  file sits in the tab's memory, and nothing shows until the download
  finishes. A reference
  next to such a file is not used.
- **Over 300 MiB:** the file is not downloaded. The viewer fetches
  `<H5AD URL>.json`, or if there is none opens the `<H5AD URL>.icechunk`
  repository, and reads chunks of the H5AD through it. With neither, the load
  stops with "H5AD file is 318.0 MB, exceeding the browser load limit of
  300.0 MB, and no readable kerchunk reference file was found at
  …/sample.h5ad.json, nor an Icechunk repository at …/sample.h5ad.icechunk."
  (Sizes in this message are MiB.)

If the server sends no `Content-Length`, the download starts anyway and
switches to the reference once it passes 300 MiB.

Why not read the H5AD directly with Range requests? An HDF5 file has no table
of contents. Where each array's chunks are is recorded in object headers and
B-tree nodes spread through the file, and each node points to the next, so
finding them over HTTP is a long chain of small reads that each wait for the
one before. The reference does that walk once, in advance, and stores the
result (see [Can It Be Made On The Fly?](#can-it-be-made-on-the-fly)).

## What It Contains

### JSON

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

### Icechunk Repository

The repository describes the same arrays as a Zarr v3 store, on its `main`
branch. Its files:

```text
sample.h5ad.icechunk/
  repo                  branches, tags, and the snapshot list (Icechunk 2 format)
  snapshots/<id>        every group and array: zarr.json metadata and attributes
  manifests/<id>        one per array: where each chunk is
  chunks/<id>           strings over 64 KiB, if any
  transactions/<id>     what each commit changed; the viewer does not read these
  overwritten/          earlier copies of repo; not read
```

- **Metadata:** each group and array's `zarr.json` is in the snapshot, with
  the same AnnData attributes as the JSON. HDF5 gzip becomes the
  `numcodecs.zlib` codec, and strings use `vlen-utf8`.
- **Chunks:** each manifest entry is a virtual reference: the H5AD's URL, an
  offset, and a length, as in the JSON. The manifests are zstd-compressed.
- **Strings** are read from the H5AD when the repository is written, as for
  the JSON, and stored in the repository. The script raises Icechunk's inline
  limit to 65,535 bytes (the most it allows), so a string chunk up to that size
  sits inside its array's manifest rather than in a separate file under
  `chunks/`. None of the files below needed `chunks/`.

### Sizes

Written by `make_h5ad_reference.py`. The Icechunk size is the total of its
files, which are already compressed.

| File                                              | Cells × genes  | `/X`  | H5AD   | JSON   | JSON gzipped | Icechunk          |
| ------------------------------------------------- | -------------- | ----- | ------ | ------ | ------------ | ----------------- |
| [PBMC3K][pbmc3k]                                  | 2,638 × 1,838  | Dense | 32 MB  | 68 KB  | 35 KB        | 51 KB, 31 files   |
| [CELLxGENE Visium, GEO GSM6592057][census-visium] | 4,992 × 35,477 | CSR   | 9 MB   | 484 KB | 309 KB       | 364 KB, 86 files  |
| [CELLxGENE Visium heart, HCAHeartST9383354][hrt]  | 4,992 × 32,397 | CSR   | 333 MB | 536 KB | 298 KB       | 412 KB, 233 files |

[pbmc3k]: https://mp33.cog.sanger.ac.uk/public/h5ad/pbmc3k.h5ad
[census-visium]: https://cellxgene-census-public-us-west-2.s3.us-west-2.amazonaws.com/cell-census/2025-11-08/h5ads/60d5175f-f477-48b2-8396-ad76be2c3310.h5ad
[hrt]: https://cellxgene-census-public-us-west-2.s3.us-west-2.amazonaws.com/cell-census/2025-11-08/h5ads/4a9f7ec6-5de7-4e8a-acaa-d6d100a5ea58.h5ad

The heart file is large because of a full-resolution H&E image in
`uns/spatial/<library>/images/fullres` (18,000 × 31,960 × 3, 316 MB
compressed). The viewer never reads it.

## How The Viewer Uses It

`readH5adReferenceOrThrow` (`src/datasets/h5adDataset.ts`):

1. Fetches `<H5AD URL>.json`: the H5AD URL's path plus `.json`, with the H5AD
   URL's query string. If that fails, opens `<H5AD URL>.icechunk` the same way
   (`readH5adIcechunkOrThrow`). If both are present, the JSON is used.
2. Reads every chunk from the H5AD URL. The file name or URL stored in the
   JSON or repository is ignored, so the reference can be made from a local
   copy, and the files can move together without regenerating it.
3. Opens the reference as a Zarr store, builds the AnnData group tree from its
   metadata, and parses it with the same code as an in-memory file. Everything
   in [H5AD](./modalities/h5ad.md) and
   [Standard Visium](./modalities/visium.md) applies.
   - JSON: a Zarr v2 store (`ReferenceStore` from `@zarrita/storage`).
   - Icechunk: a Zarr v3 store read with
     [icechunk-js](https://github.com/EarthyScience/icechunk-js)
     (`openIcechunkRepository`, `src/zarr/icechunkStore.ts`). Opening it reads
     `repo` and one snapshot, which holds all the metadata. The viewer then
     starts reading the manifests of the arrays it reads at load (`obs`,
     `var`, `obsm`, `uns`, and `/X/indptr`), 6 at a time.
4. Reads chunks as Range requests to the H5AD, at most 6 at a time
   (`H5AD_REFERENCE_FETCH_CONCURRENCY`, and the same limit for everything an
   Icechunk repository reads), only when they are needed:

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

### JSON Or Icechunk?

The same heart file and references, served from a local server that adds
150 ms to every request (about the round trip from the UK to AWS us-west-2),
2026-11-10:

| Reference                                       | Ready  | Requests                                 |
| ----------------------------------------------- | ------ | ---------------------------------------- |
| `heart.h5ad.json`                               | 56.4 s | 359: the JSON and 356 Range reads        |
| `heart.h5ad.icechunk`                           | 63.7 s | 594: 225 manifests and 366 Range reads   |
| `heart.h5ad.icechunk`, manifests not read ahead | 91 s   | 573: each manifest read before its array |

The Range reads are the same. An Icechunk repository keeps one manifest per
array, so it costs one more request per array; read ahead 6 at a time, that
adds about 7 s here. Use the JSON when only the viewer reads the file, and
Icechunk when the same references should also open in Python, or when the
JSON would be large: the JSON is fetched whole before anything shows, while an
Icechunk repository reads only the manifests of the arrays in use.

## Generating One

Requirements: Python 3 with VirtualiZarr 2.8 or later (tested with 2.8.0 on
Python 3.12, with zarr 3.4, and Icechunk 2.3.1 for `--icechunk`). The H5AD must
be on local disk.

```bash
pip install "virtualizarr[hdf,icechunk]>=2.8"
```

```bash
python scripts/make_h5ad_reference.py /data/sample.h5ad
```

This writes `/data/sample.h5ad.json`. To write the Icechunk repository
`/data/sample.h5ad.icechunk` instead:

```bash
python scripts/make_h5ad_reference.py --icechunk /data/sample.h5ad
```

Options:

- `-o PATH` writes elsewhere. With `--icechunk`, `PATH` must not exist yet.
- `--all` references every group, not only those the viewer reads (for use
  with other tools; see step 5 below).
- `--url URL`, with `--icechunk`, stores the H5AD's hosted `http(s)://` URL in
  each virtual chunk instead of its local `file://` path. The viewer ignores
  it; Python tools need it to read the hosted repository (see
  [Reading It In Python](#reading-it-in-python)).

Generating the heart file's JSON or repository takes about 2.5 s, most of it
Python start-up. With [uv](https://docs.astral.sh/uv/), no install step is
needed:

```bash
uv run --no-project --python 3.12 --with "virtualizarr[hdf,icechunk]>=2.8" python scripts/make_h5ad_reference.py --icechunk /data/sample.h5ad
```

What the script does:

1. Stops if an array the viewer reads is lzf or szip compressed. VirtualiZarr
   references them, but the viewer cannot decode them. Warns if a dense `/X`
   over 64 MiB is one unchunked block.
2. Parses the file with VirtualiZarr's `HDFParser`, with
   `links_and_references=True`. Older AnnData files keep each categorical
   obs column's categories in an HDF5 object reference, which otherwise fails
   with `Object of type Reference is not JSON serializable`.
3. Writes each array, one at a time, with VirtualiZarr's kerchunk writer
   (`variable_to_kerchunk_arr_refs`), or with `--icechunk` its Icechunk writer
   (`write_virtual_variable_to_icechunk`) into a new repository, committed to
   `main`. The repository's virtual chunk container is the folder of the
   H5AD's URL.
4. Compresses the strings stored in the JSON with zlib. VirtualiZarr writes
   them uncompressed, which made the heart JSON 1.76 MB instead of 536 KB.
   Icechunk compresses its manifests itself.
5. Skips `raw`, `layers`, `obsp`, `varm`, `varp`, and everything in `uns`
   except `uns/spatial`, and in `uns/spatial` it skips full-resolution
   images. The viewer opens every array in the reference at load, and it
   cannot open structured arrays such as scanpy's
   `uns/rank_genes_groups/scores`, so a reference with them fails to load.
6. Stores the bare file name as each chunk's URL in the JSON. The viewer
   ignores it, and the full path repeated in every chunk entry makes the JSON
   larger. Icechunk needs an absolute URL, so the repository stores the
   `file://` path, or `--url`.
7. Prints a note when `/X` is CSR (see [Choosing CSR Or CSC](#choosing-csr-or-csc)).

### Why Not VirtualiZarr's Own Writers

VirtualiZarr's usual route, `open_virtual_datatree(...)` and then
`.vz.to_icechunk(...)` (a DataTree has no `to_kerchunk`), or
`.vz.to_kerchunk(...)` on each group's Dataset, does not work for AnnData. It
goes through xarray, which needs every array axis to have a dimension name.
AnnData files have none, so VirtualiZarr names axis 0 of every array
`phony_dim_0`. xarray then rejects a group whose arrays differ in length,
which every sparse matrix does, with
`conflicting sizes for dimension 'phony_dim_0'` (for `X`, 4,993 values in
`indptr` against 1,129,002 in `data`).

Writing one array at a time skips xarray's group check. The script reads the
parsed group tree from the `ManifestStore`'s private `_group` attribute, as
VirtualiZarr has no public accessor for it. The `phony_dim_*` names are still
stored as each Icechunk array's `dimension_names`; the viewer ignores them.

With `--url`, the script renames each chunk's path with a function that leaves
missing and inlined chunks alone. Passing `ManifestArray.rename_paths` a
string instead also replaces their markers, which turns every string chunk
into a reference to the wrong bytes of the H5AD.

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

Or upload the repository folder, with the same name plus `.icechunk`:

```bash
aws s3 sync /data/sample.h5ad.icechunk s3://bucket/path/sample.h5ad.icechunk
```

- The JSON and the repository's files need the same CORS rules as the H5AD
  ([S3/CORS hosting playbook](./s3-cors-playbook.md)). They are fetched whole,
  so they need no Range support, and transfer compression is fine. The
  repository needs no listing: the viewer reads `repo`, then files named in it.
- The H5AD needs Range support and a `Content-Length` in `HEAD` responses.
- To check: the info drawer's activity log shows "Looking for H5AD
  reference …" and then "H5AD reference ready: N cells, M genes", or for a
  repository "H5AD Icechunk repository opened: N groups and arrays" and
  "H5AD Icechunk repository ready: N cells, M genes".

The repository can also be entered as the dataset URL
(`…/sample.h5ad.icechunk`). Its chunks are then read from the H5AD next to it,
with no size check, so even an H5AD under 300 MiB loads lazily instead of
being downloaded whole. Diagnose dataset checks a repository entered this way
(it reads the first chunk of `/X`), but not one found next to an H5AD.

## Reading It In Python

A repository written with `--url` opens with Icechunk and zarr anywhere the
H5AD is readable, for example with anndata (checked with Icechunk 2.3.1 and
anndata 0.13 against the Census Visium file):

```python
import anndata as ad
import icechunk

repo = icechunk.Repository.open(
    icechunk.http_storage("https://bucket.example/path/sample.h5ad.icechunk"),
    # The folder of the --url.
    authorize_virtual_chunk_access={"https://bucket.example/path/": icechunk.credentials.HttpAccess},
)
adata = ad.read_zarr(repo.readonly_session("main").store)
```

Icechunk checks that the H5AD has not changed since the repository was
written: a file modified later fails with "the checksum of the object owning
the virtual chunk has changed". So upload the H5AD before writing the
repository with `--url`. The viewer does not make this check (it would need
extra CORS headers).

## Pitfalls

- **Regenerate when the H5AD is rewritten.** The viewer does not check that
  the reference matches the file. A stale reference reads the wrong bytes, so
  chunks fail to decode or values are wrong.
- **Presigned URLs.** The JSON and repository URLs keep the H5AD URL's query
  string. A token valid for all the objects works; an S3 presigned URL is
  signed for one object, so the other requests are refused.
- **One JSON or one repository.** kerchunk's Parquet references and version 0
  references (no `refs` key) are not read. Only an Icechunk repository's `main`
  branch is read.
- **`Diagnose dataset` does not check the reference** found next to an H5AD.
  It checks only the H5AD.
- **A truncated Range response** was seen once while testing a repository
  against the Census bucket: "Virtual range response size mismatch … expected
  5417 bytes, got 667". Loading again worked, and it could not be reproduced.
