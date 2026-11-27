# Phase 30 — Compare Panels

Planned 2026-11-27. Requested: three changes to the panels shown beside the
main view, for comparing images.

- **a)** A toggle that links or unlinks a panel's pan and zoom from the main
  view. Linked by default, as now. Unlinked, each viewer pans and zooms on
  its own, to compare different regions.
- **b)** Load a section's image in its panel, as `Open` would show it, but
  without making it the main view's dataset.
- **c)** The same image side by side, so that each panel can show other
  channels of it.

It started from a question: the Burnside SCI Xenium collection
(`sciatlas.cog.sanger.ac.uk/Burnside_et_al__H_sapiens__Xenium/collection.json`)
offered no `Show beside`. Its entries had no `coordinateSystem`, and side
by side (plan 20) was for registered sections only.

The user answered four questions on 2026-11-27
([Answered Questions](#answered-questions)). D1, D2, D5 and D8 carry the
answers.

The plan rests on a code map made on 2026-11-27 at `919d6d28`. It is cited
below as `file:line`; line numbers drift as the code changes.

Sizes are for one developer: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks.

## Goals And Non-Goals

Goals:

- Every section of a collection can be shown beside the open one, not only
  registered ones (D1).
- Each panel has a link toggle. Linking keeps the panel where it is, at an
  offset from the main view, and a reset drops the offset (D2).
- Each panel can load its section's image, drawn under its cells, with its
  own channels, colours and contrast (D4, D5).
- The open dataset itself can be shown beside the main view, for any
  dataset with an image, with or without a collection (D8).
- The link keeps all of it: each panel's link, offset or view, image and
  channels.
- The axe baseline stays empty and `nativeTitleAudit` passes.

Non-goals:

- Registration. Offsets are translations and zoom. Rotation, flips and
  warps are for the collection's coordinates (plan 24).
- The main view's tools in panels: selection, Magic Lens, measuring,
  cards, boundaries and transcripts stay the main view's (plan 20).
- More than three panels.
- Screenshots of the panels. The Screenshot (plan 27) is the main view's.

## Current State

- **Panels.** `LinkedSections.tsx` draws each panel's cells from the
  collection preview store, in its own deck.gl canvas, with the main view's
  colouring. Only entries with the open dataset's `coordinateSystem` were
  offered (`linkedSectionsModel.ts` `canShowBeside`).
- **One view.** `LinkedViewChannel` (`components/linkedView.ts`) carries
  one target and zoom. `ViewerCore` publishes the main view's in a layout
  effect and follows the channel (`ViewerCore.tsx:842-878`). Each panel
  showed the channel's view, or fitted its cells before there was one.
- **Link.** `compare=` once per panel, in order (`shareableState.ts`).
- **Images.** Each platform opens its image in its own branch of the
  dataset load (`useDatasetLifecycle.ts`: Xenium 2402, Atera 1895,
  MERSCOPE 1997-2079, image 2093-2114, AnnData and SpatialData through
  `loadPyramidImageInBackground` 1476-1508, Visium 1591-1667, Visium HD
  2247-2283). There is no function that opens a dataset's image on its own.
  The pieces are shared: `loadMorphologyImage` and
  `morphologyImageFromPyramidLoader` (`data/morphologyImage.ts:99`, `:307`),
  each dataset's `image()`, `flatMorphologyImageFromSource`,
  `visiumImageForLoad`, `merscopeImageForLoad`.
- **Drawing an image.** `MorphologyCanvas` takes a loader, channels and a
  view state and places the image in the dataset's coordinates
  (`components/MorphologyCanvas.tsx`). `ViewerCore` draws it under its deck
  canvas (`ViewerCore.tsx:2462-2496`).
- **Channels.** `MorphologyChannelControls` takes channels, settings,
  `onUpdate` and `onAutoContrast` as props
  (`features/morphology/MorphologyChannelControls.tsx:13-24`), so a panel
  can host it. Settings start from `createMorphologyChannelSettings` and
  `defaultEnabledChannelIds` (`morphologyChannels.ts:31-67`); auto-contrast
  is `computeAutoChannelContrast` (`appDependencies.ts:251`).

## Product Decisions

**D1. Any section of the collection can be shown beside the open one.**
`Show beside` is on every other entry of the open dataset's collection.
A section registered to the open one (one `coordinateSystem`) opens linked,
as before. Others open unlinked, fitted to their own cells. Unregistered
collections such as Burnside work without editing their JSON. A dataset
without cells, such as an atlas without spatial coordinates, says so in its
panel, as images did.

**D2. Each panel has its own link, kept at an offset.** A chain-link toggle
in the panel's header: `Linked` pans and zooms with the main view, `Unlinked`
on its own. Linking again keeps the panel where it is: it stores how far its
centre and zoom are from the main view's, so two sections lined up by hand
then move together. Panning a linked panel moves the main view and the
other linked panels by the same amount. A `Reset the offset` button (the
target icon) puts a linked panel at the main view's centre and zoom; it is
disabled with no offset. An unlinked panel has `Fit` in its place.

**D3. Opening sections.** `Open` swaps a panel with the main view, each
viewer keeping what it shows: the section opens at the panel's view, and
the open dataset takes the panel, at the opposite offset when linked.
Choosing another section of the collection keeps the panels. When it is
registered to the open one the view carries over, as before; when not, it
opens fitted and linked panels keep where they are, unlinked. A dataset
outside the collection closes them.

**D4. A panel loads its section's image on request.** An `Image` toggle in
the panel's header loads the image the section would open with in the main
view: the same file, plane and placement, by the same per-platform pieces.
It is off by default, to keep the read small. A panel of a section without
cells has nothing else to show, so its image loads at once. The dataset is
not opened as the main view's: no table, boundaries or transcripts beyond
what the image needs.

**D5. Each panel's channels are its own, set in a popover.** With its image
loaded, a panel's header has a `Channels` button. Its popover lists the
image's channels with the main view's controls: show or hide, colour,
contrast and auto-contrast. A `Cells` toggle there hides the panel's cells
to see the image alone. A panel starts from the main view's settings for
channels of the same name, and from the image's defaults otherwise, with
auto-contrast as the main view would run it.

**D6. The link keeps each panel.** In the order of `compare=`:

- `compareLink=`: `1` linked, `0` unlinked, each followed by x, y and zoom
  when set: a linked panel's offset, an unlinked one's view. A missing or
  unreadable value is the section's default. None is written when every
  panel is as it opens by default.
- `compareImage=` (M2): `1` for a panel showing its image.
- `compareChannels=` (M2): the panel's shown channels, as `channels=` is.

**D7. Reading stays bounded.** A panel's image is read only while its
`Image` is on. Panels keep a smaller tile cache than the main view. A panel
holds its dataset (`retainDataset`) while its image is open, so the dataset
cache does not drop and re-open it.

**D8. The same image side by side, for any dataset with an image.** The
Layers drawer's Image section has `Show beside`, for the open dataset, with
or without a collection: a QPTIFF or OME-TIFF can be compared channel set
against channel set. The panel uses the image the main view has open (the
same loaders, so no second read of the file's structure), linked with no
offset, starting from the main view's channels. Its cells come from the
open dataset's preview (`useOpenDatasetPreviewStore`). It closes when
another dataset opens, unless the collection keeps it as a section (D3).

## Tasks

### M1. Links And Offsets (S) — built 2026-11-27

- A1. `linkedSectionsModel.ts`: panels with links (`ComparePanel`,
  `PanelLink`, `PanelOffset`), `canShowBeside` for every entry,
  `isRegistered`, `defaultPanelLink`, `shownPanels` (a link's panels take
  their default once the collection is read, one object per panel),
  `toggledPanels`, `withPanelLink`, `panelsAfterOpening` (D3),
  `shownPanelView`, `mainViewForPanel`, `offsetBetween`, and the link's
  `comparePanelsFromLink` and `compareLinksForLink`.
- A2. `LinkedSections.tsx`: per-panel link toggle, reset and fit; a linked
  panel shows the channel's view at its offset and publishes the main view
  its own stands for; an unlinked one keeps its view and reports it to the
  app 180 ms after it rests, for the link.
- A3. `App.tsx`: `comparePanels` in place of `compareUrls`, the reported
  views, and `panelsAfterOpening` in `handleSelectCollectionEntry` (its
  view is the carried view).
- A4. `shareableState.ts` and `useShareableUrlHash.ts`: `compareLink=`.
- A5. `CollectionBar.tsx`: `Show beside` titles say whether the section
  opens linked. `UnlinkIcon`.
- A6. Tests: the model, the link, and App tests for unlink, panning apart,
  linking at an offset, reset, a link's offsets, and a section outside the
  coordinate system keeping its panel.

### M2. Images In Panels (M) — built 2026-11-27

- B1. `loadPanelImage(url, loaders, signal)` (`panelImage.ts`): detect the
  dataset and open its image by the per-platform pieces the load uses, with
  the manifest's defaults and nothing from the link: a pyramid
  `MorphologyImage` with the channels shown first and whether to
  auto-contrast (not native RGB), a flat image (Visium, Visium HD), or
  none. The dataset is opened as the previews open it, so the image is
  placed with their cells. A large MERSCOPE image the main view defers is
  read when a panel asks for it. Unit tests per platform.
- B2. `usePanelImage`: per panel, load on `Image`, abort when hidden or
  closed, retain the dataset while shown, keep the image and its channels
  while hidden, channel settings (`startingSettings`, D5) and auto-contrast
  for the channels that did not take the main view's window.
- B3. The panel draws a `MorphologyCanvas` under its deck canvas, at its
  view, with a 48-tile cache; a section without cells fits to the image.
- B4. Header `Show the image of {label}` toggle and `Channels of {label}`
  popover with `Cells` and `MorphologyChannelControls`, centred under the
  header and kept inside the panel (`container-type: size`).
- B5. `compareImage=` and `compareChannels=`.
- B6. Tests: the loader per platform, the hook and `startingSettings`, the
  link, and App tests for showing a panel's image, its channels and cells
  in the link, and a link's panel image. The e2e on a local OME-Zarr
  fixture is still to write.

### M3. The Same Image Beside (S–M)

- C1. Panels of the open dataset: `shownPanels` keeps a panel whose URL is
  the open dataset, with or without a collection; no `Open` on it.
- C2. `Show beside` in the Image section; the panel takes the main view's
  `MorphologyImage` and its channel settings.
- C3. Cells from the open dataset's preview store when there is no
  collection.
- C4. Tests and docs.

### Docs

- `docs/dataset-collections.md` › Showing Sections and Known Limitations.
- `docs/user-guide.md` side by side; `docs/ui-reference.md` panel header.
- `PLAN.md` row; open items for what stays open.

## Risks

- **Memory.** Four viewers each drawing a multiplex image hold four tile
  caches. D7's smaller panel cache, and one `Image` at a time by default,
  bound it.
- **Per-platform drift.** B1 repeats the load's per-platform switch, not
  its code: each branch calls the same functions, but a change to one
  platform's load must be made in both. Folding the hook onto B1 is
  [Later](#later).

## Answered Questions

Asked and answered 2026-11-27:

1. _Should sections that are not registered get `Show beside`?_ Yes: any
   section; unregistered ones open unlinked (D1).
2. _How should linking work, and what does linking again do?_ Per panel,
   keeping the offset, so sections lined up by hand pan and zoom together;
   with a button to reset the offset (D2).
3. _Where are a panel's channels chosen?_ A popover in each panel (D5).
4. _Where is the same image side by side offered?_ For any dataset with an
   image (D8).

## Later

- The dataset load opening its image through `loadDatasetMorphology`.
- Sharing decoded tiles between the main view and a same-image panel (a
  tile store lifted into the app; tile keys include contrast and colour,
  `MorphologyCanvas.tsx:748-759`).
- Rotation and flips in an offset, for sections lined up by hand.
- Panels in the Screenshot.
