# Phase 9 — OME-Zarr Image Pyramids (Recorded From Git)

Shipped on 2026-07-10 (`f9560ee`) with later fixes. Not planned in advance.

- [x] Open OME-Zarr images (Zarr v2 or v3) as image-only sources, from a
      `.zarr`/`.ome.zarr` URL, a `zarr.json` or `.zattrs` URL, or a folder whose
      root metadata holds OME multiscales (see [5.5](../data-contracts.md#55-ome-zarr-images-phase-9)).
- [x] A shared `ImagePyramidLoader` interface for TIFF and OME-Zarr, so the
      morphology canvas, channel controls, and auto-contrast work unchanged.
- [x] OME-Zarr custom image layers in the Layers tab, next to OME-TIFF. HTTP
      URLs that fail are retried over HTTPS.
- [x] Treat `403` as "missing" for metadata keys only, for buckets that deny
      listing; use consolidated metadata when present (`9c0d221`, 2026-10-13).
- [x] Render index-labelled 8-bit three-channel images as RGB; split chunks over
      512 px into virtual tiles backed by a shared decoded-chunk cache
      (`10e3470`, 2026-11-06).
- [x] Decode chunks in the Zarr decode worker pool, with a main-thread fallback
      (`92defed`, 2026-11-06).

Known gaps:

- [ ] Only `t = 0` and `z = 0` are shown.
- [ ] No IndexedDB caching of OME-Zarr chunks.
- [ ] No E2E coverage.
