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
- 2026-06-24: Finished item 1 for abortable latest-request workflows by moving
  diagnostics, transcript capability/viewport loads, selected-cell details,
  cell transcript distributions, ROI cells/genes, ROI transcript export,
  dataset load/warmup, and Visium HD expression profile loading onto the shared
  latest-request helpers. Non-abortable sequencing guards, parallel tile fetches,
  and pure cleanup aborts were left outside the runner pattern by design.
- 2026-06-24: Continued item 2 by grouping `useTranscriptWorkflow`,
  `useCellDetailWorkflow`, and `useRoiWorkflow` options into callbacks, controls
  or data, loaders, refs, and setters. The App call sites now expose the same
  concern boundaries already used by `useDatasetLifecycle` and
  `useViewportDataWorkflow`.
- 2026-06-25: Continued item 3 by extracting selected Visium HD expression
  profile orchestration from `App.tsx` into
  `useVisiumHdExpressionProfileWorkflow`. The hook now owns selected bin/cell
  profile loading, auto-loading selected bins, cancellation, stale completion
  guards, and unavailable/error transitions behind grouped callback, control,
  data, loader, ref, and setter options. Added focused hook coverage for auto
  bin loading, segmented-cell mapped-bin loading, and stale request completion.
- 2026-06-25: Continued item 3 by extracting Visium HD ROI orchestration into
  `useVisiumHdRoiWorkflow`. The hook now owns Visium HD ROI completion, shared
  ROI replay, active ROI clearing, and barcode export while `App.tsx` keeps only
  cross-domain cleanup wiring. Added focused hook coverage for ROI completion,
  shared ROI replay, barcode export, and Visium/non-Visium clear behavior.
- 2026-06-25: Finished item 3 by extracting Visium HD Magic Lens summary
  orchestration into `useVisiumHdMagicLensSummary`. The helper now owns ROI/bin
  selection, cursor circle filtering, expression-profile matrix reads, selected
  gene expression loading, and viewport batch reuse. `App.tsx` now keeps Visium
  HD wiring and platform gates while focused hooks/helpers own the data
  orchestration for bins, selected profiles, ROI, and Magic Lens summaries.
  Added focused coverage for profile-matrix summaries, viewport expression reuse,
  and selected-gene loader fallback.
- 2026-06-26: Continued item 2 by grouping options for
  `useVisiumHdBinWorkflow`, `useGridCellAssignmentWorkflow`,
  `useMorphologyWorkflow`, `useCustomMorphologyLayerWorkflow`, and
  `useAnalysisEmbeddingWorkflow` into callbacks, controls, data, loaders, refs,
  and setters where applicable. Continued the same pass for
  `useMagicLensWorkflow` and `useAnnotationWorkflow`.
  These Visium HD, morphology, and embedding workflows now match the grouped
  option shape used by the other app-shell workflows while preserving the
  existing bin switching, morphology reuse, barcode assignment, auto-contrast,
  custom image layer, embedding selection, Magic Lens, and annotation behavior.
- 2026-06-26: Finished item 2 by grouping the remaining workflow option bags
  for diagnostics, Visium HD expression projection, viewer-layer derivation,
  viewport data loads, shareable URL hashing, gene/transcript control handlers,
  and expression-layer telemetry. These hooks now expose callbacks, controls,
  data, loaders, refs, setters, and specialized payload groups where applicable,
  preserving behavior while making the app-shell wiring easier to scan.
- 2026-06-26: Started item 4 by adding explicit transition helpers for core
  dataset load/warmup states, transcript capability/layer states, ROI cell/gene
  and transcript-export states, selected-cell detail/transcript distribution
  states, and Visium HD selected expression-profile states. The corresponding
  workflows now call named transitions instead of assembling complex async
  state payloads inline, with focused model tests covering the constructors.
- 2026-06-26: Continued item 4 by extending named transition constructors to
  morphology load, gene panel, and Visium HD bin-control states. Dataset load
  and Visium HD bin-switch orchestration now share those helpers for loading,
  ready, idle, and error transitions while preserving the existing option-count
  behavior during tier switches.
- 2026-06-26: Continued item 4 for diagnostics and boundary viewport states.
  Dataset diagnostics runs and boundary polygon viewport loads now use shared
  loading, ready, idle, and error constructors from `datasetLoadModel`, including
  dataset-load reset paths. Focused workflow coverage continues to exercise
  success, failure, stale-request, and deferred-boundary behavior.
