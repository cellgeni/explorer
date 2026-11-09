# S3-Compatible CORS Hosting Playbook

The viewer reads spatial datasets and image sources directly from object
storage. AWS S3 and S3-compatible services such as Ceph RADOS Gateway (RGW) are
both valid targets as long as the bucket, gateway, CDN, or reverse proxy
supports browser HTTP Range requests. Otherwise Parquet, Zarr zip, OME-Zarr,
HDF5, and OME-TIFF reads will either fail or silently become full-file
downloads.

## Required CORS Policy

- Allow methods: `GET`, `HEAD`.
- Allow request headers: `Range`.
- Expose response headers: `Content-Length`, `Content-Range`, `Accept-Ranges`,
  `ETag`. The app works without `Content-Range` exposed, but other browser
  tools may need it.
- Send the CORS headers on error responses (`403`, `404`) as well. Without
  them the browser hides the status, so a missing file looks like a network
  failure; see [Hosts that hide error responses](#hosts-that-hide-error-responses).
- Restrict `AllowedOrigin` to the production app origin when deploying outside
  development.

For AWS S3, apply the policy with `aws s3api put-bucket-cors`. For Ceph RGW or
another S3-compatible endpoint, use the same command with
`--endpoint-url https://rgw.example.org`, or apply the equivalent CORS policy
through your object-store administration tooling.

## Object Serving Rules

- Do not apply transfer compression (`Content-Encoding`) to Parquet, TIFF, Zarr
  zip, OME-Zarr chunks, or HDF5 files. These formats are already compressed, and
  transfer gzip breaks byte offsets.
- Keep dataset paths immutable and serve long-lived `Cache-Control` plus `ETag`.
- Prefer HTTP/2 or HTTP/3 on the CDN or fronting proxy because the app makes
  many small Range requests.
- The app is served with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` in development, preview, and the
  recommended production setup ([Deploy to S3](./deploy-to-s3.md)). Under that
  policy, every cross-origin dataset read must be a CORS request with a valid
  CORS response. The app's reads are all CORS requests, so the policy above is
  enough; `Cross-Origin-Resource-Policy: cross-origin` on dataset objects is
  not required. The app does not need cross-origin isolation itself: nothing
  uses `SharedArrayBuffer`, and DuckDB-WASM uses its non-threaded bundles.

## Manual Range Check

Run this against key files such as `cells.parquet`, `cell_boundaries.parquet`,
`transcripts.parquet`, `transcripts.zarr.zip`, Visium HD
`tissue_positions.parquet`, `feature_slice.h5`, H5AD files, cell-feature matrix
files, image TIFFs, and representative OME-Zarr chunk URLs:

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
summaries, diagnostics checks, and image TIFFs. If the probe returns HTTP `200`
or fails due to CORS, that workflow stops with an actionable error in the
viewer. A `206` is enough: `Content-Range` does not have to be exposed. A `404`, or a `403` from a bucket that denies
listing, is reported as a missing or unreadable file instead: check the path and
object permissions rather than the Range configuration. A `5xx` is reported as a
server error on the host.

For S3-compatible stores, run the same check against the public HTTPS URL that
the browser will use, not only against the private gateway endpoint. This catches
CDN or reverse-proxy behavior that strips `Range`, `Content-Range`, or CORS
headers.

## Hosts That Hide Error Responses

Some hosts add CORS headers only to successful responses. Apache at
`ftp.ebi.ac.uk`, which serves the BioImage Archive, is one. A request for a
missing file then fails in the browser with `TypeError: Failed to fetch`, the
same as a network failure, and the app cannot read the `404`.

The app works around this in two ways:

- **Folder index pages.** When the dataset folder URL returns an index page
  (Apache or nginx autoindex, or Python `http.server`) with CORS headers, the
  app reads it once during detection and does not request files it does not
  list. A required file that is not listed is reported as "File not found".
  Dotfiles such as `.zchunkstore` are still requested, because index pages
  usually hide them.
- **Likely missing files.** Without an index page, a request that fails with
  no response on a host that has answered other requests, but has never
  answered with a readable error status, is reported as "File most likely
  missing" rather than as a CORS or Range problem.

If you control the host, send CORS headers on every response instead.
