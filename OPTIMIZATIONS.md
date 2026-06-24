# Structural Optimization Recommendations

This file records maintainability-focused refactor opportunities for the
viewer. The intent is to preserve product behavior while reducing coupling in
the app shell, platform workflows, and rendering modules.

## Recommended Sequence

1. Add a shared latest-request runner.
2. Group large hook option objects around coherent concerns.
3. Extract Visium HD app orchestration into a focused controller/helper module.
4. Start behavior-preserving decomposition of `ViewerCore` and `deckLayers`.

## Progress Notes

- 2026-06-24: Expanded shared latest-request runner usage to the Visium HD
  bin-assignment and expression-to-segmented-cell projection workflows. The next
  optimization pass can continue migrating remaining manual request lifecycles,
  then move on to grouped hook option objects.
- 2026-06-24: Started item 2 by grouping `useDatasetLifecycle` options into
  callbacks, controls, initial state, loaders, refs, and setters. Continue this
  pattern with ROI and transcript workflows before broad viewer decomposition.
- 2026-06-24: Continued item 1 by migrating Magic Lens scans and custom
  morphology layer loads to the shared latest-request runner. Magic Lens now
  invalidates in-flight viewport/ROI scans when returning to cursor scope, and
  custom image layer loads ignore stale completions after a newer layer request
  starts. Focused stale-request tests were added for both paths.

## Recommendations

1. **Create domain state bundles for `App.tsx`.**
   `App.tsx` should remain the orchestration root, but related state can be
   grouped by domain: dataset, viewport/layers, genes, ROI, transcripts,
   Visium HD, and selection. Prefer focused bundles over a generic `useAppState`.

2. **Replace huge hook option bags with grouped objects.**
   Hooks such as `useDatasetLifecycle` receive many loosely related refs,
   setters, loaders, and callbacks. Grouping those as `requests`, `setters`,
   `loaders`, and `initialState` makes call sites easier to scan and future
   changes less fragile.

3. **Introduce a shared latest-request runner.**
   Many workflows repeat the same cancellation shape: abort the previous
   request, increment a request id, create an `AbortController`, ignore stale
   completions, and clear the abort ref. A reusable helper should own this
   lifecycle.

4. **Use explicit transition helpers for complex async states.**
   Dataset loading, transcript overlays, ROI gene stats, Visium HD tier
   switching, and selected cell/bin detail all have multi-step states. Focused
   transition helpers or reducers would make invalid combinations harder to
   produce and easier to test.

5. **Extract a platform adapter layer.**
   Xenium and Visium HD platform branching is spread through app orchestration.
   A platform adapter can centralize supported capabilities, labels, loaders,
   disabled states, and platform-specific actions.

6. **Move Visium HD orchestration into a controller/helper module.**
   Bin switching, segmentation gating, mapping assignments, Magic Lens bin
   summaries, and selected-bin profile loading should live behind a focused
   Visium HD app boundary rather than directly in `App.tsx`.

7. **Split `ViewerCore` by interaction concern.**
   `ViewerCore` combines viewport navigation, deck rendering, picking, ROI
   drawing, measurement, hover tooltips, keyboard handling, and overlays.
   Extracting targeted models/hooks reduces the cost of changing one interaction
   without regressing another.

8. **Split `deckLayers.ts` into renderer modules.**
   Cell points, binary boundaries, grid cells, transcripts, expression styling,
   and color scales can move into smaller renderer files while
   `createOverviewLayers` remains the assembly point.

9. **Decompose dataset implementation files into reader modules.**
   Keep `XeniumDataset` and `VisiumHdDataset` as capability facades, but move
   lower-level readers and parsers into platform-specific modules.

10. **Rename platform-neutral cell concepts.**
    Generic expression/result contracts should prefer `element`, `target`, or
    `spatialElement` terminology where values may be Visium HD bins rather than
    Xenium cells.

11. **Split global CSS by surface.**
    `index.css` can be divided into tokens, app shell, viewer, HUD, forms, and
    feature-specific files to reduce accidental style coupling.

12. **Create reusable test harnesses.**
    Large app tests would be easier to extend with shared dependency builders
    and platform scenario fixtures.

13. **Group app dependency injection.**
    Instead of destructuring many dependency props at the `App` boundary, accept
    a single dependency object with targeted test overrides.

14. **Keep heavy platform capabilities lazily loaded.**
    The Vite chunk groups are already a good start. Platform adapters can make
    it clearer which heavy readers are Xenium-only or Visium-only.