- 2026-06-26: Finished item 4 for the remaining runtime async states by adding
  named transition helpers for analysis embeddings, annotation loads and group
  discovery, custom morphology layers, grid-cell assignment, Magic Lens, gene
  expression, cell-feature matrix capability checks, Visium HD expression
  projection, Visium HD ROI completion, morphology auto-contrast failures, and
  dataset reset paths. Runtime workflows no longer assemble async state payloads
  inline, and focused model tests cover the new constructors.
- 2026-06-26: Finished item 5 by introducing an app-shell platform adapter for
  Xenium-like versus Visium HD behavior. The adapter now centralizes feature
  gates, platform labels, transcript visibility, boundary/nucleus overlay
  policy, Magic Lens availability, ROI draw readiness, active ROI/embedding
  selection, selected expression-profile routing, ROI completion routing, and
  platform-aware boundary, nucleus, gene-expression, and analysis-loading
  helpers. `App.tsx` consumes those platform policies while leaving the existing
  data/workflow hooks intact.
- 2026-06-26: Continued item 4 by splitting `ViewerCore` interaction concerns
  and `deckLayers` renderer concerns. Viewer types, navigation, ROI drawing,
  measurement overlays, Magic Lens overlays, hover/picking helpers, and viewport
  status messages now live behind focused viewer modules while `ViewerCore`
  remains the surface wiring component. `deckLayers.ts` is now a compatibility
  facade and `createOverviewLayers` assembly point, with cell points,
  boundaries, grid cells, transcripts, gene-expression styling, palette helpers,
  and view fitting moved into renderer modules.
- 2026-06-27: Continued item 14 by hardening Visium HD capability loading.
  `VisiumHdDataset` now keeps overview, barcode, barcode-mapping, segmentation,
  H5 matrix, and Feature Slice readers behind statically analyzable dynamic
  imports, while the segmentation metadata/filtering helpers live in a small
  platform model module. Production build output now keeps these capability
  paths as lazy chunks instead of pulling them through the Visium HD facade.
- 2026-06-27: Continued item 14 for Xenium by moving selection SQL helpers into
  a lightweight GEX selection module and keeping Xenium DuckDB, matrix,
  transcript, annotation, overview, morphology, and TIFF default readers behind
  statically analyzable dynamic imports. Constructor-injected readers remain
  eager-free for tests while production capability paths load only when used.
- 2026-06-27: Re-audited open recommendations against the source tree and
  closed items 1, 7, 8, 11, 12, 13, and 14. Domain state now enters `App.tsx`
  through `useAppDomainState`; viewer interaction and renderer concerns have
  focused modules while `ViewerCore` and `deckLayers.ts` remain wiring/facade
  surfaces; CSS is split under `src/styles`; app tests have a shared dependency
  and Visium HD fixture harness; app dependency injection is a single grouped
  object; and heavy Xenium/Visium HD readers use explicit lazy imports. Items 9
  and 10 remain open: dataset facades still contain substantial query
  orchestration, and platform-neutral naming is only partially migrated.
- 2026-06-27: Finished item 9 by extracting dataset reader orchestration out of
  the platform facades. `XeniumDataset` now delegates DuckDB boundary, cell,
  transcript, extent, matrix-row, metadata, and gene-expression queries to
  `xeniumDatasetReaders.ts`. `VisiumHdDataset` now delegates overview caching,
  barcode and mapping readers, segmentation selection, image construction,
  matrix reads, and gene-expression scoring to `VisiumHdDatasetReaderController`
  in `visiumHdDatasetReaders.ts`. The existing public dataset method and type
  surface remains in the facade files.

## Recommendations

1. **Closed - Create domain state bundles for `App.tsx`.**
   `App.tsx` should remain the orchestration root, but related state can be
   grouped by domain: dataset, viewport/layers, genes, ROI, transcripts,
   Visium HD, and selection. Prefer focused bundles over a generic `useAppState`.
   Closed 2026-06-27: `useAppDomainState` owns the domain state groups and
   `App.tsx` consumes those bundles.

2. **Closed - Replace huge hook option bags with grouped objects.**
   Hooks such as `useDatasetLifecycle` receive many loosely related refs,
   setters, loaders, and callbacks. Grouping those as `requests`, `setters`,
   `loaders`, and `initialState` makes call sites easier to scan and future
   changes less fragile.
   Closed 2026-06-26: the remaining workflow option bags now use grouped
   callbacks, controls, data, loaders, refs, requests, and setters.

3. **Closed - Introduce a shared latest-request runner.**
   Many workflows repeat the same cancellation shape: abort the previous
   request, increment a request id, create an `AbortController`, ignore stale
   completions, and clear the abort ref. A reusable helper should own this
   lifecycle.
   Closed 2026-06-24: abortable latest-request workflows use the shared
   request helpers; non-abortable sequencing and cleanup-only aborts remain
   outside the pattern intentionally.

