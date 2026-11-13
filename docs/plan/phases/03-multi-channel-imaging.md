# Phase 3 — Imaging: Multi-Channel

- [x] Parse the multi-file `morphology_focus_000N.ome.tif` channel set from
      OME-XML, with per-channel name, colour, and contrast.
- [x] Multi-channel compositing with per-channel colour, min/max, and on/off
      (Canvas2D; see [4.4](../decisions.md#44-image-layer--decision-custom-jpeg-2000-path-canvas2d-compositing)).
- [x] **Dropped** by the user: JPEG XR decoder (WASM).
- [x] Z-stack plane selector for OME-TIFF z-stacks such as `morphology.ome.tif`
      (`Layers` → `Z plane`, share link `z`; deferred, then done 2026-11-09).
- [x] Per-channel histogram and auto-contrast.

Notes:

- Channel metadata: ID, index, name, focus-file name, purpose, RGB colour, and a
  default contrast range from the OME pixel type.
- Auto-contrast samples the coarsest pyramid level, crops padded edge tiles,
  computes robust percentiles, and draws a histogram from the same samples. It
  runs automatically when an image finishes loading; the `Auto` buttons rerun it.
  Since 2026-11-13 tiles are decoded and sampled in workers.
- Grayscale intensity drives both channel colour and alpha, so enabled channels
  do not fill tiles with solid colour.

Definition of done: DAPI, boundary, and interior stains composited with
independent controls.
