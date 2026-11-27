import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LinkedViewChannel } from '../../components/linkedView'
import type { DatasetCollectionEntry } from '../../datasets/datasetCollection'
import { previewBounds, type PreviewCells } from './collectionPreviewData'
import type { CollectionPreviewStore, PreviewEntry } from './collectionPreviewStore'
import { LinkedSections, type LinkedSectionsColoring } from './LinkedSections'
import { LINKED } from './linkedSectionsModel'
import { SectionStackViewer } from './SectionStackViewer'

interface DeckProps {
  readonly views?: { readonly id?: string }
  readonly onHover?: (info: unknown) => void
  readonly viewState?: { readonly rotationX?: number; readonly rotationOrbit?: number }
  readonly onViewStateChange?: (change: { readonly viewState: unknown }) => void
  readonly layers?: readonly { readonly id: string }[]
}

// deck.gl has no WebGL in jsdom: each render of a DeckGL is recorded.
const deck = vi.hoisted(() => ({
  renders: [] as { readonly viewId: string; readonly props: DeckProps }[],
}))

vi.mock('@deck.gl/react', () => ({
  DeckGL: (props: DeckProps) => {
    deck.renders.push({ viewId: props.views?.id ?? '', props })
    return <div data-testid="deckgl" />
  },
}))

const NO_ENTRY: PreviewEntry = {
  cells: null,
  scores: null,
  classes: null,
  values: null,
  loading: false,
  unavailable: null,
  error: null,
}

// A store that hands out the same entry objects, and never changes.
function fakeStore(entries: Readonly<Record<string, Partial<PreviewEntry>>>) {
  const built = new Map<string, PreviewEntry>()

  return {
    subscribe: () => () => undefined,
    getVersion: () => 0,
    valueRange: <T,>(track: T): T => track,
    entry: (url: string): PreviewEntry => {
      let entry = built.get(url)
      if (entry === undefined) {
        entry = { ...NO_ENTRY, ...entries[url] }
        built.set(url, entry)
      }
      return entry
    },
  } as unknown as CollectionPreviewStore
}

function entryFor(name: string): DatasetCollectionEntry {
  return {
    path: `${name}.h5ad`,
    url: `https://example.test/${name}.h5ad`,
    name,
    coordinateSystem: 'block',
  }
}

function cellsAt(
  points: readonly (readonly [number, number])[],
  depths: readonly number[],
): PreviewCells {
  const positions = new Float32Array(points.flat())
  const bounds = previewBounds(positions)
  if (bounds === null) throw new Error('Expected cells.')
  return {
    positions,
    cellIds: points.map((_point, index) => `cell-${index}`),
    bounds,
    depths: {
      values: Float32Array.from(depths),
      min: Math.min(...depths),
      max: Math.max(...depths),
    },
  }
}

const COLORING: LinkedSectionsColoring = {
  genes: [],
  colorScale: 'plasma',
  scaleRange: { min: null, max: null },
  annotations: null,
  metadata: null,
}
const SECTION = entryFor('s1')

function CellView({
  depths,
  coloring = COLORING,
  entry = {},
  onClose = vi.fn(),
}: {
  readonly depths: readonly number[]
  readonly coloring?: LinkedSectionsColoring
  readonly entry?: Partial<PreviewEntry>
  readonly onClose?: () => void
}) {
  const cells = cellsAt(
    [
      [0, 0],
      [100, 50],
      [200, 80],
    ].slice(0, depths.length) as [number, number][],
    depths,
  )
  return (
    <SectionStackViewer
      mode="cells"
      sections={[{ entry: SECTION, z: 0 }]}
      store={fakeStore({ [SECTION.url]: { cells, ...entry } })}
      coloring={coloring}
      cellPointScale={1}
      hoverTooltips
      onClose={onClose}
    />
  )
}

