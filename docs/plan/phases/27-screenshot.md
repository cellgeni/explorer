# Phase 27 — Screenshot

Planned 2026-11-24. Requested: a high-resolution image of the spatial view
for paper figures. The canvas has no export today. The only image the app
saves is a plot's `Export PNG` ([Phase 22](22-plots-panel.md), plan
22-D10).

The scope is a `Screenshot` button in the top bar. It saves the main 2D
view as a PNG at 1×, 2×, 4× or 8× its size on screen. The PNG is drawn
again off screen rather than copied from the page:

- the image at the pyramid level the larger size needs;
- the deck.gl layers at that pixel density;
- the scale bar, legend, axes and selections drawn from their models.

The live view does not change while it runs.

The decisions below were proposed on 2026-11-24. The user answered the
plan's four questions the same day
([Answered Questions](#answered-questions)); D3, D5, the failure rule and
Later carry the answers.

The plan rests on a code map made on 2026-11-24 at `24f0fd2`. It is cited
below as `file:line`; line numbers drift as the code changes.

Sizes are for one developer: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

## Why A Browser Screenshot Is Not Enough

Until this phase, the advice for a figure was a browser screenshot at a
higher device pixel ratio (DevTools device mode, or Playwright's
`deviceScaleFactor` on a `Share` link). That falls short in five ways:

- **The image does not gain detail.** The pyramid level is chosen per CSS
  pixel, not per device pixel (`MorphologyCanvas.tsx:455`). Both loaders
  take the coarsest level whose pixel is at most 1.5 CSS px on screen
  (`tiff/loader.ts:2155-2169`; `omeZarrLoader.ts:54`, `:480-491`). At 4×
  the image is upsampled. Cells, outlines and text do get sharper.
- **A larger window trades one problem for another.** It reads a finer
  level, but points, outline widths and text are sized in CSS pixels, so
  they shrink against the figure.
- **The legend is outside the frame.** It sits in the notification stack
  with the loading list (`ViewerCore.tsx:2489-2500`). A capture of the
  frame leaves it out, and a capture of the page takes the panels too.
- **The canvas thins cells.** Cell points are sampled down to the render
  cap: 250,000 on the expanded budget, 150,000 balanced, 75,000 compact
  (`performanceBudget.ts:18-41`; `ViewerCore.tsx:929-951`). AnnData has no
  cap (`App.tsx:1423-1425`). On the expanded budget, the 1.4M-cell Xenium
  demo zoomed out shows about one cell in six.
- **deck.gl's canvas cannot be read afterwards.** It does not keep its
  drawing buffer, so `toDataURL` on it is blank.

## Goals And Non-Goals

Goals:

- A `Screenshot` button beside `Share` that opens a popover: scale, what
  to include, background, and `Save PNG`.
- The PNG is the canvas's frame at a whole-number scale of its CSS size,
  looking as the screen does: the same view, colours, and point sizes and
  line widths relative to the frame.
- The image read at the level the PNG's pixel size needs.
- Every loaded cell drawn, not the render cap's sample (D5).
- The scale bar, legend, axes and saved selections drawn sharp at the
  PNG's scale.
- An estimate of the image read before it starts, a question before a
  large one, then progress and `Cancel`. The live view keeps working.
- The PNG records its dpi and, in text chunks, the dataset, the view and
  µm per pixel.
- The axe baseline stays empty and `nativeTitleAudit` passes.

Non-goals:

- Vector output (SVG, PDF) of the map. A million cell outlines is not a
  file anyone can edit. See [Later](#later).
- Collection sections side by side (`LinkedSections.tsx:268`), the
  section stack (`SectionStackViewer.tsx:276`) and the 3D views
  (`VolumeViewer.tsx:138`). Each has its own deck.gl canvas. The
  screenshot is of the main 2D view.
- Loading more than the view holds. The screenshot draws the cells,
  expression and transcripts the canvas has loaded. It does not switch
  expression to `All cells` or transcripts to `Exact`; it says when the
  view is a sample (D7).
- A frame other than the canvas's. The PNG has the canvas's aspect; the
  window or the panels change it. A crop frame is [Later](#later).
- Hover tooltips, the keyboard crosshair, the coordinate and zoom
  readouts, tool hints, a selection or measurement still being drawn, the
  minimap and the zoom buttons.
- Keeping the popover's choices in the link.

## Current State

What the work can build on:

- **The frame's layers** (`ViewerCore.tsx:2271-2446`), bottom to top:
  - `MorphologyCanvas`, a 2D canvas (`:2298-2310`). Its backing store is
    the frame's CSS size times `devicePixelRatio`
    (`MorphologyCanvas.tsx:555-571`). The image layer's opacity is CSS
    opacity on the element (`:306`).
  - deck.gl in `.deckgl-host` (`ViewerCore.tsx:2311-2328`): `MemoDeckGL`
    with `Deck={ReleasingDeck}`, `spatialOverviewView` (an
    `OrthographicView` with `flipY: false`, `deckLayers.ts:106-109`) and
    `layers`.
  - Saved and active selections as SVG paths in `.roi-draw-layer`
    (`ViewerCore.tsx:2329-2373`), the measurement overlay,
    `ViewerSelectionOverlay` (`:2386-2388`), the Magic Lens and the
    tooltips.
  - `ViewerAxes` and `ScaleBar` (`:2444-2445`), from `viewerAxesModel`
    and `scaleBarModel` (`:1461-1505`; `ScaleBarModel`,
    `viewerMeasurements.ts:25-28`; `AxesModel`, `viewerAxesModel.ts:31`).
  - Outside the frame: the minimap and the zoom buttons (`:2447-2483`),
    and the legend (`ViewerLegendSection`, `viewerLegendTypes.ts:40`) with
    the loading list (`:2489-2500`).
- **Drawing the image is already pure.**
  - `drawMorphologyTileChannels(context, batches, viewState, viewport)`
    and `drawFlatImage` (`morphologyCanvas.ts:66-121`) draw into any 2D
    context, for any view state and CSS viewport.
  - Channels are added (`lighter`), except a single RGB channel, which is
    drawn over (`:73-93`). So tiles can be drawn in any order.
  - The level is `loader.bestLevel(2 ** zoom)` (`MorphologyCanvas.tsx:455`).
    Each channel has a `MorphologyTileStore` cache and scheduler. While a
    level loads, ready tiles of another level stand in (`:350-384`).
  - The flat Visium image loads with `crossOrigin = 'anonymous'`
    (`morphologyTileStore.ts:157-158`). TIFF and Zarr tiles are
    `ImageBitmap`s decoded from fetched bytes. A canvas drawn from either
    can be read back.
  - `persist: false` on a tile fetch reads the IndexedDB byte-range cache
    without adding to it (`imagePyramid.ts:103-108`, plan 26-D8).
- **The deck.gl layers** come from
  `createOverviewLayers(cells, boundaries, options)` (`deckLayers.ts:166`),
  called with ViewerCore's inputs (`ViewerCore.tsx:1147-1173`).
  - Point sizes depend on the zoom against the fitted zoom and on the full
    view's point count (`pointSizeZoomDelta`, `pointSizeCellCount`).
  - Outline widths are in pixels (`lineWidthUnits: 'pixels'`). Cell discs
    are in µm (`radiusUnits: 'common'`) or pixels.
  - No layer fetches its own data: there is no `TileLayer`.
- **The render cap.** `cellPointSampleFraction` thins cell points to
  `overviewRenderCellLimit` (`ViewerCore.tsx:929-951`). While the view
  moves, a smaller limit applies until it has been still for 200 ms
  (`:238`).
- **Expression samples.** `GeneExpressionLoadMode` is `exact`, `sampled`,
  `overview-sampled`, `exact-region` or `all-cells`
  (`geneExpressionLod.ts:26-31`). Above 500,000 cells, `Auto LOD` reads a
  sample when zoomed out, keeping every expressing cell (`helpText.ts:6`).
- **WebGL contexts.** `ReleasingDeck` (`releasingDeck.ts`) loses a Deck's
  context once its canvas leaves the page. Chromium keeps 16 live contexts
  per page and drops the oldest past that.
- **Lost contexts** (`useDeckDeviceLoss.ts`,
  [PR #420](https://github.com/cellgeni/explorer/pull/420)). After a lost
  context the main view draws again on a new canvas, up to 3 times, then
  says to reload (`:13`). Only a canvas in the page counts (`:27-35`), so
  an off-screen canvas losing its context does not.
  - The new deck gets `cloneLayers(layers)` (`:49-53`;
    `ViewerCore.tsx:1207-1210`): deck.gl refuses layer instances a
    finalized deck has used, so a second deck needs clones.
- **Requests into the viewer are props**: `focusRequest` and
  `fitRequestKey` (`ViewerCore.tsx:542-548`; `App.tsx:4998`,
  `:5415-5420`). The app has no imperative handles.
- **Image export elsewhere.**
  - `plotFileName` names files `{dataset}-…` (`plotExport.ts:132-145`).
  - `svgPngBlob` draws an SVG on a canvas at a scale and writes a PNG
    (`:172-205`). Its SVG holds no external images or fonts, so the canvas
    can be read.
  - `documentPlotPaint` reads the theme's tokens (`:18-31`).
  - `downloadBlob` saves a file (`appRuntimeModel.ts:499-507`).
  - ROI exports record `dataset_url` without a presigned URL's signature
    (`urlWithoutCredentials`, `urlCredentials.ts:13`;
    `useRoiWorkflow.ts:797-802`), and `exported_at`.
- **The top bar's right end** (`TopBar.tsx:176-200`): the panel toggles,
  `ShareButton` (`:539-575`, an icon alone on narrow screens), the Help
  menu, and Settings, whose switches include the legend, the scale bar and
  the axes.
- **One theme, dark.** The canvas is `--canvas: #000` (`tokens.css:4-17`;
  `viewer.css:138-144`). The scale bar and the legend sit on
  `--surface-1` boxes with `--text-1` text.
- **Loads in progress** reach ViewerCore as `loadingTasks`
  (`ViewerCore.tsx:520`). A `LoadingTaskSummary` can carry progress and a
  cancel (`AppStatusPanels.tsx:36-43`).

What is missing:

- A way to draw the view into a canvas the app can read.
- A level choice for a pixel density other than the screen's.
- The legend, scale bar, axes and selections drawn outside the DOM.
- PNG chunks: `pHYs` for the dpi, `tEXt` for the metadata.

## Product Decisions

Proposed 2026-11-24. D3, D5 and the failure rule in
[How A Screenshot Runs](#how-a-screenshot-runs) are settled by the user's
answers the same day; the others stand as proposed.

- **D1. `Screenshot` in the top bar**, between the panel toggles and
  `Share`, with a camera icon. Under 860 px it is an icon alone, as
  `Share` is. It opens a popover. It is disabled until the view has drawn
  a dataset.
- **D2. The canvas's frame, as on screen.**
  - The PNG covers what the frame shows when `Save PNG` is pressed: the
    same target, zoom and CSS size, including any part of the map under a
    drawer or a card.
  - Everything sized in CSS pixels on screen (points, outlines, text, the
    scale bar) is N times larger in the PNG. The figure looks like the
    screen, only sharper.
- **D3. Scale 1×, 2×, 4× or 8×**, 2× to start.
  - Whole numbers keep tile edges on whole pixels (D9).
  - The popover gives the size and what it means in print, e.g.
    "3,000 × 1,800 px · 0.85 µm per pixel · 254 × 152 mm at 300 dpi".
  - A `DPI` field, 300 to start, sets only the PNG's `pHYs` and the mm
    figure.
  - A scale over the size limit (D10) is disabled, and says why.
- **D4. The image at the screenshot's density.**
  - Each channel's level is `bestLevel(2 ** zoom × N)`: a 4× screenshot
    reads the level a window 4 times larger would.
  - The popover gives the number of tiles it will read, and their size
    where the tile index knows it (TIFF). Above 512 MiB it asks first, as
    Cell Query does (26-D7).
  - Tiles of another level never stand in. The screenshot waits for its
    own.
  - Reads use `persist: false`, so they do not evict what the canvas and
    the readers keep in the byte-range cache.
- **D5. Every loaded cell.** The screenshot draws without the render cap's
  sample: zoomed out, the Xenium demo shows all 1.4 million cells, not
  about 250,000. Points keep the screen's size. It is one frame, drawn
  once, so the cap's reason (frame rate while moving) does not apply.
  The popover says so when the screen is a sample: "Draws all 1,414,155
  cells; the screen shows 250,000."
- **D6. Include**: `Scale bar`, `Legend`, `Axes` and `Selections`.
  - The first three start from Settings (`Show scale bar`, `Show legend`,
    `Show axes`). `Selections`, the saved and active selection outlines,
    starts on.
  - Geometric annotations are deck.gl layers, so they come with the
    cells.
  - The legend sits top right, as on screen, and lists what the screen
    lists, including classes shown with `Show more`.
- **D7. Notes on what the view holds.** Each says what would change it.
  `Save PNG` stays enabled: the notes inform, they do not block.
  - Expression is `sampled` or `overview-sampled`: "Expression is a
    sample at this zoom. Set Expression detail to All cells to colour
    every cell."
  - Transcripts are shown as density squares: "Transcripts are density
    squares at this zoom. Set Detail to Exact, or zoom in, for points."
  - Loads are in progress: "Still loading: {labels}. The screenshot shows
    what has loaded."
- **D8. Background**: `Canvas` (black, as the screen), `White` or
  `Transparent`. The scale bar and the legend keep their boxes: dark with
  light text on `Canvas` and `Transparent`, white with dark text on
  `White`.
- **D9. Drawn off screen, in tiles.** The live canvas is never resized or
  read. The PNG is drawn tile by tile, each tile at most 4,096 device
  pixels a side and a whole number of CSS pixels, because WebGL silently
  shrinks a drawing buffer past its limit. See
  [How A Screenshot Runs](#how-a-screenshot-runs).
- **D10. A size limit**: at most 16,384 px on the longer side and 128
  megapixels. Chromium allows 2D canvases of 16,384 px a side and about
  268 megapixels, but encoding holds the RGBA pixels (512 MiB at 128
  megapixels) beside the canvas. The spike checks both numbers (task A).
- **D11. The file.** `{dataset}-screenshot.png`, with `{dataset}` as in
  plot exports (`plotFileName`).
  - `pHYs` from `DPI`.
  - `tEXt` chunks with the PNG specification's keywords:
    - `Software`: the app's name and version;
    - `Source`: the dataset URL without credentials, as ROI exports
      write it;
    - `Description`: the view in µm (x and y ranges), µm per pixel, the
      scale and, for a z-stack, the plane;
    - `Creation Time`: the time of saving, in UTC (ISO 8601).
- **D12. One at a time, in the loading list.**
  - Progress shows in the popover and as a task in the loading list, with
    `Cancel`, so closing the popover does not stop it.
  - `Save PNG` is disabled while one runs.
  - Changing dataset cancels it.

## How A Screenshot Runs

1. **Snapshot.** At `Save PNG`, ViewerCore takes:
   - the view state, once the view has been still for 200 ms;
   - the frame's CSS size;
   - the `createOverviewLayers` inputs;
   - the image channels, or the flat image, and the layer's opacity;
   - the overlay models: scale bar, axes, legend sections, selections.

   Pans, zooms and loads after that do not change the screenshot.

2. **Plan.** A pure `planScreenshot` gives:
   - the PNG's size and whether it is within the limit (D10);
   - the tile grid (D9);
   - each channel's level, and its tiles under each grid tile (D4);
   - the read estimate and the notes (D7).
3. **Each grid tile**, row by row:
   1. **Image.** Every channel's tiles under the grid tile are fetched
      through the channel's tile store (`persist: false`). They are drawn
      into a scratch 2D canvas as they arrive, with the canvas's rules
      (`morphologyCanvas.ts:66-121`), the context scaled by N and the view
      state's target moved to the grid tile.
   2. **Composite.** The background fill, then the scratch canvas at the
      image layer's opacity (`globalAlpha`).
   3. **deck.gl.** The off-screen Deck renders the grid tile: width and
      height the tile's CSS size, `useDevicePixels: N`, the target at the
      tile's centre. Its canvas is drawn onto the PNG's canvas in the same
      task as `redraw`, before the browser can clear it.

   If the off-screen Deck loses its context, the screenshot fails and says
   so. A tile that fails is read once more. If it fails again, the screenshot
   fails, names the channel and offers `Retry`: a figure with a hole in it
   is worse than none.

4. **Overlays.** One SVG over the whole frame in CSS pixels, from the
   snapshot's models, drawn onto the PNG's canvas at N× through an
   `Image`, as `svgPngBlob` does. It holds no external fonts or images,
   so the canvas stays readable.
5. **Writing.** `toBlob('image/png')`. Then the `pHYs` and `tEXt` chunks
   are inserted after `IHDR` (D11), and `downloadBlob` saves the file.
6. **Clean-up.** The off-screen Deck is finalized and its context lost, as
   `ReleasingDeck` does. The canvases are emptied (width 0). `Cancel`
   aborts the tile fetches and the decode requests.

**The off-screen Deck** has its own canvas, never in the page. Its layers
come from `createOverviewLayers` with the snapshot's inputs and three
overrides: a sample fraction of 1 (D5), nothing pickable, and no hover
highlight. Layers rebuilt by `createOverviewLayers` are new instances;
layers cloned from the live view instead would go through `cloneLayers`,
as a redraw after a lost context does. One Deck draws every grid tile; it
is made once per screenshot.

If a second context holding the cells' buffers is too costly on the
Xenium demo, the alternative is the live Deck drawing each grid tile into
a framebuffer (`_framebuffer`) through a second view, which reuses its
buffers. The spike chooses (task A).

## Tasks

- [ ] **A. Spike.** (M) A throwaway screenshot of the Xenium demo
      (1,414,155 cells, four channels) in a production build in headless
      Chromium on the Mac's GPU. Record in this file:
  - the off-screen Deck: time to the first frame with every cell and with
    the cap's sample; GPU memory; whether it draws in a hidden tab, where
    `requestAnimationFrame` stops;
  - the framebuffer alternative: memory, and whether the live view
    flickers;
  - `drawingBufferWidth` asked for at 4,096, 8,192 and 16,384 px, and
    seams at tile edges where points cross them;
  - `toBlob` time and PNG size at 4,096, 8,192 and 16,384 px;
  - image tiles at 4× for the brain view and for the whole slide: count,
    MB and time;
  - revisit D5, D9 and D10 if a 4× screenshot of the whole slide takes
    over a minute, or the tab grows by more than 2 GB.
- [ ] **B. The plan.** (S) `planScreenshot` in
      `src/features/screenshot/screenshotPlan.ts`: size and limit (D10),
      the tile grid (D9), levels and tiles per channel (D4), the read
      estimate and the notes (D7).
  - fast-check tests: the tiles cover the frame exactly, without overlap,
    on whole device pixels.
  - The level at N× equals the level at 1× for a frame N times larger.
- [ ] **C. The image.** (M) `ScreenshotImageComposer`: fetch, draw and
      composite per grid tile, with progress and abort.
  - Tests with a fake loader and a recording 2D context: levels, flipped
    and swapped placements, an origin offset (MERSCOPE), the flat image,
    a z plane, and a tile that fails twice.
- [ ] **D. The deck.gl tiles.** (M) The off-screen renderer the spike
      chooses.
  - Tests that its layers carry the overrides, and that it loses its
    context when done (count live contexts with a `WeakRef` wrapper on
    `getContext`, as for the 3D overlays).
- [ ] **E. Overlays.** (M) One SVG from the models: the scale bar, the
      legend's continuous and category sections, the axes and the
      selections, in the colours D8 gives each background. Tests on the
      SVG.
- [ ] **F. The PNG file.** (S) Insert `pHYs` and `tEXt` chunks with their
      CRC-32 (D11); the file name. Tests read the chunks back.
- [ ] **G. ViewerCore and the runner.** (M)
  - A `screenshotRequest` prop, as `focusRequest` is, carrying the
    options. ViewerCore takes the snapshot and runs it.
  - Progress and `Cancel` in `loadingTasks`; one at a time; cancelled by a
    dataset change (D12).
  - The no-redraw guard: opening the popover and taking a screenshot must
    not render the live DeckGL, which costs about 9 s per render headless.
- [ ] **H. The popover.** (M) `ScreenshotButton` in `TopBar.tsx`: scale,
      the size line, `DPI`, include, background, the notes, the read
      question, `Save PNG`, progress and `Cancel`. Tests in
      `TopBar.test.tsx` on a fake runner.
- [ ] **I. Docs and end-to-end tests.** (M)
  - Docs: [Docs To Update](#docs-to-update).
  - Playwright on an offline fixture (a local OME-TIFF with cells under an
    AnnData manifest): a 2× screenshot; check the download's size, its
    `pHYs` and text chunks, and pixels at a known cell and a known image
    feature.
  - The axe test opens the popover; the baseline stays `{}`.
  - A nightly `@live` test: a 4× screenshot of the Xenium demo, timed.

## Order And Size

| Milestone       | Contents | Size          |
| --------------- | -------- | ------------- |
| M0 — Spike      | A        | M             |
| M1 — Screenshot | B to I   | About 2 weeks |

- B, E and F can go in parallel with A. C and D need A's answers.
- G needs C, D and E. H can start on a fake runner.
- The total is about 2½ weeks.

## Risks

| Risk                                           | Effect                                                                                                         | Mitigation                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A second WebGL context with the cells' buffers | GPU memory doubles for a moment; a lost context on small GPUs                                                  | The spike measures it; the framebuffer alternative; the context lost as soon as it is done |
| Chromium's 16 live contexts                    | The oldest context, another view's, is dropped; the main view draws again, which counts toward its 3 (PR #420) | One off-screen Deck at a time, lost right after; the spike checks which context goes       |
| WebGL shrinks a large drawing buffer silently  | A tile drawn small and stretched                                                                               | Tiles of at most 4,096 px (D9); check `drawingBufferWidth` and fail rather than stretch    |
| Many image tiles at 4× and 8×                  | Minutes on a slow host (BioImage Archive, 3–10 MB/s)                                                           | The estimate and the question (D4), progress, `Cancel`                                     |
| The read evicts the byte-range cache           | The canvas and the readers lose their cached bytes                                                             | `persist: false` (D4)                                                                      |
| Seams at tile edges                            | Lines across the PNG                                                                                           | Tiles on whole device pixels (D3, D9); the spike checks                                    |
| A hidden tab                                   | No animation frames; the Deck may not draw                                                                     | `redraw` called directly; the spike checks                                                 |
| A large PNG                                    | Seconds to encode; 512 MiB of pixels at the limit                                                              | The size limit (D10); `toBlob` is asynchronous                                             |
| Every cell drawn (D5)                          | Denser than the screen, which samples                                                                          | The popover says so, with both counts                                                      |
| Large typed arrays in React props              | React 19's dev build walks them; dev tabs crash                                                                | The snapshot and the plan stay out of props, in the runner's private fields                |

## Docs To Update

- `docs/ui-reference.md`: `Screenshot` in the Top Bar table, and a
  Screenshot section with the popover's controls, the notes, the file
  name and its chunks.
- `docs/user-guide.md`: making a figure, under Spatial Navigation: the
  scale, the notes, and `All cells` and `Exact` for a complete view.
- `docs/architecture.md`: the off-screen drawing.
- `PLAN.md`: this phase's row.

## Answered Questions

Answered by the user on 2026-11-24 and folded into the decisions.

1. **Every loaded cell** (D5), not the screen's sample. A strict "what you
   see", with the render cap, was the other choice.
2. **Default scale: 2×** (D3), about 3,000 px wide for a 1,500 px canvas.
   At 300 dpi that is 254 mm, wider than a journal's full page (about
   180 mm). 4× was the other choice.
3. **A tile that cannot be read fails the screenshot**, with `Retry`
   ([How A Screenshot Runs](#how-a-screenshot-runs)), rather than saving
   with a gap.
4. **`Copy` later.** The first version saves a PNG; putting it on the
   clipboard (`ClipboardItem`) is under [Later](#later).

## Later

- The legend as its own SVG beside the PNG, to edit in Illustrator.
- `Copy` to the clipboard.
- A crop frame with a set aspect, or a size in mm.
- Collection sections side by side, the section stack and the 3D views.
- Vector SVG of small views (outlines and points under a limit), with the
  image embedded.
- A keyboard shortcut.
