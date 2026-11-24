import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LinkedViewChannel } from './linkedView'
import { ViewerCore, type ViewerViewportDetail } from './ViewerCore'
import { scaffoldDeckLayerCount } from './viewerCoreModel'
import type {
  CellBoundaryDatum,
  GridCellDatum,
  OverviewViewState,
  OverviewCellDatum,
  TranscriptPointDatum,
} from '../rendering/deckLayers'
import { asCellId } from '../data/cellid'
import { micrometers } from '../data/coords'
import type { RoiSelection } from '../data/roiSelection'
import type { TiffPyramidLoader } from '../tiff/loader'
import {
  EMPTY_GRID_CELL_COLUMNS,
  gridCellAt,
  type GridCellColumns,
} from '../rendering/gridCellColumns'
import {
  gridCellColumnsFixture,
  squareGridBasis,
  type GridCellFixtureBin,
} from '../test/gridCellColumnsFixture'

type MockDeckHover = (info: {
  readonly layer?: { readonly id: string }
  readonly object?: unknown
  readonly x: number
  readonly y: number
}) => void
type MockDeckClick = (info: {
  readonly layer?: { readonly id: string }
  readonly object?: unknown
  readonly x: number
  readonly y: number
}) => void
type MockDeckViewStateChange = (info: { readonly viewState: OverviewViewState }) => void

const deckGlMock = vi.hoisted(() => ({
  onHover: undefined as MockDeckHover | null | undefined,
  onClick: undefined as MockDeckClick | undefined,
  eventRecognizerOptions: undefined as unknown,
  onViewStateChange: undefined as MockDeckViewStateChange | undefined,
  layers: [] as readonly unknown[],
  viewState: undefined as OverviewViewState | undefined,
  renderCount: 0,
}))

