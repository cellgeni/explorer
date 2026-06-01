import { render, screen, waitFor } from '@testing-library/react'
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
})
