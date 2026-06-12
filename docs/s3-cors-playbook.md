# S3-Compatible CORS Hosting Playbook

The viewer reads Xenium output directly from object storage. AWS S3 and
S3-compatible services such as Ceph RADOS Gateway (RGW) are both valid targets
as long as the bucket, gateway, CDN, or reverse proxy supports browser HTTP
Range requests. Otherwise Parquet, Zarr zip, and OME TIFF reads will either fail
or silently become full-file downloads.

## Required CORS Policy

- Allow methods: `GET`, `HEAD`.
- Allow request headers: `Range`.
- Expose response headers: `Content-Length`, `Content-Range`, `Accept-Ranges`,
  `ETag`.
- Restrict `AllowedOrigin` to the production app origin when deploying outside
  development.

For AWS S3, apply the policy with `aws s3api put-bucket-cors`. For Ceph RGW or
another S3-compatible endpoint, use the same command with
`--endpoint-url https://rgw.example.org`, or apply the equivalent CORS policy
through your object-store administration tooling.

## Object Serving Rules

- Do not apply transfer compression (`Content-Encoding`) to Parquet, TIFF, Zarr
  zip, or HDF5 files. These formats are already compressed, and transfer gzip
  breaks byte offsets.
- Keep dataset paths immutable and serve long-lived `Cache-Control` plus `ETag`.
- Prefer HTTP/2 or HTTP/3 on the CDN or fronting proxy because the app makes
  many small Range requests.
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

For S3-compatible stores, run the same check against the public HTTPS URL that
the browser will use, not only against the private gateway endpoint. This catches
CDN or reverse-proxy behavior that strips `Range`, `Content-Range`, or CORS
headers.