4. **Closed - Use explicit transition helpers for complex async states.**
   Dataset loading, transcript overlays, ROI gene stats, Visium HD tier
   switching, and selected cell/bin detail all have multi-step states. Focused
   transition helpers or reducers would make invalid combinations harder to
   produce and easier to test.
   Closed 2026-06-26: runtime async workflows now call named transition
   constructors and focused model tests cover those constructors.

5. **Closed - Extract a platform adapter layer.**
   Xenium and Visium HD platform branching is spread through app orchestration.
   A platform adapter can centralize supported capabilities, labels, loaders,
   disabled states, and platform-specific actions.
   Closed 2026-06-26: `platformAdapter.ts` centralizes Xenium-like and Visium
   HD feature gates, labels, visibility policy, and routing helpers.

6. **Closed - Move Visium HD orchestration into a controller/helper module.**
   Bin switching, segmentation gating, mapping assignments, Magic Lens bin
   summaries, and selected-bin profile loading should live behind a focused
   Visium HD app boundary rather than directly in `App.tsx`.
   Closed 2026-06-25: focused Visium HD workflows/helpers now own expression
   profile, ROI, Magic Lens summary, bin-control, and app-controller
   orchestration.

7. **Closed - Split `ViewerCore` by interaction concern.**
   `ViewerCore` combines viewport navigation, deck rendering, picking, ROI
   drawing, measurement, hover tooltips, keyboard handling, and overlays.
   Extracting targeted models/hooks reduces the cost of changing one interaction
   without regressing another.
   Closed 2026-06-27: viewer types, navigation, ROI interaction, measurement,
   Magic Lens overlays, hover tooltips, picking, and status messages now live in
   focused viewer modules while `ViewerCore` remains the surface wiring
   component.

8. **Closed - Split `deckLayers.ts` into renderer modules.**
   Cell points, binary boundaries, grid cells, transcripts, expression styling,
   and color scales can move into smaller renderer files while
   `createOverviewLayers` remains the assembly point.
   Closed 2026-06-27: cell points, boundaries, grid cells, transcripts,
   expression styling, colors, opacity, and view fitting live in renderer/model
   modules while `deckLayers.ts` remains the compatibility facade and assembly
   point.

9. **Closed - Decompose dataset implementation files into reader modules.**
   Keep `XeniumDataset` and `VisiumHdDataset` as capability facades, but move
   lower-level readers and parsers into platform-specific modules.
   Closed 2026-06-27: Xenium DuckDB/query readers now live in
   `xeniumDatasetReaders.ts`, and Visium HD overview, barcode, segmentation,
   image, matrix, and expression reader orchestration lives in
   `visiumHdDatasetReaders.ts`.

10. **Open - Rename platform-neutral cell concepts.**
    Generic expression/result contracts should prefer `element`, `target`, or
    `spatialElement` terminology where values may be Visium HD bins rather than
    Xenium cells.
    Partially complete: element-oriented aliases and `SpatialElement` contracts
    exist, but renderer/app contracts still expose cell-centric names for some
    Visium HD bin paths.

11. **Closed - Split global CSS by surface.**
    `index.css` can be divided into tokens, app shell, viewer, HUD, forms, and
    feature-specific files to reduce accidental style coupling.
    Closed 2026-06-27: `src/index.css` is now an import list for surface-specific
    files under `src/styles`.

12. **Closed - Create reusable test harnesses.**
    Large app tests would be easier to extend with shared dependency builders
    and platform scenario fixtures.
    Closed 2026-06-27: `src/test/appTestHarness.ts` provides the app dependency
    builder, viewport helpers, deferred promises, and Visium HD detection/meta
    fixtures used by `App.test.tsx`.

13. **Closed - Group app dependency injection.**
    Instead of destructuring many dependency props at the `App` boundary, accept
    a single dependency object with targeted test overrides.
    Closed 2026-06-27: `App` accepts one `dependencies` object, resolved through
    grouped app dependency defaults and partial grouped overrides.

14. **Closed - Keep heavy platform capabilities lazily loaded.**
    The Vite chunk groups are already a good start. Platform adapters can make
    it clearer which heavy readers are Xenium-only or Visium-only.
    Closed 2026-06-27: heavy Xenium and Visium HD capability readers are behind
    explicit, statically analyzable dynamic imports, with constructor-injected
    reader seams preserved for tests.
