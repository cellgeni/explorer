# S3/CORS Hosting Playbook

The viewer reads Xenium output directly from object storage. The bucket or CDN
must support browser HTTP Range requests; otherwise Parquet, Zarr zip, and OME
TIFF reads will either fail or silently become full-file downloads.

## Required CORS Policy

- Allow methods: `GET`, `HEAD`.
- Allow request headers: `Range`.
- Expose response headers: `Content-Length`, `Content-Range`, `Accept-Ranges`,
  `ETag`.
- Restrict `AllowedOrigin` to the production app origin when deploying outside
  development.

## Object Serving Rules

- Do not apply transfer compression (`Content-Encoding`) to Parquet, TIFF, Zarr
  zip, or HDF5 files. These formats are already compressed, and transfer gzip
  breaks byte offsets.
- Keep dataset paths immutable and serve long-lived `Cache-Control` plus `ETag`.
- Prefer HTTP/2 or HTTP/3 on the CDN because the app makes many small Range
  requests.
- If cross-origin isolated threaded WASM is enabled later, serve the app with
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`, and serve dataset assets with
  `Cross-Origin-Resource-Policy: cross-origin`.

## Manual Range Check

Run this against key files such as `cells.parquet`, `cell_boundaries.parquet`,
`transcripts.parquet`, `transcripts.zarr.zip`, cell-feature matrix files, and
image TIFFs:

```sh
curl -r 0-0 -i https://bucket.example/path/to/cells.parquet
```

Expected result:

- HTTP status `206 Partial Content`.
- A `Content-Range` header such as `bytes 0-0/123456789`.
- No `Content-Encoding` header.

The app performs the same one-byte Range probe before loading large remote
assets, including overview cells, boundaries, transcript Parquet, transcript
Zarr, cell-feature matrices, ROI transcript exports, selected-cell transcript
summaries, diagnostics checks, and image TIFFs. If the probe returns HTTP `200`,
lacks an exposed `Content-Range`, or fails due to CORS, that workflow stops with
an actionable error in the viewer.