vi.mock('@deck.gl/react', () => ({
  DeckGL: ({
    layers = [],
    onHover,
    onClick,
    eventRecognizerOptions,
    onViewStateChange,
    viewState,
  }: {
    readonly layers?: readonly unknown[]
    readonly onHover?: MockDeckHover | null
    readonly onClick?: MockDeckClick
    readonly eventRecognizerOptions?: unknown
    readonly onViewStateChange?: MockDeckViewStateChange
    readonly viewState?: OverviewViewState
  }) => {
    deckGlMock.renderCount += 1
    deckGlMock.onHover = onHover
    deckGlMock.onClick = onClick
    deckGlMock.eventRecognizerOptions = eventRecognizerOptions
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
  deckGlMock.eventRecognizerOptions = undefined
  deckGlMock.onViewStateChange = undefined
  deckGlMock.layers = []
  deckGlMock.viewState = undefined
  deckGlMock.renderCount = 0
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

  it('dismisses an error message until a different error replaces it', () => {
    const { rerender } = render(
      <ViewerCore
        imageStatus="error"
        imageErrorMessage="Network request failed: Failed to fetch"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText('Network request failed: Failed to fetch')).toBeNull()

    rerender(
      <ViewerCore imageStatus="error" imageErrorMessage="HTTP 500 response: HTTP 500" />,
    )

    expect(screen.getByText('HTTP 500 response: HTTP 500')).toBeInTheDocument()
  })

  it('renders grid-cell polygons without overview cells', () => {
    render(<ViewerCore gridCells={gridCellColumns()} />)

    expect(screen.getByTestId('deckgl')).toBeInTheDocument()
    expect(screen.getByTestId('deck-layer-spatial-grid-cells')).toHaveAttribute(
      'data-count',
      '1',
    )
    expect(deckGlMock.viewState?.target).toEqual([8, -8, 0])
    expect(deckGlMock.viewState?.zoom).toBe(4)
    expect(screen.queryByText('Please load a dataset')).not.toBeInTheDocument()
  })

  it('fits the initial view from an image extent without cells or grid cells', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    render(
      <ViewerCore
        imageLoader={imageLoaderFixture()}
        fitImageExtent={{
          minX: micrometers(0),
          maxX: micrometers(100),
          minY: micrometers(0),
          maxY: micrometers(50),
        }}
      />,
    )

    expect(deckGlMock.viewState?.target).toEqual([50, -25, 0])
    expect(deckGlMock.viewState?.zoom).toBeCloseTo(Math.log2(720 / 100))
    expect(screen.queryByText('Please load a dataset')).not.toBeInTheDocument()
  })

  it('renders geometric annotations as polygon overlays', () => {
    render(
      <ViewerCore
        geometricAnnotations={[
          {
            id: 'shape-1:0',
            annotationId: 'shape-1',
            label: 'Shape 1',
            polygon: [
              [
                [0, 0, 0],
                [20, 0, 0],
                [20, -10, 0],
                [0, -10, 0],
              ],
            ],
            fillColor: [31, 119, 180, 42],
            lineColor: [31, 119, 180, 230],
          },
        ]}
      />,
    )

    expect(screen.getByTestId('deck-layer-geometric-annotations')).toHaveAttribute(
      'data-count',
      '1',
    )
  })

  it('draws whole grids and leaves off-screen bins to the GPU', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const nearGridCells = gridCellColumns()
    const gridCells = gridCellColumns([{}, { id: 'BC-far', col: 70 }])

    render(
      <ViewerCore
        fitGridCells={nearGridCells}
        gridCells={gridCells}
        initialViewStateOverride={{ target: [8, -8, 0], zoom: 4 }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('deck-layer-spatial-grid-cells')).toHaveAttribute(
        'data-count',
        '2',
      )
    })

    expect(gridLayerCells().map((cell) => cell.id)).toEqual(['BC-1', 'BC-far'])
  })

  it('shares its view with the panels of registered sections beside it', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const channel = new LinkedViewChannel()

    render(
      <ViewerCore
        cells={[overviewCellDatum()]}
        initialViewStateOverride={{ target: [0, 0, 0], zoom: 4 }}
        linkedView={channel}
      />,
    )

    // Its view is published as soon as it has one.
    await waitFor(() => {
      expect(channel.getView()).toEqual({ target: [0, 0], zoom: 4 })
    })

    act(() => {
      deckGlMock.onViewStateChange?.({
        viewState: { target: [8, -8, 0], zoom: 5, minZoom: -10, maxZoom: 10 },
      })
    })
    expect(channel.getView()).toEqual({ target: [8, -8], zoom: 5 })

    // A panel moves the view by a fraction of a data unit; the viewer follows
    // it exactly.
    act(() => {
      channel.publish({ target: [8.25, -8], zoom: 7.5 }, 'panel')
    })
    expect(deckGlMock.viewState?.target).toEqual([8.25, -8, 0])
    expect(deckGlMock.viewState?.zoom).toBe(7.5)
    // Following it publishes nothing new.
    expect(channel.source).toBe('panel')

    // Beyond the viewer's zoom limits, the viewer stops at its limit and the
    // panels follow that.
    act(() => {
      channel.publish({ target: [8.25, -8], zoom: 14 }, 'panel')
    })
    expect(deckGlMock.viewState?.zoom).toBe(10)
    expect(channel.getView()?.zoom).toBe(10)
  })

  it('keeps overview point render data stable when viewport clipping is disabled', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const nearCell = overviewCellDatum()
    const farCell: OverviewCellDatum = {
      ...overviewCellDatum(),
      id: 'far-overview-cell',
      position: [1000, -1000, 0],
    }

    render(
      <ViewerCore
        cells={[nearCell, farCell]}
        fitCells={[nearCell]}
        clipOverviewCellsToViewport={false}
        initialViewStateOverride={{ target: [0, 0, 0], zoom: 4 }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('deck-layer-cells-overview-scatter')).toHaveAttribute(
        'data-count',
        '2',
      )
    })

    act(() => {
      deckGlMock.onViewStateChange?.({
        viewState: {
          target: [8, -8, 0],
          zoom: 5,
          minZoom: -8,
          maxZoom: 12,
        },
      })
    })

    expect(screen.getByTestId('deck-layer-cells-overview-scatter')).toHaveAttribute(
      'data-count',
      '2',
    )
  })

  it('renders every overview point when the render limit is disabled', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells: readonly OverviewCellDatum[] = Array.from(
      { length: 10 },
      (_value, index) => ({
        ...overviewCellDatum(),
        id: `overview-cell-${index}`,
        position: [index * 10, -index * 10, 0],
      }),
    )

    render(
      <ViewerCore
        cells={cells}
        fitCells={[cells[0] as OverviewCellDatum]}
        clipOverviewCellsToViewport={false}
        overviewRenderCellLimit={null}
        initialViewStateOverride={{ target: [0, 0, 0], zoom: 8 }}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('deck-layer-cells-overview-scatter')).toHaveAttribute(
        'data-count',
        '10',
      )
    })
  })

  it('samples every-cell overview points only while the view moves', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells: readonly OverviewCellDatum[] = Array.from(
      { length: 10 },
      (_value, index) => ({
        ...overviewCellDatum(),
        id: `overview-cell-${index}`,
        position: [index, -index, 0],
      }),
    )
    const sampledFraction = () => {
      const layer = deckGlMock.layers.find(
        (candidate) =>
          (candidate as { readonly id?: string }).id === 'cells-overview-scatter',
      ) as { readonly props?: { readonly filterRange?: number[][] } } | undefined

      return layer?.props?.filterRange?.[0]?.[1]
    }
    const moveTo = (x: number) => {
      act(() => {
        deckGlMock.onViewStateChange?.({
          viewState: { target: [x, -4, 0], zoom: 4, minZoom: -8, maxZoom: 12 },
        })
      })
    }

    render(
      <ViewerCore
        cells={cells}
        fitCells={cells}
        clipOverviewCellsToViewport={false}
        overviewRenderCellLimit={null}
        movingOverviewRenderCellLimit={4}
        initialViewStateOverride={{ target: [4, -4, 0], zoom: 4 }}
      />,
    )
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    expect(sampledFraction()).toBe(1)

    // Each frame of a pan draws 4 of the 10 cells, from the first one on.
    moveTo(5)
    expect(sampledFraction()).toBeCloseTo(0.4)
    await act(async () => {
      vi.advanceTimersByTime(150)
    })
    moveTo(6)
    await act(async () => {
      vi.advanceTimersByTime(150)
    })
    expect(sampledFraction()).toBeCloseTo(0.4)

    // Once the view keeps still, every cell draws again.
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(sampledFraction()).toBe(1)
  })

  it('renders selected 2um grid cells as coarse 16um bins until close zoom', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const gridCells = twoMicrometerGridCells(8)

    const onGridCellClick = vi.fn()
    render(
      <ViewerCore
        fitGridCells={twoMicrometerGridCells(1)}
        gridCells={gridCells}
        initialViewStateOverride={{ target: [8, -8, 0], zoom: 0 }}
        onGridCellClick={onGridCellClick}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('deck-layer-spatial-grid-cells')).toHaveAttribute(
        'data-count',
        '1',
      )
    })

    const renderCell = gridLayerCells()[0]

    expect(renderCell).toMatchObject({
      id: 'render-lod-16um:0:0',
      binSizeMicrometers: 16,
      renderLodSourceBinSizeMicrometers: 2,
    })

    act(() => {
      deckGlMock.onClick?.({
        object: renderCell,
        x: 18,
        y: 24,
      })
      deckGlMock.onHover?.({
        object: renderCell,
        x: 18,
        y: 24,
      })
    })

    expect(onGridCellClick).not.toHaveBeenCalled()
    expect(screen.queryByText('render-lod-16um:0:0')).not.toBeInTheDocument()
  })

  it('suppresses expression dots while keeping grid-cell expression fills', () => {
    render(
      <ViewerCore
        geneExpressionActive
        geneExpressionOverlayEnabled={false}
        gridCells={gridCellColumns()}
        expressionElements={[
          {
            id: 'BC-1',
            position: [8, -8, 0],
            radiusPixels: 6,
            fillColor: [240, 128, 120, 220],
            expressionCount: 7,
            expressionGenes: ['Actb'],
          },
        ]}
      />,
    )

    const expressionLayer = deckGlMock.layers.find((layer) => {
      const candidate = layer as { readonly id?: string }

      return candidate.id === 'gene-expression-scatter'
    })
    expect(expressionLayer).toBeUndefined()
    expect(gridLayerCells()[0]).toMatchObject({
      id: 'BC-1',
      fillColor: [240, 128, 120, 220],
      expressionCount: 7,
      expressionGenes: ['Actb'],
    })
  })

  it('keeps true boundary strokes visible when cell fills are disabled', () => {
    const cell: OverviewCellDatum = {
      ...overviewCellDatum(),
      id: asCellId('aaaaaaaa-1'),
      fillColor: [32, 102, 83, 220],
    }
    const boundary: CellBoundaryDatum = {
      id: cell.id,
      polygon: [
        [-5, -5, 0],
        [5, -5, 0],
        [5, 5, 0],
        [-5, 5, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [174, 241, 214, 230],
    }

    render(<ViewerCore cells={[cell]} boundaries={[boundary]} cellBoundaryOpacity={1} />)

    expect(boundaryPathColorAt(0)).toEqual([174, 241, 214, 230])
  })

  it('keeps the current zoom when rendered grid cells are toggled with a stable fit', () => {
    const gridCells = gridCellColumns()
    const boundary: CellBoundaryDatum = {
      id: 'cellid_000000001-1',
      polygon: [
        [0, 0, 0],
        [16, 0, 0],
        [16, -16, 0],
        [0, -16, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [32, 102, 83, 190],
    }
    const { rerender } = render(
      <ViewerCore
        gridCells={gridCells}
        fitGridCells={gridCells}
        boundaries={[boundary]}
        viewResetKey="dataset:visium"
      />,
    )

    act(() => {
      deckGlMock.onViewStateChange?.({
        viewState: {
          target: [128, -96, 0],
          zoom: 6,
          minZoom: -8,
          maxZoom: 12,
        },
      })
    })

    expect(deckGlMock.viewState?.zoom).toBe(6)

    rerender(
      <ViewerCore
        gridCells={EMPTY_GRID_CELL_COLUMNS}
        fitGridCells={gridCells}
        boundaries={[boundary]}
        viewResetKey="dataset:visium"
      />,
    )

    expect(screen.queryByTestId('deck-layer-spatial-grid-cells')).not.toBeInTheDocument()
    expect(deckGlMock.viewState?.zoom).toBe(6)
    expect(deckGlMock.viewState?.target).toEqual([128, -96, 0])
  })

  it('resets the view for a new dataset key without remounting the image canvas', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const firstGridCells = gridCellColumns()
    // From (96, 96) to (112, 112).
    const secondGridCells = gridCellColumns([{ id: 'BC-2', row: 10, col: 13 }])
    const { rerender } = render(
      <ViewerCore gridCells={firstGridCells} viewResetKey="dataset:a" />,
    )
    const canvas = document.querySelector('canvas.morphology-canvas')

    act(() => {
      deckGlMock.onViewStateChange?.({
        viewState: {
          target: [128, -96, 0],
          zoom: 6,
          minZoom: -8,
          maxZoom: 12,
        },
      })
    })

    expect(deckGlMock.viewState?.zoom).toBe(6)

    rerender(<ViewerCore gridCells={secondGridCells} viewResetKey="dataset:b" />)

    await waitFor(() => {
      expect(deckGlMock.viewState?.target).toEqual([104, -104, 0])
    })
    expect(document.querySelector('canvas.morphology-canvas')).toBe(canvas)
  })

  it('renders nucleus segmentation polygons without overview cells', () => {
    const nucleusBoundary: CellBoundaryDatum = {
      id: 'nucleus-1',
      polygon: [
        [0, 0, 0],
        [8, 0, 0],
        [8, -8, 0],
      ],
      fillColor: [63, 118, 190, 38],
      lineColor: [128, 188, 255, 170],
    }

    render(<ViewerCore nucleusBoundaries={[nucleusBoundary]} />)

    expect(
      screen.getByTestId('deck-layer-nucleus-segmentation-polygons'),
    ).toHaveAttribute('data-count', '1')
    expect(screen.queryByText('Please load a dataset')).not.toBeInTheDocument()
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
        loadingTasks={[{ id: 'boundaries', label: 'Loading cell boundaries' }]}
        boundaryStatus="loading"
      />,
    )

    expect(screen.getByText('Loading cell boundaries')).toBeInTheDocument()
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
        expressionElements={[
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
        expressionElements={[
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

  it('draws each expressing cell zoomed out, highest scores on top', async () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells: readonly OverviewCellDatum[] = Array.from(
      { length: 900 },
      (_, index) => ({
        id: `cell-${index}`,
        position: [(index % 30) * 10 - 150, Math.floor(index / 30) * 5 - 75, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      }),
    )
    const expressionElements = cells.map(
      (cell, index): OverviewCellDatum => ({
        ...cell,
        fillColor: [240, 128, 120, 220],
        expressionCount: index % 3,
        expressionGenes: ['COL4A1'],
      }),
    )
    const idsScoring = (count: number) =>
      expressionElements
        .filter((element) => element.expressionCount === count)
        .map((element) => element.id)
    const [x = 0, y = 0] = cells[1]?.position ?? []
    const boundary: CellBoundaryDatum = {
      id: 'cell-1',
      polygon: [
        [x - 2, y - 2, 0],
        [x + 2, y - 2, 0],
        [x + 2, y + 2, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [32, 102, 83, 190],
    }
    const viewer = (boundaries: readonly CellBoundaryDatum[]) => (
      <ViewerCore
        cells={cells}
        boundaries={boundaries}
        geneExpressionActive
        expressionElements={expressionElements}
        initialViewStateOverride={{ target: [0, 0, 0], zoom: -3 }}
      />
    )
    const expressionOverlayIds = () => {
      const expressionLayer = deckGlMock.layers.find((layer) => {
        const candidate = layer as { readonly id?: string }

        return candidate.id === 'gene-expression-scatter'
      }) as { readonly props?: { readonly data?: readonly OverviewCellDatum[] } }

      return expressionLayer.props?.data?.map((element) => element.id) ?? []
    }
    const { rerender } = render(viewer([]))

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    expect(expressionOverlayIds()).toEqual([...idsScoring(1), ...idsScoring(2)])

    rerender(viewer([boundary]))

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    expect(expressionOverlayIds()).toEqual([
      ...idsScoring(1).filter((id) => id !== 'cell-1'),
      ...idsScoring(2),
    ])
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

  it('omits the transcript hover FOV for transcripts without one', () => {
    const transcript: TranscriptPointDatum = {
      ...transcriptDatum({ id: '4,2:48822259', cellId: null }),
      fovName: null,
    }

    render(<ViewerCore cells={[overviewCellDatum()]} transcriptPoints={[transcript]} />)

    act(() => {
      deckGlMock.onHover?.({ object: transcript, x: 12, y: 20 })
    })

    expect(screen.getByText('4,2:48822259')).toBeInTheDocument()
    expect(screen.queryByText('FOV')).not.toBeInTheDocument()
  })

  it('shows overview cell hover metadata', () => {
    const cellId = asCellId('aaaaaaaa-1')
    const cell: OverviewCellDatum = {
      id: cellId,
      position: [123.4, -56.7, 0],
      radiusPixels: 4,
      fillColor: [215, 63, 124, 220],
      transcriptCount: 12,
      cellArea: 40,
      expressionCount: 7,
      expressionGenes: ['Actb', 'Pecam1', 'Col1a1', 'Vim'],
    }

    render(
      <ViewerCore
        cells={[cell]}
        annotationStyleColors={[
          {
            id: 'annotation-1',
            label: 'T cells',
            cellIds: [cellId],
            color: '#1f9b8f',
          },
          {
            id: 'annotation-2',
            label: 'Portal macrophages',
            cellIds: [cellId],
            color: '#be5f7c',
          },
        ]}
      />,
    )

    act(() => {
      deckGlMock.onHover?.({ object: cell, x: 18, y: 24 })
    })

    expect(screen.getByText('aaaaaaaa-1')).toBeInTheDocument()
    expect(screen.getByText('Xenium')).toBeInTheDocument()
    expect(screen.getByText('123.4, 56.7 µm')).toBeInTheDocument()
    expect(screen.getByText('40 µm²')).toBeInTheDocument()
    expect(screen.getByText('Actb, Pecam1, Col1a1 +1')).toBeInTheDocument()
    expect(screen.getByText('Annotations')).toBeInTheDocument()
    expect(screen.getByText('T cells, Portal macrophages')).toBeInTheDocument()
    expect(screen.getByText('Annotations').closest('div')).toHaveClass(
      'hover-tooltip-annotation-row',
    )
  })

  it('shows overview cell hover metadata with a dataset-specific source label', () => {
    const cell: OverviewCellDatum = {
      ...overviewCellDatum(),
      id: 'AAACCCAAGAAACACT-1',
      position: [12.3, -45.6, 0],
      expressionCount: 27,
    }

    render(
      <ViewerCore cells={[cell]} overviewCellSourceLabel="H5AD" hoverTooltipsEnabled />,
    )

    act(() => {
      deckGlMock.onHover?.({ object: cell, x: 18, y: 24 })
    })

    expect(screen.getByText('AAACCCAAGAAACACT-1')).toBeInTheDocument()
    expect(screen.getByText('H5AD')).toBeInTheDocument()
    expect(screen.getByText('12.3, 45.6 µm')).toBeInTheDocument()
    expect(screen.getByText('27')).toBeInTheDocument()
  })

  it('shows aggregate overview bin hover metadata', () => {
    const cell: OverviewCellDatum = {
      id: 'cell-bin:0:0',
      position: [50, -60, 0],
      radiusPixels: 6,
      fillColor: [215, 63, 124, 220],
      cellCount: 14,
    }

    render(<ViewerCore cells={[cell]} />)

    act(() => {
      deckGlMock.onHover?.({ object: cell, x: 18, y: 24 })
    })

    expect(screen.getByText('cell-bin:0:0')).toBeInTheDocument()
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('50, 60 µm')).toBeInTheDocument()
  })

  it('shows grid-cell hover metadata', () => {
    const gridCells = gridCellColumns()
    const gridCell = gridCellAt(gridCells, 0)

    render(<ViewerCore gridCells={gridCells} />)

    act(() => {
      deckGlMock.onHover?.({ object: gridCell, x: 18, y: 24 })
    })

    expect(screen.getByText('BC-1')).toBeInTheDocument()
    expect(screen.getByText('16 µm')).toBeInTheDocument()
    expect(screen.getByText('4, 7')).toBeInTheDocument()
    expect(screen.getByText('128, 256 px')).toBeInTheDocument()
    expect(screen.getByText('In tissue')).toBeInTheDocument()
  })

  it('suppresses grid-cell hover metadata while cursor magic lens is active', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const gridCells = gridCellColumns()
    const gridCell = gridCellAt(gridCells, 0)

    render(
      <ViewerCore
        gridCells={gridCells}
        magicLensActive
        magicLensRadiusMicrometers={40}
        magicLensStatus="ready"
        magicLensSummary={{
          kind: 'expression',
          transcriptCount: 167,
          cellCount: 6,
          geneCount: 1,
          selectedGeneTranscriptCount: 167,
          topGenes: [{ gene: 'C7', count: 167, selected: true }],
          hitLimit: false,
        }}
      />,
    )

    const frame = screen.getByRole('img', { name: 'Spatial viewer canvas area' })
    fireEvent.pointerMove(frame, { clientX: 80, clientY: 40 })

    await waitFor(() => {
      expect(document.querySelector('.viewer-magic-lens-hud')).toHaveTextContent(
        '6 bins - 167 UMI',
      )
    })

    act(() => {
      deckGlMock.onHover?.({ object: gridCell, x: 80, y: 40 })
    })

    expect(document.querySelector('.viewer-magic-lens-hud')).toHaveTextContent('C7')
    expect(screen.queryByText('BC-1')).not.toBeInTheDocument()
    expect(screen.queryByText('16 µm')).not.toBeInTheDocument()
  })

  it('shows segmented cell boundary hover metadata when enabled', () => {
    const boundary: CellBoundaryDatum = {
      id: 'cellid_000000001-1',
      polygon: [
        [0, 0, 0],
        [10, 0, 0],
        [10, -10, 0],
        [0, -10, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [32, 102, 83, 190],
    }

    render(
      <ViewerCore
        boundaries={[boundary]}
        cellBoundaryHoverEnabled
        expressionElements={[
          {
            id: boundary.id,
            position: [5, -5, 0],
            radiusPixels: 4,
            fillColor: [240, 128, 120, 220],
            expressionCount: 7,
            expressionGenes: ['Actb', 'Pecam1', 'Col1a1', 'Vim'],
          },
        ]}
      />,
    )

    expect(screen.getByTestId('deck-layer-cell-boundary-hit-areas')).toHaveAttribute(
      'data-count',
      '1',
    )

    act(() => {
      deckGlMock.onHover?.({ object: boundary, x: 18, y: 24 })
    })

    expect(screen.getByText('cellid_000000001-1')).toBeInTheDocument()
    expect(screen.getByText('Segmented')).toBeInTheDocument()
    expect(screen.getByText('100 µm²')).toBeInTheDocument()
    expect(screen.getByText('Actb, Pecam1, Col1a1 +1')).toBeInTheDocument()
  })

  it('shows matched cell metadata and annotations from boundary hover', () => {
    const cellId = asCellId('aaaaaaab-1')
    const cell: OverviewCellDatum = {
      id: cellId,
      position: [123.4, -56.7, 0],
      radiusPixels: 4,
      fillColor: [215, 63, 124, 220],
      transcriptCount: 12,
      cellArea: 40,
    }
    const boundary: CellBoundaryDatum = {
      id: cell.id,
      polygon: [
        [0, 0, 0],
        [10, 0, 0],
        [10, -10, 0],
        [0, -10, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [32, 102, 83, 190],
    }

    render(
      <ViewerCore
        cells={[cell]}
        boundaries={[boundary]}
        cellBoundaryHoverEnabled
        annotationStyleColors={[
          {
            id: 'annotation-1',
            label: 'T cells',
            cellIds: [cellId],
            color: '#1f9b8f',
          },
          {
            id: 'annotation-2',
            label: 'Portal macrophages',
            cellIds: [cellId],
            color: '#be5f7c',
          },
        ]}
      />,
    )

    act(() => {
      deckGlMock.onHover?.({ object: boundary, x: 18, y: 24 })
    })

    expect(screen.getByText('aaaaaaab-1')).toBeInTheDocument()
    expect(screen.getByText('Xenium')).toBeInTheDocument()
    expect(screen.getByText('123.4, 56.7 µm')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('40 µm²')).toBeInTheDocument()
    expect(screen.getByText('T cells, Portal macrophages')).toBeInTheDocument()
    expect(screen.getByText('T cells, Portal macrophages').closest('div')).toHaveClass(
      'hover-tooltip-annotation-row',
    )
    expect(screen.getByText('100 µm²')).toBeInTheDocument()
  })

  it('suppresses bin and cell hover metadata when disabled without removing clicks', () => {
    const cell: OverviewCellDatum = {
      ...overviewCellDatum(),
      id: 'hover-disabled-cell',
    }
    const gridCells = gridCellColumns([{ id: 'hover-disabled-bin' }])
    const gridCell = gridCellAt(gridCells, 0)
    const boundary: CellBoundaryDatum = {
      id: 'hover-disabled-boundary',
      polygon: [
        [0, 0, 0],
        [10, 0, 0],
        [10, -10, 0],
        [0, -10, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [32, 102, 83, 190],
    }
    const onCellBoundaryClick = vi.fn()

    render(
      <ViewerCore
        cells={[cell]}
        gridCells={gridCells}
        boundaries={[boundary]}
        cellBoundaryHoverEnabled
        hoverTooltipsEnabled={false}
        onCellBoundaryClick={onCellBoundaryClick}
      />,
    )

    expect(screen.getByTestId('deck-layer-cell-boundary-hit-areas')).toHaveAttribute(
      'data-count',
      '1',
    )
    expect(deckGlMock.onHover).toBeNull()

    act(() => {
      deckGlMock.onHover?.({ object: cell, x: 18, y: 24 })
      deckGlMock.onHover?.({ object: gridCell, x: 18, y: 24 })
      deckGlMock.onHover?.({ object: boundary, x: 18, y: 24 })
      deckGlMock.onClick?.({ object: boundary, x: 18, y: 24 })
    })

    expect(screen.queryByText('hover-disabled-cell')).not.toBeInTheDocument()
    expect(screen.queryByText('hover-disabled-bin')).not.toBeInTheDocument()
    expect(screen.queryByText('hover-disabled-boundary')).not.toBeInTheDocument()
    expect(onCellBoundaryClick).toHaveBeenCalledWith(boundary)
  })

  it('hides a shown cell tooltip and clears the hover handler when tooltips are turned off', () => {
    const cell: OverviewCellDatum = {
      ...overviewCellDatum(),
      id: 'hover-turned-off-cell',
    }
    const { rerender } = render(<ViewerCore cells={[cell]} />)

    act(() => {
      deckGlMock.onHover?.({ object: cell, x: 18, y: 24 })
    })
    expect(screen.getByText('hover-turned-off-cell')).toBeInTheDocument()

    rerender(<ViewerCore cells={[cell]} hoverTooltipsEnabled={false} />)

    expect(screen.queryByText('hover-turned-off-cell')).not.toBeInTheDocument()
    // Null, not left out: deck.gl would keep the old handler.
    expect(deckGlMock.onHover).toBeNull()
  })

  it('suppresses segmented cell boundary hover metadata while cursor magic lens is active', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const boundary: CellBoundaryDatum = {
      id: 'cellid_000000001-1',
      polygon: [
        [0, 0, 0],
        [10, 0, 0],
        [10, -10, 0],
        [0, -10, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [32, 102, 83, 190],
    }

    render(
      <ViewerCore
        boundaries={[boundary]}
        cellBoundaryHoverEnabled
        magicLensActive
        magicLensRadiusMicrometers={40}
        magicLensStatus="ready"
        magicLensSummary={{
          kind: 'expression',
          transcriptCount: 167,
          cellCount: 6,
          geneCount: 1,
          selectedGeneTranscriptCount: 167,
          topGenes: [{ gene: 'C7', count: 167, selected: true }],
          hitLimit: false,
        }}
      />,
    )

    const frame = screen.getByRole('img', { name: 'Spatial viewer canvas area' })
    fireEvent.pointerMove(frame, { clientX: 80, clientY: 40 })

    await waitFor(() => {
      expect(document.querySelector('.viewer-magic-lens-hud')).toHaveTextContent(
        '6 bins - 167 UMI',
      )
    })

    act(() => {
      deckGlMock.onHover?.({ object: boundary, x: 80, y: 40 })
    })

    expect(document.querySelector('.viewer-magic-lens-hud')).toHaveTextContent('C7')
    expect(screen.queryByText('cellid_000000001-1')).not.toBeInTheDocument()
    expect(screen.queryByText('Segmented')).not.toBeInTheDocument()
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

  it('notifies when a grid cell is clicked', () => {
    const gridCells = gridCellColumns()
    const gridCell = gridCellAt(gridCells, 0)
    const onGridCellClick = vi.fn()

    render(<ViewerCore gridCells={gridCells} onGridCellClick={onGridCellClick} />)

    act(() => {
      deckGlMock.onClick?.({ object: gridCell, x: 14, y: 22 })
    })

    expect(onGridCellClick).toHaveBeenCalledWith(gridCell)
  })

  // deck.gl picks on pointerdown, before the click is recognised. Under
  // software WebGL that pick can outlast the 250 ms mjolnir.js allows for a
  // click, which then never reaches onClick.
  it('takes a click however long deck.gl picks on pointerdown', () => {
    render(<ViewerCore gridCells={gridCellColumns()} />)

    expect(deckGlMock.eventRecognizerOptions).toEqual({ click: { time: Infinity } })
  })

  it('notifies when a segmented cell boundary is clicked', () => {
    const boundary: CellBoundaryDatum = {
      id: 'cellid_000000001-1',
      polygon: [
        [0, 0, 0],
        [10, 0, 0],
        [10, -10, 0],
        [0, -10, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [32, 102, 83, 190],
    }
    const onCellBoundaryClick = vi.fn()

    render(
      <ViewerCore
        boundaries={[boundary]}
        cellBoundaryHoverEnabled
        onCellBoundaryClick={onCellBoundaryClick}
      />,
    )

    act(() => {
      deckGlMock.onClick?.({ object: boundary, x: 14, y: 22 })
    })

    expect(onCellBoundaryClick).toHaveBeenCalledWith(boundary)
  })

  describe('nuclei', () => {
    const square = (min: number, size: number): CellBoundaryDatum['polygon'] => [
      [min, -min, 0],
      [min + size, -min, 0],
      [min + size, -min - size, 0],
      [min, -min - size, 0],
    ]
    const nucleusLayer = { id: 'nucleus-segmentation-polygons' }
    const cellId = asCellId('aaaaaaab-1')
    const cell: OverviewCellDatum = {
      id: cellId,
      position: [5, -5, 0],
      radiusPixels: 4,
      fillColor: [215, 63, 124, 220],
    }
    const firstNucleus: CellBoundaryDatum = {
      id: cellId,
      cellId,
      polygon: square(1, 2),
      fillColor: [76, 145, 230, 34],
      lineColor: [76, 145, 230, 190],
    }
    const secondNucleus: CellBoundaryDatum = {
      ...firstNucleus,
      id: `${cellId}#nucleus-2`,
      polygon: square(5, 4),
    }

    it('shows a hovered nucleus with its cell and its place among the cell nuclei', () => {
      render(
        <ViewerCore cells={[cell]} nucleusBoundaries={[firstNucleus, secondNucleus]} />,
      )

      act(() => {
        deckGlMock.onHover?.({ layer: nucleusLayer, object: secondNucleus, x: 18, y: 24 })
      })

      expect(screen.getByText(`${cellId}#nucleus-2`)).toBeInTheDocument()
      expect(screen.getByText('2 of 2')).toBeInTheDocument()
      expect(screen.getByText(cellId)).toBeInTheDocument()
      expect(screen.getByText('16 µm²')).toBeInTheDocument()
    })

    it('shows a nucleus without a cell as segmented', () => {
      const nucleus: CellBoundaryDatum = {
        id: 'nucleus_000000004',
        polygon: square(0, 3),
        fillColor: [76, 145, 230, 34],
        lineColor: [76, 145, 230, 190],
      }

      render(<ViewerCore nucleusBoundaries={[nucleus]} />)
      act(() => {
        deckGlMock.onHover?.({ layer: nucleusLayer, object: nucleus, x: 18, y: 24 })
      })

      expect(screen.getByText('nucleus_000000004')).toBeInTheDocument()
      expect(screen.getByText('Segmented')).toBeInTheDocument()
      expect(screen.getByText('9 µm²')).toBeInTheDocument()
    })

    it('selects the cell of a clicked nucleus', () => {
      const onCellClick = vi.fn()
      const onCellBoundaryClick = vi.fn()

      render(
        <ViewerCore
          cells={[cell]}
          nucleusBoundaries={[firstNucleus]}
          onCellBoundaryClick={onCellBoundaryClick}
          onCellClick={onCellClick}
        />,
      )
      act(() => {
        deckGlMock.onClick?.({ layer: nucleusLayer, object: firstNucleus, x: 14, y: 22 })
      })

      expect(onCellClick).toHaveBeenCalledWith(cell)
      expect(onCellBoundaryClick).not.toHaveBeenCalled()
    })

    it('selects the outline of a clicked nucleus whose cell is not a point', () => {
      const cellBoundary: CellBoundaryDatum = {
        id: 'cellid_000000002-1',
        polygon: square(0, 10),
        fillColor: [32, 102, 83, 34],
        lineColor: [32, 102, 83, 190],
      }
      const nucleus: CellBoundaryDatum = {
        ...firstNucleus,
        id: 'nucleus_000000001',
        cellId: cellBoundary.id,
      }
      const onCellBoundaryClick = vi.fn()

      render(
        <ViewerCore
          boundaries={[cellBoundary]}
          cellBoundaryHoverEnabled
          nucleusBoundaries={[nucleus]}
          onCellBoundaryClick={onCellBoundaryClick}
        />,
      )
      act(() => {
        deckGlMock.onClick?.({ layer: nucleusLayer, object: nucleus, x: 14, y: 22 })
      })

      expect(onCellBoundaryClick).toHaveBeenCalledWith(cellBoundary)
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

  it('reports visible grid cells in viewport details', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onViewportChange = vi.fn()

    render(
      <ViewerCore gridCells={gridCellColumns()} onViewportChange={onViewportChange} />,
    )

    await waitFor(() => {
      expect(onViewportChange).toHaveBeenCalled()
    })
    expect(onViewportChange.mock.calls[0]?.[0]).toMatchObject({
      visibleCellCount: 1,
    })
  })

  it('uses fit grid cells for viewport density when rendered grid cells are hidden', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onViewportChange = vi.fn()
    const fitGridCells = gridCellColumns([{}, { id: 'BC-2', col: 8 }])
    const boundary: CellBoundaryDatum = {
      id: 'cellid_000000001-1',
      polygon: [
        [0, 0, 0],
        [10, 0, 0],
        [10, -10, 0],
        [0, -10, 0],
      ],
      fillColor: [32, 102, 83, 34],
      lineColor: [32, 102, 83, 190],
    }

    render(
      <ViewerCore
        boundaries={[boundary]}
        fitGridCells={fitGridCells}
        gridCells={EMPTY_GRID_CELL_COLUMNS}
        onViewportChange={onViewportChange}
      />,
    )

    await waitFor(() => {
      expect(onViewportChange).toHaveBeenCalled()
    })
    expect(onViewportChange.mock.calls[0]?.[0]).toMatchObject({
      visibleCellCount: 2,
    })
  })

  it('opens the cell at the centre, or selects the view, with Enter (15.5-D)', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      ...rect,
      width: 1000,
      height: 600,
      right: 1000,
      bottom: 600,
    })
    const cells: readonly OverviewCellDatum[] = [
      { id: 'left', position: [0, 0, 0], radiusPixels: 4, fillColor: [1, 2, 3, 255] },
      {
        id: 'middle',
        position: [1000, -500, 0],
        radiusPixels: 4,
        fillColor: [1, 2, 3, 255],
      },
      {
        id: 'right',
        position: [2000, -1000, 0],
        radiusPixels: 4,
        fillColor: [1, 2, 3, 255],
      },
    ]
    const onCellClick = vi.fn()
    const onRoiComplete = vi.fn()
    const { rerender } = render(
      <ViewerCore
        cells={cells}
        onCellClick={onCellClick}
        onRoiComplete={onRoiComplete}
      />,
    )
    await waitFor(() => {
      expect(deckGlMock.viewState?.target).toEqual([1000, -500, 0])
    })
    const canvas = screen.getByRole('img', { name: 'Spatial viewer canvas area' })

    fireEvent.keyDown(canvas, { key: 'Enter' })
    expect(onCellClick).toHaveBeenCalledWith(cells[1])

    // Away from every cell, Enter opens nothing.
    fireEvent.keyDown(canvas, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(canvas, { key: 'Enter' })
    expect(onCellClick).toHaveBeenCalledTimes(1)

    rerender(
      <ViewerCore
        cells={cells}
        onCellClick={onCellClick}
        onRoiComplete={onRoiComplete}
        roiMode="box"
      />,
    )
    fireEvent.keyDown(canvas, { key: 'Enter' })
    expect(onRoiComplete).toHaveBeenCalledWith({
      kind: 'box',
      bbox: expect.objectContaining({
        minX: expect.any(Number),
        maxX: expect.any(Number),
      }),
    })
    expect(onCellClick).toHaveBeenCalledTimes(1)
  })

  it('fits the measured canvas, and zooms, fits and goes to regions (15.2-E)', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      ...rect,
      width: 1000,
      height: 600,
      right: 1000,
      bottom: 600,
    })
    const cells: readonly OverviewCellDatum[] = [
      { id: 'cell-1', position: [0, 0, 0], radiusPixels: 4, fillColor: [1, 2, 3, 255] },
      {
        id: 'cell-2',
        position: [2000, -1000, 0],
        radiusPixels: 4,
        fillColor: [1, 2, 3, 255],
      },
    ]
    const fittedZoom = Math.log2((1000 - 48) / 2000)
    const { rerender } = render(<ViewerCore cells={cells} navigationControls />)

    await waitFor(() => {
      expect(deckGlMock.viewState?.zoom).toBeCloseTo(fittedZoom)
    })
    expect(deckGlMock.viewState?.target).toEqual([1000, -500, 0])

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in (+)' }))
    expect(deckGlMock.viewState?.zoom).toBeCloseTo(fittedZoom + 1)
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view (F)' }))
    expect(deckGlMock.viewState?.zoom).toBeCloseTo(fittedZoom)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out (−)' }))
    expect(deckGlMock.viewState?.zoom).toBeCloseTo(fittedZoom - 1)

    rerender(<ViewerCore cells={cells} navigationControls fitRequestKey={1} />)
    await waitFor(() => {
      expect(deckGlMock.viewState?.zoom).toBeCloseTo(fittedZoom)
    })

    rerender(
      <ViewerCore
        cells={cells}
        navigationControls
        fitRequestKey={1}
        focusRequest={{
          key: 1,
          bbox: {
            minX: micrometers(100),
            maxX: micrometers(200),
            minY: micrometers(100),
            maxY: micrometers(150),
          },
        }}
      />,
    )
    await waitFor(() => {
      expect(deckGlMock.viewState?.target).toEqual([150, -125, 0])
    })
    expect(deckGlMock.viewState?.zoom).toBeCloseTo(Math.log2((1000 - 48) / 100))
  })

  it('leaves out the zoom buttons unless asked', () => {
    render(<ViewerCore cells={[]} imageLoader={null} />)

    expect(screen.queryByRole('group', { name: 'Zoom' })).not.toBeInTheDocument()
  })

  it('hides the scale bar and legend, and closes the gaps they leave', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells = [overviewCellDatum()]
    const legendSections = [
      {
        kind: 'categories' as const,
        id: 'cells',
        title: 'graphclust',
        items: [
          { id: 'c1', label: 'Cluster 1', color: '#4cc39a', count: 1, visible: true },
        ],
      },
    ]
    const { rerender } = render(
      <ViewerCore
        cells={cells}
        legendSections={legendSections}
        navigationControls
        minimap
      />,
    )

    expect(await screen.findByLabelText(/^Scale bar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Zoom' })).not.toHaveClass(
      'without-scale-bar',
    )
    expect(document.querySelector('.viewer-minimap')).toHaveClass('viewer-minimap', {
      exact: true,
    })

    rerender(
      <ViewerCore
        cells={cells}
        legendSections={legendSections}
        legend={false}
        scaleBar={false}
        minimap
      />,
    )

    expect(screen.queryByLabelText(/^Scale bar/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Legend' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Zoom' })).not.toBeInTheDocument()
    expect(document.querySelector('.viewer-minimap')).toHaveClass(
      'without-navigation',
      'without-scale-bar',
    )

    rerender(<ViewerCore cells={cells} navigationControls scaleBar={false} minimap />)

    expect(screen.getByRole('group', { name: 'Zoom' })).toHaveClass('without-scale-bar')
    expect(document.querySelector('.viewer-minimap')).toHaveClass('without-scale-bar')
    expect(document.querySelector('.viewer-minimap')).not.toHaveClass(
      'without-navigation',
    )
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
            readonly cells?: readonly unknown[]
            readonly data?: {
              readonly attributes?: {
                readonly getFilterValue?: { readonly value?: Float32Array }
              }
            }
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
    // The outlined cell stays in the point data but is filtered out on the GPU.
    expect(cellLayer?.props?.cells).toEqual([annotatedCell])
    expect(cellLayer?.props?.data?.attributes?.getFilterValue?.value?.[1]).toBe(1)
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
    const expressionElements: readonly OverviewCellDatum[] = [
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
        cellBoundaryOpacity={1}
        expressionElements={expressionElements}
        geneExpressionActive
        initialViewStateOverride={{ target: [0, 0, 0], zoom: 0 }}
      />,
    )

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    expect(boundaryPathColorAt(0)).toEqual([240, 128, 120, 220])
    expect(boundaryPathColorAt(1)).toEqual([72, 68, 58, 160])

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
    expect(boundaryPathColorAt(1)).toEqual([72, 68, 58, 160])

    await act(async () => {
      vi.advanceTimersByTime(159)
    })

    expect(boundaryPathColorAt(0)).toEqual([240, 128, 120, 220])
    expect(boundaryPathColorAt(1)).toEqual([72, 68, 58, 160])

    await act(async () => {
      vi.advanceTimersByTime(1)
    })

    expect(boundaryPathColorAt(0)).toEqual([72, 68, 58, 160])
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

  it('pans with the arrow keys at the highest zoom and leaves modifier shortcuts alone', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    render(
      <ViewerCore
        cells={[overviewCellDatum()]}
        initialViewStateOverride={{ target: [0, 0, 0], zoom: 10 }}
      />,
    )
    await waitFor(() => {
      expect(deckGlMock.viewState?.zoom).toBe(10)
    })
    const frame = screen.getByRole('img', { name: 'Spatial viewer canvas area' })

    // 64 screen px is 1/16 of a data unit at zoom 10. Up shows more of the
    // top of the image: smaller data y, larger deck y.
    expect(fireEvent.keyDown(frame, { key: 'ArrowRight' })).toBe(false)
    expect(fireEvent.keyDown(frame, { key: 'ArrowUp' })).toBe(false)
    expect(deckGlMock.viewState?.target).toEqual([0.0625, 0.0625, 0])

    // Page zoom and history shortcuts reach the browser.
    expect(fireEvent.keyDown(frame, { key: '-', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(frame, { key: 'ArrowLeft', altKey: true })).toBe(true)
    expect(deckGlMock.viewState?.target).toEqual([0.0625, 0.0625, 0])
    expect(deckGlMock.viewState?.zoom).toBe(10)
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
      <ViewerCore
        cells={cells}
        onViewportCellCountChange={onViewportCellCountChange}
        // A broad view that shows part of the grid: the old 720 px fit.
        initialViewStateOverride={{
          target: [4500, -4500, 0],
          zoom: Math.log2(720 / 9000),
        }}
      />,
    )

    await waitFor(() => {
      expect(onViewportCellCountChange).toHaveBeenCalledWith(expect.any(Number) as number)
      expect(onViewportCellCountChange).toHaveBeenLastCalledWith(17)
    })
  })

  it('shows the zoom number only when asked, for debugging', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    render(<ViewerCore cells={[overviewCellDatum()]} />)

    expect(screen.queryByLabelText(/^Zoom level/)).toBeNull()
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
    const { rerender } = render(<ViewerCore cells={cells} showZoomLevel />)
    const frame = screen.getByRole('img', { name: 'Spatial viewer canvas area' })

    expect(await screen.findByLabelText('Zoom level 4.00')).toHaveTextContent('Zoom 4.00')
    expect(await screen.findByLabelText('Scale bar 5 µm')).toBeInTheDocument()
    expect(document.querySelector('.viewport-scale-bar-track')).toHaveStyle({
      width: '80px',
    })

    fireEvent.pointerMove(frame, { clientX: 100, clientY: 50 })

    expect(await screen.findByText('X 1234 µm | Y 5678 µm')).toBeInTheDocument()

    rerender(
      <ViewerCore
        cells={cells}
        coordinateUnit="px"
        micrometersPerPixel={0.5}
        showZoomLevel
      />,
    )
    expect(await screen.findByLabelText('Scale bar 10 px')).toBeInTheDocument()
    fireEvent.pointerMove(frame, { clientX: 100, clientY: 50 })

    expect(await screen.findByText('X 2468 px | Y 11356 px')).toBeInTheDocument()

    fireEvent.pointerLeave(frame)

    await waitFor(() => {
      expect(screen.queryByText('X 2468 px | Y 11356 px')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText('Zoom level 4.00')).toBeInTheDocument()
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

    expect(await screen.findByText('256 µm')).toBeInTheDocument()

    fireEvent.pointerUp(measurementLayer, {
      clientX: 116,
      clientY: 50,
      pointerId: 1,
    })

    expect(screen.getByText('256 µm')).toBeInTheDocument()

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

  it('centres the magic lens box on the pointer at negative coordinates (EXP-044)', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onMagicLensMove = vi.fn()
    // Data x -1234, y -20: left of and above the origin.
    const cells: OverviewCellDatum[] = [
      {
        id: 'cell-1',
        position: [-1234, 20, 0],
        radiusPixels: 4,
        fillColor: [215, 63, 124, 220],
      },
    ]

    render(
      <ViewerCore
        cells={cells}
        magicLensActive
        magicLensRadiusMicrometers={40}
        magicLensStatus="loading"
        onMagicLensMove={onMagicLensMove}
      />,
    )

    const frame = screen.getByRole('img', { name: 'Spatial viewer canvas area' })
    fireEvent.pointerMove(frame, { clientX: 100, clientY: 50 })

    await waitFor(() => {
      expect(onMagicLensMove).toHaveBeenCalledWith(
        expect.objectContaining({
          bbox: expect.objectContaining({
            minX: -1274,
            maxX: -1194,
            minY: -60,
            maxY: 20,
          }),
        }),
      )
    })
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

  it('does not re-render deck layers while dragging a box ROI', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    render(<ViewerCore cells={[overviewCellDatum()]} roiMode="box" />)

    const roiLayer = document.querySelector('.roi-draw-layer')

    if (!(roiLayer instanceof HTMLElement)) {
      throw new Error('Expected ROI draw layer.')
    }

    const renderCountBeforeDrag = deckGlMock.renderCount

    fireEvent.pointerDown(roiLayer, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(roiLayer, { clientX: 108, clientY: 58, pointerId: 1 })
    fireEvent.pointerMove(roiLayer, { clientX: 116, clientY: 66, pointerId: 1 })

    expect(document.querySelector('.roi-rectangle')).toHaveStyle({
      width: '16px',
      height: '16px',
    })
    expect(deckGlMock.renderCount).toBe(renderCountBeforeDrag)
  })

  it('outlines saved selections in their colours without redrawing deck layers (15.4-A)', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells = [overviewCellDatum()]
    const active: RoiSelection = {
      kind: 'box',
      bbox: {
        minX: micrometers(0),
        minY: micrometers(0),
        maxX: micrometers(256),
        maxY: micrometers(256),
      },
    }
    const other: RoiSelection = {
      kind: 'lasso',
      bbox: active.bbox,
      points: [
        { x: micrometers(0), y: micrometers(0) },
        { x: micrometers(256), y: micrometers(0) },
        { x: micrometers(256), y: micrometers(256) },
      ],
    }

    const { rerender } = render(<ViewerCore cells={cells} />)
    const renderCountBefore = deckGlMock.renderCount

    rerender(
      <ViewerCore
        cells={cells}
        roiSelection={active}
        selectionOutlines={[
          { id: 'selection-1', color: '#4bd6f0', active: false, selection: other },
          { id: 'selection-2', color: '#f04bc8', active: true, selection: active },
        ]}
      />,
    )

    const saved = document.querySelectorAll('.roi-saved-path')
    expect(saved).toHaveLength(1)
    expect(saved[0]?.getAttribute('d')).toMatch(/^M.*Z$/)
    expect((saved[0] as SVGElement).style.getPropertyValue('--selection-color')).toBe(
      '#4bd6f0',
    )
    // A dark casing under the stroke keeps it visible over bright images.
    const casing = saved[0]?.previousElementSibling
    expect(casing).toHaveClass('roi-path-casing')
    expect(casing?.getAttribute('d')).toBe(saved[0]?.getAttribute('d'))
    const rectangle = document.querySelector('.roi-rectangle')
    expect((rectangle as HTMLElement).style.getPropertyValue('--selection-color')).toBe(
      '#f04bc8',
    )
    expect(deckGlMock.renderCount).toBe(renderCountBefore)
  })

  it('shows a minimap without redrawing deck layers, and moves the view from it (15.4-D)', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onViewportChange = vi.fn()
    const cells = [
      { ...overviewCellDatum(), id: 'a', position: [0, 0, 0] },
      { ...overviewCellDatum(), id: 'b', position: [1_000, -500, 0] },
    ] satisfies OverviewCellDatum[]

    const { rerender } = render(
      <ViewerCore cells={cells} onViewportChange={onViewportChange} />,
    )
    expect(document.querySelector('.viewer-minimap')).toBeNull()
    const renderCountBefore = deckGlMock.renderCount

    rerender(<ViewerCore cells={cells} onViewportChange={onViewportChange} minimap />)

    const minimap = screen.getByRole('img', {
      name: 'Minimap of the whole dataset; the box is the view',
    })
    // No image: the cells are dots.
    expect(minimap.querySelector('.viewer-minimap-dots')).not.toBeNull()
    expect(minimap.querySelector('.viewer-minimap-view')).not.toBeNull()
    expect(deckGlMock.renderCount).toBe(renderCountBefore)

    await waitFor(() => {
      expect(onViewportChange).toHaveBeenCalled()
    })
    const before = onViewportChange.mock.lastCall?.[0] as ViewerViewportDetail
    onViewportChange.mockClear()

    // The minimap's right edge is east of the data.
    fireEvent.pointerDown(minimap, { clientX: 160, clientY: 40, pointerId: 1, button: 0 })
    fireEvent.pointerUp(minimap, { clientX: 160, clientY: 40, pointerId: 1 })

    await waitFor(() => {
      expect(onViewportChange).toHaveBeenCalled()
    })
    const after = onViewportChange.mock.lastCall?.[0] as ViewerViewportDetail
    expect(after.bbox.minX).toBeGreaterThan(before.bbox.minX)
  })

  it('draws µm axes along the edges without redrawing deck layers (15.4-E)', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells = [overviewCellDatum()]

    const { rerender } = render(<ViewerCore cells={cells} />)
    expect(document.querySelector('.viewer-axes')).toBeNull()
    const renderCountBefore = deckGlMock.renderCount

    rerender(<ViewerCore cells={cells} axes />)

    const axes = document.querySelector('.viewer-axes')
    expect(axes).toHaveAttribute('aria-hidden', 'true')
    expect(axes?.querySelector('.viewer-axis-unit')).toHaveTextContent('µm')
    expect(
      axes?.querySelectorAll('.viewer-axis-x .viewer-axis-tick').length,
    ).toBeGreaterThan(0)
    expect(deckGlMock.renderCount).toBe(renderCountBefore)

    rerender(
      <ViewerCore cells={cells} axes coordinateUnit="px" micrometersPerPixel={0.5} />,
    )
    expect(document.querySelector('.viewer-axis-unit')).toHaveTextContent('px')
  })

  it('does not re-render deck layers when the legend collapses or a category is toggled', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const onLegendCategoryVisibilityChange = vi.fn()

    render(
      <ViewerCore
        cells={[overviewCellDatum()]}
        legendSections={[
          {
            kind: 'categories',
            id: 'cells',
            title: 'graphclust',
            items: [
              { id: 'c1', label: 'Cluster 1', color: '#4cc39a', count: 1, visible: true },
            ],
          },
        ]}
        onLegendCategoryVisibilityChange={onLegendCategoryVisibilityChange}
      />,
    )

    const renderCountBefore = deckGlMock.renderCount

    fireEvent.click(screen.getByRole('checkbox', { name: 'Cluster 1, 1 cell' }))
    fireEvent.click(screen.getByRole('button', { name: 'Legend' }))
    fireEvent.click(screen.getByRole('button', { name: 'Legend' }))

    expect(onLegendCategoryVisibilityChange).toHaveBeenCalledWith(
      'c1',
      false,
      expect.any(String),
    )
    expect(deckGlMock.renderCount).toBe(renderCountBefore)
  })

  it('cancels a loading task and shows its progress without redrawing deck layers (15.3-D)', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells = [overviewCellDatum()]
    const onCancelLoadingTask = vi.fn()

    const { rerender } = render(
      <ViewerCore cells={cells} onCancelLoadingTask={onCancelLoadingTask} />,
    )
    const renderCountBefore = deckGlMock.renderCount

    rerender(
      <ViewerCore
        cells={cells}
        onCancelLoadingTask={onCancelLoadingTask}
        loadingTasks={[
          {
            id: 'transcript-overlay',
            label: 'Loading transcripts',
            cancellable: true,
            progress: 0.25,
          },
        ]}
      />,
    )
    rerender(
      <ViewerCore
        cells={cells}
        onCancelLoadingTask={onCancelLoadingTask}
        loadingTasks={[
          {
            id: 'transcript-overlay',
            label: 'Loading transcripts',
            cancellable: true,
            progress: 0.5,
          },
        ]}
      />,
    )

    expect(screen.getByText('50%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel loading transcripts' }))

    expect(onCancelLoadingTask).toHaveBeenCalledWith('transcript-overlay')
    expect(deckGlMock.renderCount).toBe(renderCountBefore)
  })

  it('marks the selection without redrawing deck layers, and Esc clears it', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells = [overviewCellDatum()]
    const onClearSelection = vi.fn()

    const { rerender } = render(
      <ViewerCore cells={cells} onClearSelection={onClearSelection} />,
    )
    const renderCountBefore = deckGlMock.renderCount

    rerender(
      <ViewerCore
        cells={cells}
        onClearSelection={onClearSelection}
        selectionHighlight={{
          kind: 'point',
          id: 'cell-1',
          position: [0, 0, 0],
          radius: 2,
        }}
      />,
    )

    expect(document.querySelector('.viewer-selection-overlay circle')).not.toBeNull()
    expect(deckGlMock.renderCount).toBe(renderCountBefore)

    fireEvent.keyDown(screen.getByRole('img', { name: 'Spatial viewer canvas area' }), {
      key: 'Escape',
    })
    expect(onClearSelection).toHaveBeenCalledTimes(1)
  })

  it('says which tool is on and drops a half-drawn shape when it changes', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const cells = [overviewCellDatum()]

    const { rerender } = render(<ViewerCore cells={cells} roiMode="box" />)
    const roiLayer = document.querySelector('.roi-draw-layer')

    if (!(roiLayer instanceof HTMLElement)) {
      throw new Error('Expected ROI draw layer.')
    }

    expect(screen.getByText('Drag to draw a box. Esc cancels.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Spatial viewer canvas area' })).toHaveClass(
      'is-drawing',
    )

    fireEvent.pointerDown(roiLayer, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(roiLayer, { clientX: 120, clientY: 70, pointerId: 1 })
    expect(document.querySelector('.roi-rectangle')).not.toBeNull()
    fireEvent.pointerCancel(roiLayer, { pointerId: 1 })
    expect(document.querySelector('.roi-rectangle')).toBeNull()

    fireEvent.pointerDown(roiLayer, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(roiLayer, { clientX: 120, clientY: 70, pointerId: 1 })
    rerender(<ViewerCore cells={cells} roiMode="idle" />)
    expect(document.querySelector('.roi-rectangle')).toBeNull()
    expect(screen.queryByText(/Esc cancels/)).toBeNull()

    rerender(<ViewerCore cells={cells} roiMode="box" />)
    expect(document.querySelector('.roi-rectangle')).toBeNull()
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

    const lasso = document.querySelector('.roi-lasso-path')
    expect(lasso).toBeInTheDocument()
    // Drawn over a dark casing of the same path, for bright images.
    expect(lasso?.previousElementSibling).toHaveClass('roi-path-casing')
    expect(lasso?.previousElementSibling?.getAttribute('d')).toBe(
      lasso?.getAttribute('d'),
    )

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

// 16 µm bins, placed so that row 4, column 7 covers (0, 0) to (16, 16).
function gridCellColumns(
  bins: readonly Partial<GridCellFixtureBin>[] = [{}],
): GridCellColumns {
  return gridCellColumnsFixture(
    bins.map((bin) => ({
      id: 'BC-1',
      row: 4,
      col: 7,
      inTissue: true,
      fullresRow: 128,
      fullresCol: 256,
      ...bin,
    })),
    {
      gridId: 'grid-16um',
      binSizeMicrometers: 16,
      basis: squareGridBasis(16, { x: -7 * 16, y: -4 * 16 }),
    },
  )
}

// A square of 2 µm bins from the origin, `size` bins across.
function twoMicrometerGridCells(size: number): GridCellColumns {
  const bins: GridCellFixtureBin[] = []

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      bins.push({ id: `2um-${row}-${col}`, row, col, fullresRow: row, fullresCol: col })
    }
  }

  return gridCellColumnsFixture(bins, { gridId: 'grid-2um', binSizeMicrometers: 2 })
}

// The bins the grid layer draws, as picking gives them.
function gridLayerCells(): readonly GridCellDatum[] {
  const gridLayer = deckGlMock.layers.find((layer) => {
    const candidate = layer as { readonly id?: string }

    return candidate.id === 'spatial-grid-cells'
  }) as
    | {
        readonly props?: {
          readonly data?: { readonly length: number }
          readonly pickObject?: (index: number) => GridCellDatum
        }
      }
    | undefined
  const pickObject = gridLayer?.props?.pickObject

  return pickObject === undefined
    ? []
    : Array.from({ length: gridLayer?.props?.data?.length ?? 0 }, (_, index) =>
        pickObject(index),
      )
}

function imageLoaderFixture(): TiffPyramidLoader {
  return {
    url: 'https://example.test/sample.ome.tif',
    channels: [],
  } as unknown as TiffPyramidLoader
}
