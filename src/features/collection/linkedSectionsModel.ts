import type { LinkedViewState } from '../../components/linkedView'
import type { ShareablePanelImage, ShareablePanelLink } from '../../data/shareableState'
import {
  collectionEntryFor,
  sameDatasetUrl,
  type DatasetCollection,
  type DatasetCollectionEntry,
} from '../../datasets/datasetCollection'

// Sections side by side: the open dataset and up to MAX_LINKED_SECTIONS more
// panels beside the main view, each another dataset of its collection or the
// open dataset itself, for its image with other channels (plan 30-D8). A
// panel is linked to the main view, panning and zooming with it at an offset,
// or has a view of its own. Sections registered to the open dataset (one
// coordinateSystem), and the open dataset itself, open linked; others
// unlinked. The link names them with compare=, and each one's link with
// compareLink=.

// Four viewers at once: the open dataset and three panels, in a 2 by 2 grid.
export const MAX_LINKED_SECTIONS = 3

// Where a linked panel's view is from the main view's: its target that much
// further in deck.gl coordinates, and its zoom that much higher.
export interface PanelOffset {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export const NO_OFFSET: PanelOffset = { x: 0, y: 0, zoom: 0 }

export type PanelLink =
  | { readonly linked: true; readonly offset: PanelOffset }
  // Its own view; null fits the panel to its section.
  | { readonly linked: false; readonly view: LinkedViewState | null }

export const LINKED: PanelLink = { linked: true, offset: NO_OFFSET }
export const UNLINKED: PanelLink = { linked: false, view: null }

// An unlinked panel's link is its own object: the app keys where it has moved
// to by it.
function unlinked(): PanelLink {
  return { linked: false, view: null }
}

// What a panel shows of its section's image (plan 30-D4): the image under
// its cells, the image alone, or none (its cells only).
export type PanelImageMode = 'cells' | 'only' | null

// A panel as compare=, compareLink=, compareImage=, compareChannels= and
// compareBoundaries= name it. A null link is the section's default, known
// once the collection is read; null channels are the image's defaults.
export interface ComparePanel {
  readonly url: string
  readonly link: PanelLink | null
  readonly image?: PanelImageMode
  readonly channels?: readonly string[] | null
  // Whether it draws its section's cell boundaries (plan 30-D9).
  readonly boundaries?: boolean
}

export interface ResolvedPanel extends ComparePanel {
  readonly link: PanelLink
}

export interface ShownPanel {
  readonly entry: DatasetCollectionEntry
  readonly panel: ResolvedPanel
}

// Whether two sections are registered to each other: one coordinate system,
// so the same view shows the same place in both.
export function isRegistered(
  openEntry: DatasetCollectionEntry | undefined,
  entry: DatasetCollectionEntry,
): boolean {
  return (
    openEntry?.coordinateSystem !== undefined &&
    entry.coordinateSystem === openEntry.coordinateSystem
  )
}

// Whether `entry` can be shown beside the open dataset: another entry of its
// collection.
export function canShowBeside(
  openEntry: DatasetCollectionEntry | undefined,
  entry: DatasetCollectionEntry,
): boolean {
  return openEntry !== undefined && entry !== openEntry
}

// How a section opens beside the open dataset: linked when registered to it,
// else with a view of its own, fitted to it.
export function defaultPanelLink(
  openEntry: DatasetCollectionEntry | undefined,
  entry: DatasetCollectionEntry,
): PanelLink {
  return isRegistered(openEntry, entry) ? LINKED : unlinked()
}

// Each panel resolved, kept for as long as the panel is, so a panel keeps its
// link object (and, unlinked, the view it has moved to) across renders.
const resolvedPanels = new WeakMap<
  ComparePanel,
  { readonly url: string; readonly registered: boolean; readonly panel: ResolvedPanel }
>()

// The panels shown beside the open dataset: those of compare= that can be,
// in their order, up to the limit, each with its link. A panel of the open
// dataset itself (its image beside, D8) is shown with or without a
// collection, as many times as asked; `openFallback` names it without one.
// Another dataset of the collection is shown once.
export function shownPanels(
  collection: DatasetCollection | null,
  openUrl: string | null,
  panels: readonly ComparePanel[],
  openFallback: DatasetCollectionEntry | null = null,
): readonly ShownPanel[] {
  if (openUrl === null || panels.length === 0) return []

  const openEntry =
    collection === null ? undefined : collectionEntryFor(collection, openUrl)
  const ownEntry = openEntry ?? openFallback
  const shown: ShownPanel[] = []

  for (const panel of panels) {
    if (shown.length >= MAX_LINKED_SECTIONS) break

    if (sameDatasetUrl(panel.url, openUrl)) {
      if (ownEntry !== null) {
        shown.push({ entry: ownEntry, panel: resolvedPanel(panel, ownEntry, true) })
      }
      continue
    }

    const entry =
      collection === null ? undefined : collectionEntryFor(collection, panel.url)

    if (
      entry !== undefined &&
      !shown.some((item) => item.entry === entry) &&
      canShowBeside(openEntry, entry)
    ) {
      shown.push({
        entry,
        panel: resolvedPanel(panel, entry, isRegistered(openEntry, entry)),
      })
    }
  }

  return shown
}

// Whether a shown panel is of the open dataset itself.
export function isOwnPanel(shown: ShownPanel, openUrl: string | null): boolean {
  return openUrl !== null && sameDatasetUrl(shown.entry.url, openUrl)
}

function resolvedPanel(
  panel: ComparePanel,
  entry: DatasetCollectionEntry,
  registered: boolean,
): ResolvedPanel {
  if (panel.link !== null && panel.url === entry.url) return panel as ResolvedPanel

  const cached = resolvedPanels.get(panel)
  if (
    cached !== undefined &&
    cached.url === entry.url &&
    cached.registered === registered
  ) {
    return cached.panel
  }

  const resolved: ResolvedPanel = {
    ...panel,
    url: entry.url,
    link: panel.link ?? (registered ? LINKED : unlinked()),
  }
  resolvedPanels.set(panel, { url: entry.url, registered, panel: resolved })
  return resolved
}

// Shows a section beside the open one, after the others, or stops showing it.
export function toggledPanels(
  collection: DatasetCollection | null,
  openUrl: string | null,
  shown: readonly ShownPanel[],
  entry: DatasetCollectionEntry,
): readonly ComparePanel[] {
  const panels = shown.map((item) => item.panel)

  if (shown.some((item) => item.entry === entry)) {
    return shown.filter((item) => item.entry !== entry).map((item) => item.panel)
  }

  const openEntry =
    collection === null ? undefined : collectionEntryFor(collection, openUrl)

  return [...panels, { url: entry.url, link: defaultPanelLink(openEntry, entry) }].slice(
    0,
    MAX_LINKED_SECTIONS,
  )
}

// The open dataset's image beside the main view, once more: linked, at the
// main view's channels (D8).
export function withOwnPanel(
  shown: readonly ShownPanel[],
  openUrl: string,
): readonly ComparePanel[] {
  return [
    ...shown.map((item) => item.panel),
    { url: openUrl, link: LINKED, image: 'cells' as const },
  ].slice(0, MAX_LINKED_SECTIONS)
}

// Changes one shown panel: its image, its channels, its boundaries or its
// link.
export function withPanel(
  shown: readonly ShownPanel[],
  panel: ResolvedPanel,
  patch: Partial<Omit<ResolvedPanel, 'url'>>,
): readonly ComparePanel[] {
  return shown.map((item) =>
    item.panel === panel ? { ...item.panel, ...patch } : item.panel,
  )
}

// Closes one shown panel.
export function withoutPanel(
  shown: readonly ShownPanel[],
  panel: ResolvedPanel,
): readonly ComparePanel[] {
  return shown.filter((item) => item.panel !== panel).map((item) => item.panel)
}

// Whether opening `nextUrl` in place of the open dataset keeps the view: both
// are in one coordinate system, so the view shows the same place.
export function keepsViewOnOpening(
  collection: DatasetCollection | null,
  openUrl: string | null,
  nextUrl: string,
): boolean {
  if (collection === null) return false

  const openEntry = collectionEntryFor(collection, openUrl)
  const nextEntry = collectionEntryFor(collection, nextUrl)

  return (
    nextEntry !== undefined &&
    nextEntry !== openEntry &&
    isRegistered(openEntry, nextEntry)
  )
}

export interface PanelsAfterOpening {
  readonly panels: readonly ResolvedPanel[]
  // The view the next dataset opens at, when it keeps one: the main view's,
  // or that of the panel it swaps with. Null fits it.
  readonly view: LinkedViewState | null
}

// The panels beside `nextUrl` once it opens in place of the open dataset,
// and the view it opens at. `mainView` is the main view's now.
//
// Opening one of the panels swaps it with the open dataset, each viewer
// keeping what it shows: the next dataset opens at the panel's view, and the
// open one takes the panel's place at the main view's, linked as the panel
// was. Opening another section of the collection keeps the panels; when it is
// not registered to the open dataset it opens fitted, so the linked panels
// keep where they are, unlinked. Any other dataset has none.
export function panelsAfterOpening(
  collection: DatasetCollection | null,
  openUrl: string | null,
  shown: readonly ShownPanel[],
  nextUrl: string,
  mainView: LinkedViewState | null,
): PanelsAfterOpening {
  if (collection === null || openUrl === null) return { panels: [], view: null }

  const openEntry = collectionEntryFor(collection, openUrl)
  const nextEntry = collectionEntryFor(collection, nextUrl)

  if (openEntry === undefined || nextEntry === undefined || nextEntry === openEntry) {
    return { panels: [], view: null }
  }

  const swapped = shown.find((item) => item.entry === nextEntry)

  if (swapped !== undefined) {
    const { link } = swapped.panel
    const view = shownPanelView(link, mainView)

    return {
      panels: shown.map((item) =>
        item === swapped
          ? {
              url: openEntry.url,
              link: link.linked
                ? { linked: true, offset: negatedOffset(link.offset) }
                : { linked: false, view: mainView },
              // The open dataset shows its image in the panel if the panel
              // showed one, with its own channels, and its outlines if the
              // panel drew them.
              ...(swapped.panel.image == null ? {} : { image: swapped.panel.image }),
              ...(swapped.panel.boundaries === true ? { boundaries: true } : {}),
            }
          : item.panel,
      ),
      // A panel fitted to its section opens fitted.
      view,
    }
  }

  if (keepsViewOnOpening(collection, openUrl, nextUrl)) {
    return { panels: shown.map((item) => item.panel), view: mainView }
  }

  return {
    panels: shown.map((item) =>
      item.panel.link.linked
        ? {
            ...item.panel,
            link: { linked: false, view: shownPanelView(item.panel.link, mainView) },
          }
        : item.panel,
    ),
    view: null,
  }
}

// What a panel shows: the main view at its offset when linked, else its own
// view. Null before the main view has one, or for a panel fitted to its
// section.
export function shownPanelView(
  link: PanelLink,
  mainView: LinkedViewState | null,
): LinkedViewState | null {
  if (!link.linked) return link.view
  if (mainView === null) return null

  return {
    target: [mainView.target[0] + link.offset.x, mainView.target[1] + link.offset.y],
    zoom: mainView.zoom + link.offset.zoom,
  }
}

// The main view a linked panel's view stands for.
export function mainViewForPanel(
  offset: PanelOffset,
  panelView: LinkedViewState,
): LinkedViewState {
  return {
    target: [panelView.target[0] - offset.x, panelView.target[1] - offset.y],
    zoom: panelView.zoom - offset.zoom,
  }
}

// Linking a panel keeps it where it is: its offset is how far its view is
// from the main view's.
export function offsetBetween(
  panelView: LinkedViewState,
  mainView: LinkedViewState,
): PanelOffset {
  return {
    x: panelView.target[0] - mainView.target[0],
    y: panelView.target[1] - mainView.target[1],
    zoom: panelView.zoom - mainView.zoom,
  }
}

export function hasOffset(offset: PanelOffset): boolean {
  return offset.x !== 0 || offset.y !== 0 || offset.zoom !== 0
}

function negatedOffset(offset: PanelOffset): PanelOffset {
  return hasOffset(offset)
    ? { x: -offset.x, y: -offset.y, zoom: -offset.zoom }
    : NO_OFFSET
}

// The panels as compare= names them.
export function comparePanelsFromLink(
  urls: readonly string[] | undefined,
  links: readonly (ShareablePanelLink | null)[] | undefined,
  images?: readonly ShareablePanelImage[],
  channels?: readonly (readonly string[] | null)[],
  boundaries?: readonly boolean[],
): readonly ComparePanel[] {
  return (urls ?? []).map((url, index) => {
    const image = images?.[index] ?? null
    const shown = channels?.[index] ?? null

    return {
      url,
      link: panelLinkFromShareable(links?.[index] ?? null),
      ...(image === null ? {} : { image }),
      ...(shown === null ? {} : { channels: shown }),
      ...(boundaries?.[index] === true ? { boundaries: true } : {}),
    }
  })
}

// Each panel's compareImage=, none when no panel shows its image.
export function compareImagesForLink(
  panels: readonly ComparePanel[],
): readonly ShareablePanelImage[] | undefined {
  const images = panels.map((panel) => panel.image ?? null)

  return images.every((image) => image === null) ? undefined : images
}

// Each panel's compareBoundaries=, none when no panel draws its outlines.
export function compareBoundariesForLink(
  panels: readonly ComparePanel[],
): readonly boolean[] | undefined {
  const boundaries = panels.map((panel) => panel.boundaries === true)

  return boundaries.some(Boolean) ? boundaries : undefined
}

// Each panel's compareChannels=, for panels showing their image with
// channels of their own; none when there are none.
export function compareChannelsForLink(
  panels: readonly ComparePanel[],
): readonly (readonly string[] | null)[] | undefined {
  const channels = panels.map((panel) =>
    panel.image == null ? null : (panel.channels ?? null),
  )

  return channels.every((shown) => shown === null) ? undefined : channels
}

function panelLinkFromShareable(link: ShareablePanelLink | null): PanelLink | null {
  if (link === null) return null

  const [x, y, zoom] = link.values ?? []

  if (link.linked) {
    return x === undefined || y === undefined || zoom === undefined
      ? LINKED
      : { linked: true, offset: { x, y, zoom } }
  }

  return x === undefined || y === undefined || zoom === undefined
    ? unlinked()
    : { linked: false, view: { target: [x, y], zoom } }
}

// Each panel's compareLink=, null where it opens as it does by default;
// none when they all do.
export function compareLinksForLink(
  collection: DatasetCollection | null,
  openUrl: string | null,
  panels: readonly ResolvedPanel[],
): readonly (ShareablePanelLink | null)[] | undefined {
  const openEntry =
    collection === null ? undefined : collectionEntryFor(collection, openUrl)
  const links = panels.map((panel) => {
    const entry =
      collection === null ? undefined : collectionEntryFor(collection, panel.url)
    const registered =
      (openUrl !== null && sameDatasetUrl(panel.url, openUrl)) ||
      (entry !== undefined && isRegistered(openEntry, entry))

    return isDefaultLink(panel.link, registered) ? null : shareablePanelLink(panel.link)
  })

  return links.every((link) => link === null) ? undefined : links
}

function isDefaultLink(link: PanelLink, registered: boolean): boolean {
  return link.linked
    ? registered && !hasOffset(link.offset)
    : !registered && link.view === null
}

function shareablePanelLink(link: PanelLink): ShareablePanelLink {
  if (link.linked) {
    return hasOffset(link.offset)
      ? { linked: true, values: [link.offset.x, link.offset.y, link.offset.zoom] }
      : { linked: true }
  }

  return link.view === null
    ? { linked: false }
    : {
        linked: false,
        values: [link.view.target[0], link.view.target[1], link.view.zoom],
      }
}
