# Phase 5 — Production Polish

- [x] Shareable state in the URL hash: dataset URL, active tab, viewport,
      selected genes, ROI, gene scale/score/detail, cell colour mode, coordinate
      unit, morphology toggle, and boundary limit. Shared genes and ROI survive
      the first matching dataset load. (Phase 5.1 added transcript fields.)
- [x] Adaptive performance budget: compact, balanced, or expanded profiles that
      set overview point caps, default boundary limits, tile request
      concurrency, tile-cache size, and telemetry retention.
- [x] Accessibility and keyboard navigation: focusable view, arrow-key pan,
      Shift for coarse pan, `+`/`-` zoom, `Home` reset, `aria-keyshortcuts`, and
      a visible focus outline.
- [x] React error boundary, dataset diagnostics (manifest plus required and
      optional byte-range assets), and a downloadable JSON dump (controls,
      errors, telemetry, diagnostics, budget).
- [x] **Reopened (2026-11-08), fixed 2026-11-12:** Xenium diagnostics checked
      a hard-coded `morphology.ome.tif` instead of the manifest's image, and
      skipped `analysis.zarr.zip`, `gene_panel.json`, the H5 matrix, and
      embedding CSVs. They now check the image the viewer picks (the
      manifest's, else each `experiment.xenium` path in order, with a warning
      naming any passed over), range-check `analysis.zarr.zip` and
      `cell_feature_matrix.h5`, and check `gene_panel.json` and the UMAP and
      t-SNE projections (a manifest's `umap`/`tsne` entries replace the
      standard paths). All of these are optional and warn when absent. The
      dump was always named `xenium-diagnostics.json`; since 2026-11-12 it is
      `<platform>-diagnostics.json`.
- [x] Privacy-respecting local telemetry (loads, diagnostics, tile-cache
      evictions), kept in memory and exported only through the dump.
- [x] Docs: `docs/user-guide.md`, `docs/host-your-own-data.md`, and the root
      `README.md`.
- [x] Magic Lens, ported from the POC: cursor, viewport, and ROI scopes; radius
      and QV controls; debounced scans; an in-view HUD.
- [ ] **Reopened (2026-11-08):** the lens `Min QV` is part of the query key but
      is not passed to the readers, so it does not change results. (Since the
      feature-fix pass, lens totals come from cell `transcript_counts`, which
      have no QV.)

## Closed Open Items

Moved from [Open Items](../open-items.md) when the plan was split (2026-11-13).

Reopened by the 2026-11-08 review (marked done before, found incomplete):

- [x] Magic Lens: make `Min QV` change results, or hide it. The new shell
      hid it (15.2-D); 15.5-C removed it.
- [x] Xenium diagnostics: check the image chosen from `experiment.xenium`
      instead of `morphology.ome.tif` (a dataset manifest's image is already
      checked), plus `analysis.zarr.zip`, `gene_panel.json`, the H5 matrix, and
      embedding CSVs (2026-11-12; see [Phase 5](#phase-5--production-polish)).

Other gaps found in the review:

- [x] The diagnostics dump is named `xenium-diagnostics.json` on every platform.
      Now `<platform>-diagnostics.json`, after the loaded dataset, else the
      platform diagnostics found, else `dataset` (2026-11-12).
