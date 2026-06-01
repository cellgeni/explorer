import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ViewerCore } from './ViewerCore'
import { scaffoldDeckLayerCount } from './viewerCoreModel'

describe('ViewerCore', () => {
  it('renders the canvas/deck surface shell', () => {
    render(<ViewerCore />)

    expect(scaffoldDeckLayerCount).toBe(1)
    expect(
      screen.getByRole('img', { name: 'Spatial viewer canvas area' }),
    ).toBeInTheDocument()
    expect(document.querySelector('canvas.morphology-canvas')).toBeInTheDocument()
  })
})
