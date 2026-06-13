import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewerCore } from './ViewerCore'
import { scaffoldDeckLayerCount } from './viewerCoreModel'
import type {
  CellBoundaryDatum,
  OverviewViewState,
  OverviewCellDatum,
  TranscriptPointDatum,
} from '../rendering/deckLayers'
import { asCellId } from '../data/cellid'

type MockDeckHover = (info: {
  readonly object?: unknown
  readonly x: number
  readonly y: number
}) => void
type MockDeckClick = (info: {
  readonly object?: unknown
  readonly x: number
  readonly y: number
}) => void
type MockDeckViewStateChange = (info: { readonly viewState: OverviewViewState }) => void

const deckGlMock = vi.hoisted(() => ({
  onHover: undefined as MockDeckHover | undefined,
  onClick: undefined as MockDeckClick | undefined,
  onViewStateChange: undefined as MockDeckViewStateChange | undefined,
  layers: [] as readonly unknown[],
  viewState: undefined as OverviewViewState | undefined,
}))

vi.mock('@deck.gl/react', () => ({
  DeckGL: ({
    layers = [],
    onHover,
    onClick,
    onViewStateChange,
    viewState,
  }: {
    readonly layers?: readonly unknown[]
    readonly onHover?: MockDeckHover
    readonly onClick?: MockDeckClick
    readonly onViewStateChange?: MockDeckViewStateChange
    readonly viewState?: OverviewViewState
  }) => {
    deckGlMock.onHover = onHover
    deckGlMock.onClick = onClick
    deckGlMock.onViewStateChange = onViewStateChange
    deckGlMock.layers = layers
    deckGlMock.viewState = viewState

    return (
      <div data-testid="deckgl">
        {layers.map((layer) => {
          const candidate = layer as {
            readonly id?: string
            readonly props?: {
              readonly id?: string
              readonly data?: readonly unknown[]
            }
          }
          const id = candidate.id ?? candidate.props?.id ?? 'unknown-layer'
          const data = candidate.props?.data ?? []

          return (
            <div
              key={id}
              data-testid={`deck-layer-${id}`}
              data-count={String(data.length)}
            />
          )
        })}
      </div>
    )
  },
}))

const rect = {
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  top: 0,
  right: 200,
  bottom: 100,
  left: 0,
  toJSON: () => ({}),
} as DOMRect

function boundaryPathLayerData(): {
  readonly startIndices?: Uint32Array
  readonly attributes?: {
    readonly getColor?: {
      readonly value?: Uint8Array
    }
  }
} {
  const pathLayer = deckGlMock.layers.find((layer) => {
    const candidate = layer as { readonly id?: string }

    return candidate.id === 'cell-boundary-paths'
  }) as
    | {
        readonly props?: {
          readonly data?: {
            readonly startIndices?: Uint32Array
            readonly attributes?: {
              readonly getColor?: {
                readonly value?: Uint8Array
              }
            }
          }
        }
      }
    | undefined

  return pathLayer?.props?.data ?? {}
}

function boundaryPathColorAt(pathIndex: number): readonly number[] {
  const data = boundaryPathLayerData()
  const vertexIndex = data.startIndices?.[pathIndex] ?? 0
  const colorStart = vertexIndex * 4

  return Array.from(
    data.attributes?.getColor?.value?.slice(colorStart, colorStart + 4) ?? [],
  )
}

