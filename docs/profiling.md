# Profiling

How to measure where the main thread spends its time while the viewer loads a
dataset, and how to compare two builds. The measurements in the plan (for
example the
[worker moves](plan/phases/optimization-pass.md#worker-moves-2026-11-13) in
the optimization pass) were made this way.

## Profile A Build

Profile a production build, not the dev server, whose module transforms
change the timings. Build without minifying so function names survive:

```sh
npx vite build --minify false --outDir /tmp/explorer-base
npx vite preview --outDir /tmp/explorer-base --host 127.0.0.1 --port 4198 --strictPort
```

Avoid port 4173: the E2E config uses it, and Playwright reuses a server
already listening there, which may be another checkout's build.

Then profile a load in headless Chromium. The script uses Playwright's
Chromium, installed as for the E2E tests (see the
[README](../README.md#quick-start)):

```sh
node scripts/profile-load.mjs http://127.0.0.1:4198 <dataset-url> --gene SNAP25
```

`scripts/profile-load.mjs` opens `<app>/#dataset=<dataset-url>` and records a
CPU profile (1 ms samples) until the gene search box is enabled, plus
`--settle` seconds (default 3). With `--gene`, it records a second profile
while it colours the cells by that gene, until the expression status line
appears, and prints that line so builds can be checked for the same result.
Datasets without genes need `--until <selector>`, a CSS selector for an
element that appears when the scenario is done.

Other options:

| Option                   | Effect                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `--runs <n>`             | Repeat each app URL n times                                                                              |
| `--steps <keys>`         | After the load (and `--gene`), press each key on the spatial view, with one profile per key              |
| `--step-settle <s>`      | Profile each step this many seconds (default 2)                                                          |
| `--then <urls>`          | Then open each of these datasets (comma-separated) in turn from the dataset field, with one profile each |
| `--hash <params>`        | Add these parameters to the link's hash, for example `cellBounds=0` to start with cell outlines off      |
| `--requests <text>`      | Count each phase's requests whose URL contains `<text>`, their megabytes, and the slowest five           |
| `--memory`               | After each phase, report the JavaScript heap and ArrayBuffer memory of the page and of each live worker  |
| `--gpu`                  | Draw with the Mac's GPU (Metal through ANGLE) instead of SwiftShader                                     |
| `--throttle <mbit>,<ms>` | Limit the bandwidth to `<mbit>` megabits per second and add `<ms>` of latency to every request           |
| `--raw <prefix>`         | Save each profile as `.cpuprofile`, which Chrome DevTools' Performance panel can open                    |
| `--json`                 | Print one JSON line per profile instead of text                                                          |

A dataset URL of `none` profiles the start screen until the dataset field
shows. With `--throttle 10,150 --requests <app port>` it gives the
JavaScript the start screen fetches and how long it takes on a slower
connection.

Steps are keys pressed on the focused spatial view, using deck.gl's
keyboard controls: `=` zooms in, `-` zooms out and the arrow keys pan. For
example, `--gene SNAP25 --steps "=,=,=,=,=,ArrowRight"` colours the cells by
SNAP25, zooms in five times and pans once, with a profile for each step and
the expression status line after it.

`--memory` reads CDP's `Runtime.getHeapUsage` from the page and from every
worker alive at the end of the phase. For each it prints the JavaScript heap
and the memory behind its ArrayBuffers, which includes WebAssembly memory.
GPU memory is not counted. A worker that ends before it is read is counted
as ended.

## Compare Builds

Build each branch into its own folder and serve each on its own port, then
pass both URLs, comma-separated:

```sh
node scripts/profile-load.mjs http://127.0.0.1:4198,http://127.0.0.1:4199 <dataset-url> --runs 2
```

The script profiles the URLs in turn on every run, so drift in the network or
the machine falls on both. Report ranges over the runs, and check that the
status lines match.

## Read The Output

For each profile the script prints:

- **Main thread by script.** Time per built chunk, named without its hash.
  Dependencies are grouped as in `vite.config.ts`: `spatial-io-vendor` holds
  zarrita, hyparquet and geotiff (h5wasm is in a lazily loaded chunk of its
  own, `hdf5_hl`); `codec-vendor` holds pako, LERC, zstd and OpenJPEG's
  loader, while JPEG 2000 decoding itself is in the `openjpegwasm_decode`
  WebAssembly module; `deck-vendor` holds deck.gl and luma.gl. App code is in
  `index` or in lazily loaded chunks named after their module, such as
  `h5adDataset` or `spatialDataDataset`. Worker time is not included.
- **Hottest functions.** Self time per function, with the script and line
  where the function starts and the line that had the most samples. An
  anonymous function's self time includes the built-ins it calls, such as
  the `Map` constructor or `Array.prototype.map`.
- **Busy stretches.** Runs of samples with no idle time between them, the
  longest first. A stretch can hold several tasks back to back, so it is an
  upper bound on the longest task.

Some things to keep in mind:

- **`(program)` is mostly drawing.** Headless Chromium renders WebGL with
  SwiftShader on the CPU, so drawing a large dataset takes seconds and shows
  up as `(program)`. Compare it between builds only if the drawing changed.
- **Async work has no callers.** Code that resumes after an `await` starts a
  new stack, so a profile cannot say which caller led to it. Find it by
  elimination, or time the suspect function on its own.
- **Code can be slower in the app than alone.** With many objects or typed
  arrays alive, allocation-heavy code slows down, and the extra time is
  charged to the JavaScript frames, not to `(garbage collector)`. When the
  SpatialData shapes were held as one object and one `Float32Array` per
  shape, building a `Map` of 598,222 ids took 1.5 s during a load and about
  150 ms in an idle page. If a loop is far slower in a profile than in
  isolation, look at what the page is holding.

## Serve Data Locally

Remote hosts make timings noisy. `scripts/range-server.mjs` serves data
locally with byte ranges and CORS, as the viewer needs.

Serve a folder:

```sh
node scripts/range-server.mjs /path/to/data --port 4199
```

Then open, for example, `http://127.0.0.1:4199/heart.h5ad`. Add `--delay 300`
to answer each request 300 ms after it arrives, as a distant host would, to
see how many requests a load makes one after another.

Other options, for testing how the viewer copes with a host that misbehaves:

| Option                        | Effect                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `--log`                       | Print a line per request: method, path, range, status, bytes, time, and any fault    |
| `--fail <share>[:<status>]`   | Answer this share of range requests (0 to 1) with `<status>` (default 503)           |
| `--stall <share>[:<ms>]`      | Hold this share of range requests for `<ms>` (default 90,000) before answering       |
| `--stall-body <share>[:<ms>]` | Send the headers and half the body of this share of range requests, then wait `<ms>` |
| `--seed <n>`                  | Seed the choice of failed and stalled requests (default 1), so a run can be repeated |

Only `GET` requests with a `Range` header fail or stall. `HEAD` probes and
whole-file reads are always answered. A stalled request still completes, as
the BioImage Archive's do (see below).

Mirror one remote file, such as a zipped SpatialData store or a large H5AD:

```sh
node scripts/range-server.mjs --mirror <url> /tmp/sample.zarr.zip --port 4197
```

Open the mirror at `http://127.0.0.1:4197/<name>`, and keep the name's suffix
(`.zarr.zip`, `.h5ad`), since detection uses it. The server creates the local
file at the remote size and copies each range from the origin the first time
it is asked for, recording copied ranges in `<file>.ranges.json`. The first
load is as slow as the origin; later loads read only local bytes. Sparse files
(APFS, ext4) take disk space only for what was copied: the 24 GB 460-plex zip
needed 121 MB for a load. Folder datasets such as Xenium output need their
files downloaded and served from a folder instead.

The BioImage Archive host is one reason to mirror: some of its range requests
stall for a minute or more (see
[Hosts That Stall Range Requests](./s3-cors-playbook.md#hosts-that-stall-range-requests)).

## Synthetic Data At Scale

Most costs worth measuring show only at hundreds of thousands of cells, and
the test fixtures hold tens. `scripts/make_scale_data.py` writes synthetic
datasets at the Xenium demo's scale into a folder outside the repository:

```sh
uv run --no-project --python 3.12 --with "numpy>=2" --with "pyarrow>=15" \
  --with "h5py>=3.11" --with "zarr>=2.18,<3" --with "tifffile>=2024.8" \
  python scripts/make_scale_data.py /tmp/scale
node scripts/range-server.mjs /tmp/scale --port 4199
```

Then open `http://127.0.0.1:4199/xenium/` or
`http://127.0.0.1:4199/scale.h5ad`. The two datasets:

- **`xenium/`**, 1.4 million cells: a Xenium Onboard Analysis folder.
  - Cells and outlines are in Parquet. The cell and nucleus outlines have
    25 vertices per cell, as in the demo.
  - The cell-feature matrix and two clusterings are in zipped Zarr.
  - It has a gene panel and a four-channel morphology image, one OME-TIFF
    per channel with a pyramid of SubIFDs.
  - The image's pixels are 0.85 µm, four times the demo's, to keep it to
    about 600 MB (`--image-pixel-um`).
  - There are no transcripts. `--with-h5` also writes
    `cell_feature_matrix.h5`, which the viewer reads only when the Zarr
    matrix fails.
- **`scale.h5ad`**, 1 million cells: an AnnData file with `obsm/spatial` in
  micrometres, an `X_umap` embedding, 20 numeric and 6 categorical obs
  columns, and a CSR `X`.
  - At about 200 MB it is read by range, and its `X` is read whole at load.
  - With more cells or genes per cell, `X` passes 300 MiB and is read gene by
    gene instead.

Both are drawn from one seeded model of a tissue: cells on a jittered 10 µm
grid, in 20 clusters that are patches of the slide.

- **Marker genes:** each cluster has five, `M01a` to `M20e`, expressed by
  most of its cells, so each is in a few percent of all cells.
- **Other genes:** `G0100` onwards are expressed at random, a few often and
  most rarely. `RARE1` is in one cell in 2,000.

Options set the cell counts (`--xenium-cells`, `--h5ad-cells`), the genes
(`--genes`, `--genes-per-cell`), which datasets to write (`--what`) and the
seed. The default run takes about two minutes and under 3 GB of memory. The same
options write the same data, so a measurement can be repeated on another
machine.
