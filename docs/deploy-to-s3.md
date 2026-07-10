# Deploy The React App To S3-Compatible Object Storage

This project builds to a static Vite app. There is no server-side application to
deploy: the browser downloads the React bundle, workers, and WASM assets from
`dist/`, then reads Xenium, Visium HD, H5AD, or image-only sources directly from
the URLs entered in the UI or restored from the shareable URL hash.

Use this guide for the app bucket or object-store prefix. It applies to AWS S3
and S3-compatible services such as Ceph RADOS Gateway (RGW). Dataset buckets
still need the byte-range and CORS rules in
[S3/CORS Hosting Playbook](./s3-cors-playbook.md).

## Recommended Shape

- Host the app build from an S3 or S3-compatible bucket.
- Put a CDN or HTTPS reverse proxy in front of that bucket for TLS, custom
  headers, and caching. On AWS this is usually CloudFront; for Ceph RGW this may
  be an institutional CDN, nginx, HAProxy, or another edge service.
- Keep spatial data and image sources in a separate bucket or prefix so deploys
  cannot delete large dataset objects by accident.
- Serve the app at the distribution root unless you intentionally build with a
  Vite `base` path.

An edge layer is recommended because the production app should send the same
cross-origin isolation headers used by the Vite dev and preview servers:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

AWS S3 static website hosting alone cannot attach those arbitrary response
headers. Some S3-compatible gateways can add headers directly, but the edge
layer is still the most portable place to manage them.

## Build Locally

Install dependencies and run the normal verification pass:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

The deployable output is written to `dist/`.

Smoke test the production build before uploading:

```sh
npm run preview
```

The preview server is configured with the required cross-origin isolation
headers. Load the app, run `Diagnose Dataset`, and load a known dataset before
publishing.

If the app will be served from a subpath such as
`https://viewer.example.org/xenium/`, build with a matching Vite base:

```sh
npm run build -- --base /xenium/
```

For root hosting such as `https://viewer.example.org/`, use the default build.

## Prepare The App Bucket Or Prefix

Create a dedicated bucket or prefix for the app build. For AWS S3:

```sh
APP_BUCKET=webatlas-viewer-prod
AWS_REGION=eu-west-2

aws s3 mb "s3://$APP_BUCKET" --region "$AWS_REGION"
aws s3api put-public-access-block \
  --bucket "$APP_BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

For an S3-compatible service such as Ceph RGW, use the same AWS CLI with the
gateway endpoint:

```sh
APP_BUCKET=webatlas-viewer-prod
S3_ENDPOINT_URL=https://rgw.example.org

aws --endpoint-url "$S3_ENDPOINT_URL" s3 mb "s3://$APP_BUCKET"
```

Use a private-origin setup where your platform supports it. On AWS this is
usually CloudFront origin access control (OAC). On Ceph RGW, access is normally
controlled with RGW users, bucket policies, gateway configuration, or the
fronting CDN/proxy. Avoid making the app bucket public unless that is the
intentional serving model for your environment.

## Upload `dist/`

Upload hashed Vite assets with a long immutable cache lifetime, then upload the
HTML and any non-hashed root files with no-cache headers:

```sh
aws s3 sync dist/assets "s3://$APP_BUCKET/assets" \
  --delete \
  --cache-control "public,max-age=31536000,immutable"

aws s3 sync dist "s3://$APP_BUCKET" \
  --delete \
  --exclude "assets/*" \
  --cache-control "no-cache,max-age=0,must-revalidate"
```

For S3-compatible storage, add the endpoint URL to the same commands:

```sh
aws --endpoint-url "$S3_ENDPOINT_URL" s3 sync dist/assets "s3://$APP_BUCKET/assets" \
  --delete \
  --cache-control "public,max-age=31536000,immutable"

aws --endpoint-url "$S3_ENDPOINT_URL" s3 sync dist "s3://$APP_BUCKET" \
  --delete \
  --exclude "assets/*" \
  --cache-control "no-cache,max-age=0,must-revalidate"
```

Do not run `aws s3 sync dist s3://bucket --delete` at the root of a bucket that
also contains spatial datasets or image sources. Use a dedicated app bucket, or
deploy the app to a scoped prefix and build with the matching Vite `base`.

## Configure The Edge Layer

Create or update the CDN or HTTPS reverse proxy with:

- Origin: the private app S3 or S3-compatible bucket.
- Default root object: `index.html`.
- HTTP policy: redirect HTTP to HTTPS.
- Response headers policy:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- Cache policy: respect origin `Cache-Control` headers.
- Optional custom error responses: map `403` and `404` to `/index.html` with
  status `200` if you later add non-hash client routes. The current app uses
  hash-based share URLs, so this is not required for normal operation.

On AWS, the edge layer is usually CloudFront. For Ceph RGW, use whatever service
terminates public HTTPS for the gateway and can attach those response headers.

After each deploy, invalidate only the mutable entry points:

```sh
DISTRIBUTION_ID=E1234567890ABC

aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/" "/index.html"
```

Hashed files under `/assets/` do not need invalidation when uploaded with
immutable caching.

If your S3-compatible edge service does not have CloudFront-style invalidations,
purge `/` and `/index.html` with that service's cache-purge mechanism, or keep
the no-cache `Cache-Control` headers above so clients revalidate them.

## Dataset Bucket Requirements

The app can point at Xenium output folders, Visium HD output folders, direct
H5AD files, and image-only URLs, but the browser must be able to range-read
large binary assets. For S3 or S3-compatible datasets, configure the dataset
bucket, gateway, CDN, or reverse proxy with:

```json
[
  {
    "AllowedOrigins": ["https://viewer.example.org"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Apply it with:

```sh
aws s3api put-bucket-cors \
  --bucket "$DATA_BUCKET" \
  --cors-configuration file://cors.json
```

For Ceph RGW or another S3-compatible endpoint:

```sh
aws --endpoint-url "$S3_ENDPOINT_URL" s3api put-bucket-cors \
  --bucket "$DATA_BUCKET" \
  --cors-configuration file://cors.json
```

Do not serve Parquet, TIFF, Zarr zip, OME-Zarr chunks, or HDF5 files with
transfer `Content-Encoding`. These formats are read by byte offset.

## Verify Production

Check the app headers:

```sh
curl -I https://viewer.example.org/
```

Expected response headers include:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Check a required dataset file:

```sh
curl -r 0-0 -i https://data.example.org/path/to/output/cells.parquet
```

Expected result:

- `206 Partial Content`
- `Content-Range: bytes 0-0/...`
- no `Content-Encoding`

Finally, open the deployed app, paste a hosted source URL, run
`Diagnose Dataset`, and load the dataset or image.
