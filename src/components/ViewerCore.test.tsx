import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewerCore } from './ViewerCore'
import { scaffoldDeckLayerCount } from './viewerCoreModel'
import type { OverviewCellDatum } from '../rendering/deckLayers'

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

    fireEvent.pointerMove(frame, { clientX: 100, clientY: 50 })

    expect(await screen.findByText('X 1234 μm | Y 5678 μm')).toBeInTheDocument()

    rerender(<ViewerCore cells={cells} coordinateUnit="px" micrometersPerPixel={0.5} />)
    fireEvent.pointerMove(frame, { clientX: 100, clientY: 50 })

    expect(await screen.findByText('X 2468 px | Y 11356 px')).toBeInTheDocument()

    fireEvent.pointerLeave(frame)

    await waitFor(() => {
      expect(screen.queryByText('X 2468 px | Y 11356 px')).not.toBeInTheDocument()
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
