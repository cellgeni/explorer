import { describe, expect, it } from 'vitest'
import { parseDatasetCollection } from '../../datasets/datasetCollection'
import {
  canShowBeside,
  compareBoundariesForLink,
  compareLinksForLink,
  comparePanelsFromLink,
  defaultPanelLink,
  keepsViewOnOpening,
  LINKED,
  mainViewForPanel,
  MAX_LINKED_SECTIONS,
  offsetBetween,
  panelsAfterOpening,
  shownPanels,
  shownPanelView,
  toggledPanels,
  UNLINKED,
  withOwnPanel,
  withoutPanel,
  withPanel,
  type ComparePanel,
  type PanelLink,
} from './linkedSectionsModel'

const COLLECTION = parseDatasetCollection(
  {
    version: 1,
    datasets: [
      { dataset: 'p1-s1.zarr', coordinateSystem: 'patient-1' },
      { dataset: 'p1-s2.zarr', coordinateSystem: 'patient-1' },
      { dataset: 'p1-s3.zarr', coordinateSystem: 'patient-1' },
      { dataset: 'p1-s4.zarr', coordinateSystem: 'patient-1' },
      { dataset: 'p1-s5.zarr', coordinateSystem: 'patient-1' },
      { dataset: 'p2-s1.zarr', coordinateSystem: 'patient-2' },
      { dataset: 'atlas.zarr' },
    ],
  },
  'https://example.test/study/collection.json',
)
const [S1, S2, S3, S4, S5, P2, ATLAS] = COLLECTION.datasets.map((entry) => entry.url) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
]
const entry = (url: string) => COLLECTION.datasets.find((item) => item.url === url)!
const panel = (url: string, link: PanelLink | null = null): ComparePanel => ({
  url,
  link,
})
const shownUrls = (panels: readonly ComparePanel[]) =>
  shownPanels(COLLECTION, S1, panels).map((shown) => shown.entry.url)
const MAIN = { target: [100, -50] as const, zoom: 2 }

