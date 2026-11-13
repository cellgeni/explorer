# Profiling

How to measure where the main thread spends its time while the viewer loads a
dataset, and how to compare two builds. The measurements in
[`UNIFIED_PLAN.md`](../UNIFIED_PLAN.md) (for example the worker moves under
the main-thread Open Item) were made this way.

## Profile A Build

Profile a production build, not the dev server, whose module transforms
change the timings. Build without minifying so function names survive:

```sh
npx vite build --minify false --outDir /tmp/explorer-base
npx vite preview --outDir /tmp/explorer-base --host 127.0.0.1 --port 4198 --strictPort
```

Avoid port 4173: the E2E config uses it, and Playwright reuses a server
already listening there, which may be another checkout's build.

Then profile a load in headless Chromium:

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

| Option              | Effect                                                                                |
| ------------------- | ------------------------------------------------------------------------------------- |
| `--runs <n>`        | Repeat each app URL n times                                                           |
| `--requests <text>` | Count the requests whose URL contains `<text>`, their megabytes, and the slowest five |
| `--raw <prefix>`    | Save each profile as `.cpuprofile`, which Chrome DevTools' Performance panel can open |
| `--json`            | Print one JSON line per profile instead of text                                       |

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
  zarrita, hyparquet, geotiff and h5wasm; `codec-vendor` holds OpenJPEG,
  pako, LERC and zstd; `deck-vendor` holds deck.gl and luma.gl. App code is in
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

Then open, for example, `http://127.0.0.1:4199/heart.h5ad`.

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