afterEach(() => {
  deckGlMock.onHover = undefined
  deckGlMock.onClick = undefined
  deckGlMock.onViewStateChange = undefined
  deckGlMock.layers = []
  deckGlMock.viewState = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ViewerCore', () => {
  it('renders the canvas/deck surface shell', () => {
    render(<ViewerCore />)

    expect(scaffoldDeckLayerCount).toBe(1)
    expect(
      screen.getByRole('img', { name: 'Spatial viewer canvas area' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Please load a dataset')).toBeInTheDocument()
    expect(document.querySelectorAll('.cell-node')).toHaveLength(0)
    expect(document.querySelector('canvas.morphology-canvas')).toBeInTheDocument()
  })

  it('hides the empty dataset prompt while a dataset is loading', () => {
    render(<ViewerCore status="loading" />)

    expect(screen.queryByText('Please load a dataset')).not.toBeInTheDocument()
    expect(screen.getByText('Loading overview cells…')).toBeInTheDocument()
  })

  it('applies image opacity to the morphology canvas', () => {
    render(<ViewerCore imageOpacity={0.4} />)

    expect(document.querySelector('canvas.morphology-canvas')).toHaveStyle({
      opacity: '0.4',
    })
  })

  it('renders loading tasks and viewport status in the same notification stack', () => {
    render(
      <ViewerCore
        loadingTasks={[{ id: 'gene-panel', label: 'Loading gene panel' }]}
        boundaryStatus="loading"
      />,
    )

    const loadingStatus = screen.getByRole('status', {
      name: 'Active loading tasks',
    })
    const viewportStatus = screen.getByText('Loading cell boundaries…')
    const stack = loadingStatus.closest('.viewport-notification-stack')

    expect(stack).not.toBeNull()
    expect(viewportStatus.closest('.viewport-notification-stack')).toBe(stack)
  })

  it('does not duplicate boundary loading between queued tasks and viewport status', () => {
    render(
      <ViewerCore
        loadingTasks={[{ id: 'boundaries', label: 'Loading boundaries' }]}
        boundaryStatus="loading"
      />,
    )

    expect(screen.getByText('Loading boundaries')).toBeInTheDocument()
    expect(screen.queryByText('Loading cell boundaries…')).not.toBeInTheDocument()
  })

  it('draws positive gene expression cells even when an overview proxy is already styled', () => {
    render(
      <ViewerCore
        cells={[
          {
            id: 'overview-cell-1',
            position: [0, 0, 0],
            radiusPixels: 4,
            fillColor: [215, 63, 124, 220],
          },
        ]}
        geneExpressionActive
        expressionCells={[
          {
            id: 'overview-cell-1',
            position: [0, 0, 0],
            radiusPixels: 6,
            fillColor: [240, 128, 120, 220],
            expressionCount: 5,
            expressionGenes: ['COL4A1'],
          },
        ]}
      />,
    )

    const expressionLayer = deckGlMock.layers.find((layer) => {
      const candidate = layer as { readonly id?: string }

      return candidate.id === 'gene-expression-scatter'
    }) as
      | {
          readonly props?: {
            readonly data?: readonly unknown[]
            readonly pickable?: boolean
          }
        }
      | undefined
    const cellLayer = deckGlMock.layers.find((layer) => {
      const candidate = layer as { readonly id?: string }

      return candidate.id === 'cells-overview-scatter'
    }) as
      | {
          readonly props?: {
            readonly filled?: boolean
          }
        }
      | undefined

    expect(expressionLayer?.props?.data).toHaveLength(1)
    expect(expressionLayer?.props?.pickable).toBe(false)
    expect(cellLayer?.props?.filled).toBe(true)
  })

  it('paints visible boundary polygons for gene expression instead of drawing duplicate points', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cell: OverviewCellDatum = {
      id: 'cell-1',
      position: [0, 0, 0],
      radiusPixels: 4,
      fillColor: [215, 63, 124, 220],
    }
    const boundary: CellBoundaryDatum = {
      id: 'cell-1',
      polygon: [
        [-5, -5, 0],
        [5, -5, 0],
        [5, 5, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [32, 102, 83, 190],
    }

    render(
      <ViewerCore
        cells={[cell]}
        boundaries={[boundary]}
        geneExpressionActive
        expressionCells={[
          {
            ...cell,
            fillColor: [240, 128, 120, 220],
            expressionCount: 5,
            expressionGenes: ['COL4A1'],
          },
        ]}
        initialViewStateOverride={{ target: [0, 0, 0], zoom: 0 }}
      />,
    )

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    const fillLayer = deckGlMock.layers.find((layer) => {
      const candidate = layer as { readonly id?: string }

      return candidate.id === 'cell-boundary-fills'
    }) as
      | {
          readonly props?: {
            readonly data?: {
              readonly attributes?: {
                readonly getFillColor?: { readonly value?: Uint8Array }
              }
            }
          }
        }
      | undefined
    const expressionLayer = deckGlMock.layers.find((layer) => {
      const candidate = layer as { readonly id?: string }

      return candidate.id === 'gene-expression-scatter'
    })

    expect(
      Array.from(
        fillLayer?.props?.data?.attributes?.getFillColor?.value?.slice(0, 4) ?? [],
      ),
    ).toEqual([240, 128, 120, 128])
    expect(expressionLayer).toBeUndefined()
  })

  it('omits transcript hover cell details when no cell id is present', () => {
    const transcript = transcriptDatum({
      id: 'tx-without-cell',
      cellId: null,
    })

    render(<ViewerCore cells={[overviewCellDatum()]} transcriptPoints={[transcript]} />)

    act(() => {
      deckGlMock.onHover?.({ object: transcript, x: 12, y: 20 })
    })

    expect(screen.getByText('Actb')).toBeInTheDocument()
    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('tx-without-cell')).toBeInTheDocument()
    expect(screen.queryByText('Transcript')).not.toBeInTheDocument()
    expect(screen.queryByText('Cell')).not.toBeInTheDocument()
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument()
  })

  it('shows transcript hover cell details when a cell id is present', () => {
    const transcript = transcriptDatum({
      id: 'tx-with-cell',
      transcriptId: '12',
      cellId: 'cell-1',
    })

    render(<ViewerCore cells={[overviewCellDatum()]} transcriptPoints={[transcript]} />)

    act(() => {
      deckGlMock.onHover?.({ object: transcript, x: 12, y: 20 })
    })

    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Cell')).toBeInTheDocument()
    expect(screen.getByText('cell-1')).toBeInTheDocument()
  })

  it('shows transcript hover as unassigned when Parquet confirms no cell id', () => {
    const transcript = transcriptDatum({
      id: 'tx-unassigned-cell',
      cellId: null,
      cellAssignment: 'unassigned',
    })

    render(<ViewerCore cells={[overviewCellDatum()]} transcriptPoints={[transcript]} />)

    act(() => {
      deckGlMock.onHover?.({ object: transcript, x: 12, y: 20 })
    })

    expect(screen.getByText('Cell')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('notifies when an exact transcript point is clicked', () => {
    const transcript = transcriptDatum({
      id: 'tx-clicked',
      cellId: 'cell-1',
    })
    const onTranscriptClick = vi.fn()

    render(
      <ViewerCore
        cells={[overviewCellDatum()]}
        transcriptPoints={[transcript]}
        onTranscriptClick={onTranscriptClick}
      />,
    )

    act(() => {
      deckGlMock.onClick?.({ object: transcript, x: 14, y: 22 })
    })

    expect(onTranscriptClick).toHaveBeenCalledWith({
      transcript,
      screen: { x: 14, y: 22 },
    })
  })

  it('reports debounced viewport details for boundary loading', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onViewportChange = vi.fn()

    render(
      <ViewerCore
        cells={[
          {
            id: 'cell-1',
            position: [0, 0, 0],
            radiusPixels: 4,
            fillColor: [215, 63, 124, 220],
          },
        ]}
        onViewportChange={onViewportChange}
      />,
    )

    await waitFor(() => {
      expect(onViewportChange).toHaveBeenCalled()
    })
    expect(onViewportChange.mock.calls[0]?.[0]).toMatchObject({
      visibleCellCount: 1,
    })
  })

  it('centers the spatial view when a focus request is received', async () => {
    const cells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-1',
        position: [0, 0, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      },
      {
        id: 'cell-2',
        position: [100, -80, 0],
        radiusPixels: 4,
        fillColor: [44, 132, 168, 210],
      },
    ]
    const { rerender } = render(
      <ViewerCore cells={cells} focusRequest={{ key: 1, target: [25, -30, 0] }} />,
    )

    await waitFor(() => {
      expect(deckGlMock.viewState?.target).toEqual([25, -30, 0])
    })

    rerender(
      <ViewerCore cells={cells} focusRequest={{ key: 2, target: [100, -80, 0] }} />,
    )

    await waitFor(() => {
      expect(deckGlMock.viewState?.target).toEqual([100, -80, 0])
    })
  })

  it('keeps overview cell proxies outline-only without active annotations', () => {
    render(<ViewerCore cells={[overviewCellDatum()]} />)

    const cellLayer = deckGlMock.layers.find((layer) => {
      const candidate = layer as { readonly id?: string }

      return candidate.id === 'cells-overview-scatter'
    }) as { readonly props?: { readonly filled?: boolean } } | undefined

    expect(cellLayer?.props?.filled).toBe(false)
  })

  it('fills fallback overview cell proxies for active annotation styling without boundaries', () => {
    const annotatedCell: OverviewCellDatum = {
      ...overviewCellDatum(),
      id: asCellId('aaaaaaaa-1'),
    }

    render(
      <ViewerCore
        cells={[annotatedCell]}
        observationColorMode="annotations"
        annotationStyleColors={[
          {
            id: 'annotation-1',
            cellIds: [asCellId('aaaaaaaa-1')],
            color: '#1f9b8f',
          },
        ]}
      />,
    )

    const cellLayer = deckGlMock.layers.find((layer) => {
      const candidate = layer as { readonly id?: string }

      return candidate.id === 'cells-overview-scatter'
    }) as { readonly props?: { readonly filled?: boolean } } | undefined

    expect(cellLayer?.props?.filled).toBe(true)
  })

  it('fills annotated cell boundaries instead of boundary-overlapping proxies', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const annotatedCellId = asCellId('aaaaaaaa-1')
    const annotatedCell: OverviewCellDatum = {
      ...overviewCellDatum(),
      id: annotatedCellId,
    }
    const boundary: CellBoundaryDatum = {
      id: annotatedCellId,
      polygon: [
        [-5, -5, 0],
        [5, -5, 0],
        [5, 5, 0],
        [-5, 5, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [32, 102, 83, 190],
    }

    render(
      <ViewerCore
        cells={[annotatedCell]}
        boundaries={[boundary]}
        observationColorMode="annotations"
        annotationStyleColors={[
          {
            id: 'annotation-1',
            cellIds: [annotatedCellId],
            color: '#1f9b8f',
          },
        ]}
      />,
    )

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    const fillLayer = deckGlMock.layers.find((layer) => {
      const candidate = layer as { readonly id?: string }

      return candidate.id === 'cell-boundary-fills'
    }) as
      | {
          readonly props?: {
            readonly data?: {
              readonly attributes?: {
                readonly getFillColor?: { readonly value?: Uint8Array }
              }
            }
          }
        }
      | undefined
    const cellLayer = deckGlMock.layers.find((layer) => {
      const candidate = layer as { readonly id?: string }

      return candidate.id === 'cells-overview-scatter'
    }) as
      | {
          readonly props?: {
            readonly data?: readonly unknown[]
            readonly filled?: boolean
          }
        }
      | undefined

    expect(fillLayer).toBeDefined()
    expect(
      Array.from(
        fillLayer?.props?.data?.attributes?.getFillColor?.value?.slice(0, 4) ?? [],
      ),
    ).toEqual([31, 155, 143, 128])
    expect(cellLayer?.props?.filled).toBe(true)
    expect(cellLayer?.props?.data).toEqual([])
  })

  it('defers boundary expression restyling until viewport movement is idle', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells: readonly OverviewCellDatum[] = [
      {
        id: 'cell-1',
        position: [0, 0, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      },
      {
        id: 'cell-2',
        position: [1000, 0, 0],
        radiusPixels: 4,
        fillColor: [44, 132, 168, 210],
      },
    ]
    const boundaries: readonly CellBoundaryDatum[] = [
      {
        id: 'cell-1',
        polygon: [
          [-5, -5, 0],
          [5, -5, 0],
          [5, 5, 0],
        ],
        fillColor: [32, 102, 83, 34],
        lineColor: [246, 242, 232, 210],
      },
      {
        id: 'cell-2',
        polygon: [
          [995, -5, 0],
          [1005, -5, 0],
          [1005, 5, 0],
        ],
        fillColor: [32, 102, 83, 34],
        lineColor: [246, 242, 232, 210],
      },
    ]
    const expressionCells: readonly OverviewCellDatum[] = [
      {
        ...cells[0]!,
        fillColor: [240, 128, 120, 220],
      },
      {
        ...cells[1]!,
        fillColor: [63, 165, 91, 220],
      },
    ]

    render(
      <ViewerCore
        cells={cells}
        boundaries={boundaries}
        expressionCells={expressionCells}
        initialViewStateOverride={{ target: [0, 0, 0], zoom: 0 }}
      />,
    )

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    expect(boundaryPathColorAt(0)).toEqual([240, 128, 120, 220])
    expect(boundaryPathColorAt(1)).toEqual([44, 132, 168, 210])

    const currentViewState = deckGlMock.viewState

    if (currentViewState === undefined) {
      throw new Error('Expected DeckGL view state.')
    }

    await act(async () => {
      deckGlMock.onViewStateChange?.({
        viewState: {
          ...currentViewState,
          target: [1000, 0, 0],
        },
      })
    })

    expect(boundaryPathColorAt(0)).toEqual([240, 128, 120, 220])
    expect(boundaryPathColorAt(1)).toEqual([44, 132, 168, 210])

    await act(async () => {
      vi.advanceTimersByTime(159)
    })

    expect(boundaryPathColorAt(0)).toEqual([240, 128, 120, 220])
    expect(boundaryPathColorAt(1)).toEqual([44, 132, 168, 210])

    await act(async () => {
      vi.advanceTimersByTime(1)
    })

    expect(boundaryPathColorAt(0)).toEqual([215, 63, 124, 220])
    expect(boundaryPathColorAt(1)).toEqual([63, 165, 91, 220])
  })

  it('supports keyboard panning and zooming on the spatial view', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onViewportChange = vi.fn()

    render(
      <ViewerCore
        cells={[
          {
            id: 'cell-1',
            position: [0, 0, 0],
            radiusPixels: 4,
            fillColor: [215, 63, 124, 220],
          },
        ]}
        onViewportChange={onViewportChange}
      />,
    )

    const frame = screen.getByRole('img', { name: 'Spatial viewer canvas area' })
    expect(frame).toHaveAttribute('tabindex', '0')

    await waitFor(() => {
      expect(onViewportChange).toHaveBeenCalled()
    })

    const initialZoom = onViewportChange.mock.calls.at(-1)?.[0].viewState.zoom
    onViewportChange.mockClear()
    fireEvent.keyDown(frame, { key: '+' })

    await waitFor(() => {
      const nextZoom = onViewportChange.mock.calls.at(-1)?.[0].viewState.zoom
      expect(nextZoom).toBeGreaterThan(initialZoom)
    })
  })

  it('reports a broad-zoom viewport cell estimate without waiting for render clipping', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      ...rect,
      width: 300,
      height: 300,
      right: 300,
      bottom: 300,
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onViewportCellCountChange = vi.fn()
    const cells = Array.from(
      { length: 100 },
      (_value, index): OverviewCellDatum => ({
        id: `cell-${index}`,
        position: [(index % 10) * 1000, -Math.floor(index / 10) * 1000, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      }),
    )

    render(
      <ViewerCore cells={cells} onViewportCellCountChange={onViewportCellCountChange} />,
    )

    await waitFor(() => {
      expect(onViewportCellCountChange).toHaveBeenCalledWith(expect.any(Number) as number)
      expect(onViewportCellCountChange).toHaveBeenLastCalledWith(17)
    })
  })

  it('tracks mouse coordinates in micrometers and image pixels', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells: OverviewCellDatum[] = [
      {
        id: 'cell-1',
        position: [1234, -5678, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      },
    ]
    const { rerender } = render(<ViewerCore cells={cells} />)
    const frame = screen.getByRole('img', { name: 'Spatial viewer canvas area' })

    expect(await screen.findByLabelText('Scale bar 5 μm')).toBeInTheDocument()
    expect(document.querySelector('.viewport-scale-bar-track')).toHaveStyle({
      width: '80px',
    })

    fireEvent.pointerMove(frame, { clientX: 100, clientY: 50 })

    expect(await screen.findByText('X 1234 μm | Y 5678 μm')).toBeInTheDocument()

    rerender(<ViewerCore cells={cells} coordinateUnit="px" micrometersPerPixel={0.5} />)
    expect(await screen.findByLabelText('Scale bar 10 px')).toBeInTheDocument()
    fireEvent.pointerMove(frame, { clientX: 100, clientY: 50 })

    expect(await screen.findByText('X 2468 px | Y 11356 px')).toBeInTheDocument()

    fireEvent.pointerLeave(frame)

    await waitFor(() => {
      expect(screen.queryByText('X 2468 px | Y 11356 px')).not.toBeInTheDocument()
    })
  })

  it('draws and clears a distance measurement in micrometers and image pixels', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells = [overviewCellDatum()]
    const { rerender } = render(
      <ViewerCore
        cells={cells}
        measurementEnabled
        initialViewStateOverride={{ target: [0, 0, 0], zoom: -4 }}
      />,
    )
    const measurementLayer = document.querySelector('.measurement-draw-layer')

    if (!(measurementLayer instanceof HTMLElement)) {
      throw new Error('Expected measurement draw layer.')
    }

    fireEvent.pointerDown(measurementLayer, {
      clientX: 100,
      clientY: 50,
      pointerId: 1,
    })
    fireEvent.pointerMove(measurementLayer, {
      clientX: 116,
      clientY: 50,
      pointerId: 1,
    })

    expect(await screen.findByText('256 μm')).toBeInTheDocument()

    fireEvent.pointerUp(measurementLayer, {
      clientX: 116,
      clientY: 50,
      pointerId: 1,
    })

    expect(screen.getByText('256 μm')).toBeInTheDocument()

    rerender(
      <ViewerCore
        cells={cells}
        measurementEnabled
        measurementUnit="px"
        measurementResetKey={0}
        micrometersPerPixel={0.5}
        initialViewStateOverride={{ target: [0, 0, 0], zoom: -4 }}
      />,
    )

    expect(await screen.findByText('512 px')).toBeInTheDocument()

    rerender(
      <ViewerCore
        cells={cells}
        measurementEnabled
        measurementUnit="px"
        measurementResetKey={1}
        micrometersPerPixel={0.5}
        initialViewStateOverride={{ target: [0, 0, 0], zoom: -4 }}
      />,
    )

    await waitFor(() => {
      expect(screen.queryByText('512 px')).not.toBeInTheDocument()
    })
  })

  it('reports cursor magic lens movement and renders the lens overlay', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onMagicLensMove = vi.fn()
    const cells: OverviewCellDatum[] = [
      {
        id: 'cell-1',
        position: [1234, -5678, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      },
    ]

    render(
      <ViewerCore
        cells={cells}
        magicLensActive
        magicLensRadiusMicrometers={40}
        magicLensStatus="ready"
        magicLensSummary={{
          transcriptCount: 2,
          cellCount: 1,
          geneCount: 1,
          selectedGeneTranscriptCount: 2,
          topGenes: [{ gene: 'Actb', count: 2, selected: true }],
          hitLimit: false,
        }}
        onMagicLensMove={onMagicLensMove}
      />,
    )

    const frame = screen.getByRole('img', { name: 'Spatial viewer canvas area' })
    fireEvent.pointerMove(frame, { clientX: 100, clientY: 50 })

    await waitFor(() => {
      expect(onMagicLensMove).toHaveBeenCalledWith(
        expect.objectContaining({
          radiusMicrometers: 40,
          bbox: expect.objectContaining({
            minX: 1194,
            maxX: 1274,
            minY: 5638,
            maxY: 5718,
          }),
        }),
      )
    })
    expect(document.querySelector('.viewer-magic-lens-circle')).toBeInTheDocument()
    expect(document.querySelector('.viewer-magic-lens-hud')).toHaveTextContent(
      '1 cells - 2 tx',
    )
  })

  it('emits a data-space bounding box after drawing a box ROI', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onRoiComplete = vi.fn()

    render(<ViewerCore roiMode="box" onRoiComplete={onRoiComplete} />)

    const roiLayer = document.querySelector('.roi-draw-layer')

    if (!(roiLayer instanceof HTMLElement)) {
      throw new Error('Expected ROI draw layer.')
    }

    fireEvent.pointerDown(roiLayer, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(roiLayer, { clientX: 116, clientY: 66, pointerId: 1 })

    expect(document.querySelector('.roi-rectangle')).toHaveStyle({
      left: '100px',
      top: '50px',
      width: '16px',
      height: '16px',
    })

    fireEvent.pointerUp(roiLayer, { clientX: 116, clientY: 66, pointerId: 1 })

    const selection = onRoiComplete.mock.calls[0]?.[0]
    expect(selection).toMatchObject({
      kind: 'box',
      bbox: {
        minX: 0,
        maxX: 256,
        minY: 0,
        maxY: 256,
      },
    })
  })

  it('emits a lasso ROI selection from a dragged polygon path', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onRoiComplete = vi.fn()

    render(<ViewerCore roiMode="lasso" onRoiComplete={onRoiComplete} />)

    const roiLayer = document.querySelector('.roi-draw-layer')

    if (!(roiLayer instanceof HTMLElement)) {
      throw new Error('Expected ROI draw layer.')
    }

    fireEvent.pointerDown(roiLayer, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(roiLayer, { clientX: 116, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(roiLayer, { clientX: 116, clientY: 66, pointerId: 1 })

    expect(document.querySelector('.roi-lasso-path')).toBeInTheDocument()

    fireEvent.pointerUp(roiLayer, { clientX: 100, clientY: 66, pointerId: 1 })

    const selection = onRoiComplete.mock.calls[0]?.[0]
    expect(selection).toMatchObject({
      kind: 'lasso',
      bbox: {
        minX: 0,
        maxX: 256,
        minY: 0,
        maxY: 256,
      },
    })
    expect(selection.points).toHaveLength(4)
  })
})

function overviewCellDatum(): OverviewCellDatum {
  return {
    id: 'overview-cell-1',
    position: [0, 0, 0],
    radiusPixels: 4,
    fillColor: [215, 63, 124, 220],
  }
}

function transcriptDatum({
  id,
  transcriptId,
  cellId,
  cellAssignment,
}: {
  readonly id: string
  readonly transcriptId?: string
  readonly cellId: string | null
  readonly cellAssignment?: TranscriptPointDatum['cellAssignment']
}): TranscriptPointDatum {
  return {
    id,
    ...(transcriptId === undefined ? {} : { transcriptId }),
    position: [10, -20, 0],
    featureName: 'Actb',
    fovName: 'FOV-1',
    cellId,
    ...(cellAssignment === undefined ? {} : { cellAssignment }),
    qv: 31,
    fillColor: [255, 200, 80, 220],
  }
}