describe('SectionStackViewer', () => {
  // A new view state on each render redrew every cell on each hover
  // (EXP-247).
  it('gives deck.gl the same props while hovering before the first drag', () => {
    deck.renders.length = 0
    render(<CellView depths={[0, 5, 10]} />)
    const stackRenders = () =>
      deck.renders.filter(({ viewId }) => viewId === 'section-stack')
    const before = stackRenders().length
    const first = stackRenders().at(-1)?.props

    for (const x of [20, 21, 22]) {
      act(() => {
        first?.onHover?.({ index: 1, x, y: 10, layer: { id: 'section-stack-0-cells' } })
      })
    }

    expect(screen.getByText(/z 5 µm/)).toBeInTheDocument()
    expect(stackRenders()).toHaveLength(before)
  })

  it('moves from the keyboard on its named canvas, and Home resets it (EXP-319)', () => {
    deck.renders.length = 0
    render(<CellView depths={[0, 5, 10]} />)
    const canvas = screen.getByRole('img', { name: '3D cells canvas area' })
    const shown = () =>
      deck.renders.filter(({ viewId }) => viewId === 'section-stack').at(-1)?.props

    expect(canvas).toHaveAttribute('tabindex', '0')
    expect(canvas).toHaveAccessibleDescription(
      'Shift+arrows rotate · Arrows pan · + and − zoom · X, Y, Z look along an axis · Home resets',
    )
    const fitted = shown()?.viewState
    act(() => {
      shown()?.onViewStateChange?.({ viewState: { ...fitted, rotationOrbit: 90 } })
    })
    expect(shown()?.viewState?.rotationOrbit).toBe(90)
    fireEvent.keyDown(canvas, { key: 'Home', code: 'Home' })
    expect(shown()?.viewState).toEqual(fitted)
  })

  it('turns to look along an axis it is clicked on', () => {
    deck.renders.length = 0
    const { container } = render(<CellView depths={[0, 5, 10]} />)
    const shown = () =>
      deck.renders.filter(({ viewId }) => viewId === 'section-stack').at(-1)?.props

    fireEvent.click(container.querySelector('.orbit-axis-y')!)

    // Side on, z up.
    expect(shown()?.viewState).toMatchObject({ rotationX: -90, rotationOrbit: 0 })
  })

  it('colours the cells by a metadata track, with its range beside them', () => {
    deck.renders.length = 0
    const metadata = { id: 'h5ad:qv', label: 'qv', min: 7.5, max: 40 }
    render(
      <CellView
        depths={[0, 5, 10]}
        coloring={{ ...COLORING, genes: ['Aqp4'], metadata }}
        entry={{
          values: {
            values: Float64Array.of(7.5, Number.NaN, 40),
            count: 2,
            min: 7.5,
            max: 40,
          },
        }}
      />,
    )
    const layers = deck.renders.filter(({ viewId }) => viewId === 'section-stack').at(-1)
      ?.props.layers

    expect(layers?.map(({ id }) => id)).toEqual([
      'section-stack-0-values',
      'section-stack-0-context',
    ])
    const scale = screen.getByTitle(/qv from its lowest to its highest value/)
    expect(scale).toHaveTextContent('qv7.540')
    // The track, not the genes, colours the cells.
    expect(screen.queryByText('Aqp4')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Other cells' })).toHaveAttribute(
      'title',
      expect.stringContaining('without a value of qv'),
    )
  })

  it('says the colours are being read while the track is', () => {
    render(
      <CellView
        depths={[0, 5]}
        coloring={{
          ...COLORING,
          metadata: { id: 'h5ad:qv', label: 'qv', min: 0, max: 1 },
        }}
        entry={{ loading: true }}
      />,
    )

    expect(screen.getByText('Reading colours')).toBeInTheDocument()
  })

  // (-0.04).toFixed(1) is "-0.0", written "-0" (EXP-248).
  it('writes a z range starting just below zero from 0', () => {
    render(<CellView depths={[-0.04, 780]} />)

    expect(screen.getByText(/ cells, z /)).toHaveTextContent('2 cells, z 0 to 780 µm')
  })

  // Focus fell to the page when 2D View removed itself (EXP-249).
  it('hands focus back to the control that opened it on 2D View', async () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button
            type="button"
            title="Open the 3D view"
            onClick={() => {
              setOpen(true)
            }}
          >
            3D
          </button>
          {open ? (
            <CellView
              depths={[0, 5]}
              onClose={() => {
                setOpen(false)
              }}
            />
          ) : null}
        </>
      )
    }

    render(<Host />)
    const opener = screen.getByRole('button', { name: '3D' })
    opener.focus()
    fireEvent.click(opener)
    const back = screen.getByRole('button', { name: '2D View' })
    back.focus()
    fireEvent.click(back)
    await act(async () => {})

    expect(document.activeElement).toBe(opener)
  })
})

describe('LinkedSections', () => {
  it('hands focus back to the control that opened a panel when it closes', async () => {
    const entry = entryFor('s2')

    function Host() {
      const [shown, setShown] = useState<readonly DatasetCollectionEntry[]>([])
      return (
        <>
          <button
            type="button"
            title="Show s2 beside the main view"
            onClick={() => {
              setShown([entry])
            }}
          >
            Show s2 beside
          </button>
          <LinkedSections
            panels={shown.map((shownEntry) => ({
              entry: shownEntry,
              panel: { url: shownEntry.url, link: LINKED },
            }))}
            store={fakeStore({
              [entry.url]: {
                cells: cellsAt(
                  [
                    [0, 0],
                    [10, 10],
                  ],
                  [0, 0],
                ),
              },
            })}
            channel={new LinkedViewChannel()}
            coloring={COLORING}
            cellPointScale={1}
            pointSizeFullViewScale={1}
            hoverTooltips
            onOpen={vi.fn()}
            onClose={() => {
              setShown([])
            }}
            onLinkChange={vi.fn()}
            onViewReport={vi.fn()}
          />
        </>
      )
    }

    render(<Host />)
    const opener = screen.getByRole('button', { name: 'Show s2 beside' })
    opener.focus()
    fireEvent.click(opener)
    const close = screen.getByRole('button', { name: 'Close s2' })
    close.focus()
    fireEvent.click(close)
    await act(async () => {})

    expect(document.activeElement).toBe(opener)
  })
})
