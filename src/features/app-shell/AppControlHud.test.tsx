import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppControlHud } from './AppControlHud'

type Props = ComponentProps<typeof AppControlHud>

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    activeControlHudTab: 'dataset',
    appendDebugEvent: vi.fn(),
    children: <div data-testid="hud-child">Dataset controls</div>,
    isControlHudCollapsed: false,
    loadingTabIds: new Set(),
    loadingTasks: [],
    setActiveControlHudTab: vi.fn(),
    setIsControlHudCollapsed: vi.fn(),
    ...overrides,
  }
}

describe('AppControlHud', () => {
  it('renders tab children inside the shell', () => {
    render(<AppControlHud {...baseProps()} />)

    expect(screen.getByTestId('hud-child')).toHaveTextContent('Dataset controls')
  })

  it('routes shell tab and collapse actions through debug logging', () => {
    const props = baseProps()

    render(<AppControlHud {...props} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Layers' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide Controls' }))

    expect(props.setActiveControlHudTab).toHaveBeenCalledWith('layers')
    expect(props.appendDebugEvent).toHaveBeenCalledWith('HUD tab: Layers', {
      coalesceKey: 'hud-tab',
    })
    expect(props.setIsControlHudCollapsed).toHaveBeenCalledWith(true)
    expect(props.appendDebugEvent).toHaveBeenCalledWith('HUD collapsed')
  })
})
