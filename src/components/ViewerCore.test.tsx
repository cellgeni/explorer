import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewerCore } from './ViewerCore'
import { scaffoldDeckLayerCount } from './viewerCoreModel'
import type { OverviewCellDatum, TranscriptPointDatum } from '../rendering/deckLayers'

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

const deckGlMock = vi.hoisted(() => ({
  onHover: undefined as MockDeckHover | undefined,
  onClick: undefined as MockDeckClick | undefined,
}))

vi.mock('@deck.gl/react', () => ({
  DeckGL: ({
    layers = [],
    onHover,
    onClick,
  }: {
    readonly layers?: readonly unknown[]
    readonly onHover?: MockDeckHover
    readonly onClick?: MockDeckClick
  }) => {
    deckGlMock.onHover = onHover
    deckGlMock.onClick = onClick

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

afterEach(() => {
  deckGlMock.onHover = undefined
  deckGlMock.onClick = undefined
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

  it('applies image opacity to the morphology canvas', () => {
    render(<ViewerCore imageOpacity={0.4} />)

    expect(document.querySelector('canvas.morphology-canvas')).toHaveStyle({
      opacity: '0.4',
    })
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
