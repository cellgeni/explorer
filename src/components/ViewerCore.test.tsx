import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewerCore } from './ViewerCore'
import { scaffoldDeckLayerCount } from './viewerCoreModel'

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
    fireEvent.pointerUp(roiLayer, { clientX: 116, clientY: 66, pointerId: 1 })

    const bbox = onRoiComplete.mock.calls[0]?.[0]
    expect(bbox).toMatchObject({
      minX: 0,
      maxX: 256,
      minY: 0,
      maxY: 256,
    })
  })
})
