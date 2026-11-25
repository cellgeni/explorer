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
- [x] bioformats2raw stores (BioImage Archive): open the first series listed
      in `OME/.zattrs`, or `0`, and start on `omero.rdefs.defaultZ` and
      `defaultT` (`e6b8e66`, 2026-11-14, #96). S-BIAD493's plane 0 is nearly
      empty; its `defaultZ` is the middle of 41.
- [x] The `Z plane` control for OME-Zarr z-stacks, starting on `defaultZ` or
      else the middle plane (`4144364`, 2026-11-14, #97).
- [x] A z-stack without a channel axis (`z, y, x`, such as the OME-NGFF 0.5
      SciVis `engine.ome.zarr`) is one grayscale channel, so it gets the
      `Z plane` control too (2026-11-18).
- [x] A 3D view of OME-Zarr z-stacks: `View` › `3D` reads the enabled
      channels at the finest level within 64 Mi voxels and 2,048 per side, and
      ray-marches them in a deck.gl `OrbitView` with `Max intensity` and
      `Translucent` modes and a `Depth` stretch (2026-11-18).
- [x] An image group inside a `.zarr` store, such as `sample.zarr/images/he`
      or a bioformats2raw series `image.zarr/0`, is read as OME-Zarr: a path
      below a `.zarr` folder whose last part has no dot (#114, 2026-11-15).
      The group is read on its own, without a SpatialData store's
      transformations.

Known gaps:

- [x] Only `t = 0` and `z = 0` are shown. Since 2026-11-14 z planes have
      the `Z plane` control.
- [ ] Only one `t` is shown: `omero.rdefs.defaultT`, else 0. Planned in
      [Phase 28](28-time-points.md) (2026-11-25).
- [ ] The 3D view: OME-TIFF z-stacks and custom layers, cells and transcripts
      in 3D, the GPU's real 3D texture limit, and keeping the view in the
      share link.
- [ ] Custom image layers (OME-TIFF and OME-Zarr) have no `Z plane`
      control.
- [ ] No IndexedDB caching of OME-Zarr chunks.
- [ ] One smoke test opens an OME-Zarr z-stack, to check that the 3D volume
      view gives back its WebGL context (#203); the nightly examples test
      loads one OME-Zarr image.