describe('sections side by side', () => {
  it('offers every other entry of the open dataset’s collection', () => {
    expect(canShowBeside(entry(S1), entry(S2))).toBe(true)
    expect(canShowBeside(entry(S1), entry(S1))).toBe(false)
    expect(canShowBeside(entry(S1), entry(P2))).toBe(true)
    expect(canShowBeside(entry(S1), entry(ATLAS))).toBe(true)
    expect(canShowBeside(entry(ATLAS), entry(S1))).toBe(true)
    // A dataset outside the collection has no sections beside it.
    expect(canShowBeside(undefined, entry(S1))).toBe(false)
  })

  it('links registered sections and leaves the others fitted to themselves', () => {
    expect(defaultPanelLink(entry(S1), entry(S2))).toBe(LINKED)
    expect(defaultPanelLink(entry(S1), entry(P2))).toEqual(UNLINKED)
    expect(defaultPanelLink(entry(ATLAS), entry(S1))).toEqual(UNLINKED)
  })

  it('shows the compare= sections that can be, in order, up to the limit', () => {
    expect(
      shownUrls([
        panel(S3),
        panel('https://elsewhere.test/x'),
        panel(P2),
        panel(S3),
        panel(S2),
      ]),
    ).toEqual([S3, P2, S2])
    // The open dataset's own panel (its image beside) counts as one.
    expect(shownUrls([panel(S3), panel(S1), panel(S2), panel(S4)])).toEqual([S3, S1, S2])
    expect(shownUrls([S2, S3, S4, S5].map((url) => panel(url)))).toEqual(
      [S2, S3, S4].slice(0, MAX_LINKED_SECTIONS),
    )
    expect(shownPanels(null, S1, [panel(S2)])).toEqual([])
    expect(shownPanels(COLLECTION, 'https://elsewhere.test/x', [panel(S2)])).toEqual([])
  })

  it('gives a link’s panels their default link, the same object each time', () => {
    const panels = [panel(S2), panel(P2)]
    const first = shownPanels(COLLECTION, S1, panels)
    const again = shownPanels(COLLECTION, S1, panels)

    expect(first.map((shown) => shown.panel.link)).toEqual([LINKED, UNLINKED])
    expect(again[0]?.panel).toBe(first[0]?.panel)
    expect(again[1]?.panel).toBe(first[1]?.panel)
    // A link it was given stays.
    const unlinked: PanelLink = { linked: false, view: { target: [1, 2], zoom: 3 } }
    expect(shownPanels(COLLECTION, S1, [panel(S2, unlinked)])[0]?.panel.link).toBe(
      unlinked,
    )
  })

  it('toggles a section beside the open one, linked when registered', () => {
    const shown = shownPanels(COLLECTION, S1, [panel(S2, LINKED)])

    expect(toggledPanels(COLLECTION, S1, shown, entry(S3))).toEqual([
      { url: S2, link: LINKED },
      { url: S3, link: LINKED },
    ])
    expect(toggledPanels(COLLECTION, S1, shown, entry(P2))).toEqual([
      { url: S2, link: LINKED },
      { url: P2, link: UNLINKED },
    ])
    expect(toggledPanels(COLLECTION, S1, shown, entry(S2))).toEqual([])
    const full = shownPanels(
      COLLECTION,
      S1,
      [S2, S3, S4].map((url) => panel(url, LINKED)),
    )
    expect(
      toggledPanels(COLLECTION, S1, full, entry(S5)).map((item) => item.url),
    ).toEqual([S2, S3, S4])
  })

  it('sets one panel’s link, or closes it, by the panel', () => {
    const shown = shownPanels(COLLECTION, S1, [panel(S2, LINKED), panel(S3, LINKED)])
    const unlinked: PanelLink = { linked: false, view: null }

    expect(withPanel(shown, shown[1]!.panel, { link: unlinked })).toEqual([
      { url: S2, link: LINKED },
      { url: S3, link: unlinked },
    ])
    expect(withoutPanel(shown, shown[0]!.panel)).toEqual([{ url: S3, link: LINKED }])
  })

  it('shows the open dataset itself beside it, with or without a collection', () => {
    const own = {
      path: 'x',
      url: 'https://example.test/qptiff/slide.qptiff',
      name: 'Slide',
    }
    const withOwn = withOwnPanel([], own.url)

    expect(withOwn).toEqual([{ url: own.url, link: LINKED, image: 'cells' }])
    // Without a collection, only its own panels, as often as asked.
    const twice = shownPanels(null, own.url, [...withOwn, ...withOwn], own)
    expect(twice.map((item) => [item.entry, item.panel.link])).toEqual([
      [own, LINKED],
      [own, LINKED],
    ])
    expect(shownPanels(null, own.url, withOwn, null)).toEqual([])
    // In a collection, beside its sections, linked whether registered or not.
    const shown = shownPanels(COLLECTION, ATLAS, [panel(ATLAS), panel(S2)])
    expect(shown.map((item) => [item.entry.url, item.panel.link.linked])).toEqual([
      [ATLAS, true],
      [S2, false],
    ])
    // Linked with no offset is its default, so the link has no compareLink=.
    expect(compareLinksForLink(COLLECTION, ATLAS, [shown[0]!.panel])).toBeUndefined()
    expect(
      withOwnPanel(
        shownPanels(
          COLLECTION,
          S1,
          [S2, S3, S4].map((url) => panel(url)),
        ),
        S1,
      ),
    ).toHaveLength(MAX_LINKED_SECTIONS)
  })

  it('shows a linked panel at its offset and moves the main view by it', () => {
    const offset = { x: 10, y: -5, zoom: 1 }
    const view = shownPanelView({ linked: true, offset }, MAIN)

    expect(view).toEqual({ target: [110, -55], zoom: 3 })
    expect(mainViewForPanel(offset, view!)).toEqual(MAIN)
    // Linking keeps the panel where it is.
    expect(offsetBetween(view!, MAIN)).toEqual(offset)
    expect(shownPanelView(LINKED, null)).toBeNull()
    expect(shownPanelView(UNLINKED, MAIN)).toBeNull()
  })

  it('keeps the view when opening another registered section', () => {
    expect(keepsViewOnOpening(COLLECTION, S1, S4)).toBe(true)
    expect(keepsViewOnOpening(COLLECTION, S1, S1)).toBe(false)
    expect(keepsViewOnOpening(COLLECTION, S1, P2)).toBe(false)
    expect(keepsViewOnOpening(COLLECTION, ATLAS, S1)).toBe(false)
    expect(keepsViewOnOpening(null, S1, S2)).toBe(false)
  })

  it('swaps a panel with the open dataset, each viewer keeping what it shows', () => {
    const offset = { x: 10, y: -5, zoom: 1 }
    const shown = shownPanels(COLLECTION, S1, [
      panel(S2, LINKED),
      panel(S3, { linked: true, offset }),
      panel(P2, UNLINKED),
    ])

    expect(panelsAfterOpening(COLLECTION, S1, shown, S2, MAIN)).toEqual({
      panels: [
        { url: S1, link: LINKED },
        { url: S3, link: { linked: true, offset } },
        { url: P2, link: UNLINKED },
      ],
      view: MAIN,
    })
    // The next dataset opens where the panel showed it; the open one goes
    // to the panel at the opposite offset.
    expect(panelsAfterOpening(COLLECTION, S1, shown, S3, MAIN)).toEqual({
      panels: [
        { url: S2, link: LINKED },
        { url: S1, link: { linked: true, offset: { x: -10, y: 5, zoom: -1 } } },
        { url: P2, link: UNLINKED },
      ],
      view: { target: [110, -55], zoom: 3 },
    })
    // An unlinked panel fitted to its section opens fitted, and the open
    // dataset keeps the main view, unlinked.
    expect(panelsAfterOpening(COLLECTION, S1, shown, P2, MAIN)).toEqual({
      panels: [
        { url: S2, link: LINKED },
        { url: S3, link: { linked: true, offset } },
        { url: S1, link: { linked: false, view: MAIN } },
      ],
      view: null,
    })
  })

  it('keeps the panels for another section of the collection', () => {
    const shown = shownPanels(COLLECTION, S1, [
      panel(S2, LINKED),
      panel(S3, { linked: true, offset: { x: 1, y: 2, zoom: 0 } }),
    ])

    // Registered: the view and the links stay.
    expect(panelsAfterOpening(COLLECTION, S1, shown, S4, MAIN)).toEqual({
      panels: [
        { url: S2, link: LINKED },
        { url: S3, link: { linked: true, offset: { x: 1, y: 2, zoom: 0 } } },
      ],
      view: MAIN,
    })
    // Not registered: it opens fitted, and the panels stay where they are.
    expect(panelsAfterOpening(COLLECTION, S1, shown, P2, MAIN)).toEqual({
      panels: [
        { url: S2, link: { linked: false, view: MAIN } },
        { url: S3, link: { linked: false, view: { target: [101, -48], zoom: 2 } } },
      ],
      view: null,
    })
  })

  it('closes the panels for a dataset outside the collection', () => {
    const shown = shownPanels(COLLECTION, S1, [panel(S2, LINKED)])

    expect(
      panelsAfterOpening(COLLECTION, S1, shown, 'https://elsewhere.test/x', MAIN),
    ).toEqual({ panels: [], view: null })
    expect(panelsAfterOpening(COLLECTION, null, shown, S2, MAIN)).toEqual({
      panels: [],
      view: null,
    })
  })

  it('writes compareLink= only for panels not as they open by default', () => {
    const resolve = (panels: readonly ComparePanel[]) =>
      shownPanels(COLLECTION, S1, panels).map((shown) => shown.panel)

    expect(
      compareLinksForLink(COLLECTION, S1, resolve([panel(S2), panel(P2)])),
    ).toBeUndefined()
    expect(
      compareLinksForLink(
        COLLECTION,
        S1,
        resolve([
          panel(S2),
          panel(S3, { linked: true, offset: { x: 1, y: 2, zoom: 0.5 } }),
          panel(P2, LINKED),
        ]),
      ),
    ).toEqual([null, { linked: true, values: [1, 2, 0.5] }, { linked: true }])
    expect(
      compareLinksForLink(
        COLLECTION,
        S1,
        resolve([panel(S2, UNLINKED), panel(P2, { linked: false, view: MAIN })]),
      ),
    ).toEqual([{ linked: false }, { linked: false, values: [100, -50, 2] }])
  })

  it('reads compare= and compareLink= into panels', () => {
    expect(
      comparePanelsFromLink(
        [S2, S3, P2, S4],
        [
          { linked: true, values: [1, 2, 0.5] },
          null,
          { linked: false, values: [100, -50, 2] },
        ],
      ),
    ).toEqual([
      { url: S2, link: { linked: true, offset: { x: 1, y: 2, zoom: 0.5 } } },
      { url: S3, link: null },
      { url: P2, link: { linked: false, view: MAIN } },
      { url: S4, link: null },
    ])
    expect(comparePanelsFromLink([S2], [{ linked: false }])).toEqual([
      { url: S2, link: UNLINKED },
    ])
    expect(comparePanelsFromLink(undefined, undefined)).toEqual([])
  })

  it('keeps which panels draw their cell boundaries (plan 30-D9)', () => {
    expect(
      comparePanelsFromLink([S2, S3], [null, null], undefined, undefined, [false, true]),
    ).toEqual([
      { url: S2, link: null },
      { url: S3, link: null, boundaries: true },
    ])
    expect(compareBoundariesForLink([panel(S2), panel(S3)])).toBeUndefined()
    expect(
      compareBoundariesForLink([panel(S2), { ...panel(S3), boundaries: true }]),
    ).toEqual([false, true])

    // Opening a panel's section, the open dataset takes its place, drawing
    // its outlines as the panel did.
    const shown = shownPanels(COLLECTION, S1, [
      { ...panel(S2, LINKED), boundaries: true },
    ])
    expect(panelsAfterOpening(COLLECTION, S1, shown, S2, MAIN).panels).toEqual([
      { url: S1, link: LINKED, boundaries: true },
    ])
  })
})
