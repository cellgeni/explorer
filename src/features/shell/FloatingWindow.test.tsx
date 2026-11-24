import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FloatingWindow } from './FloatingWindow'
import { QUERY_WINDOW_MIN_SIZE, QUERY_WINDOW_SIZE } from './floatingWindowModel'

afterEach(() => {
  vi.unstubAllGlobals()
})

// ResizeObserver calls back on resize().
function stubResizeObserver() {
  const callbacks = new Set<() => void>()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {
        callbacks.add(callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {
        callbacks.delete(this.callback)
      }
    },
  )
  return {
    resize: () => {
      act(() => {
        for (const callback of callbacks) callback()
      })
    },
  }
}

describe('FloatingWindow', () => {
  it('opens at full size over the others when its place has no room', () => {
    const { resize } = stubResizeObserver()
    const { container } = render(
      <FloatingWindow
        title="Cell Query"
        status="No dataset"
        closeTitle="Close cell query"
        controlName="cell query panel"
        className="shell-query"
        bodyClassName="shell-query-body"
        defaultSize={QUERY_WINDOW_SIZE}
        minSize={QUERY_WINDOW_MIN_SIZE}
        // Past 360 and 480 px windows: 520 px fit only 548 px from the right
        // of a 1080 px canvas.
        rightOffset={868}
        open
        onClose={vi.fn()}
      >
        <p>Conditions</p>
      </FloatingWindow>,
    )
    Object.defineProperty(container, 'clientWidth', { value: 1080, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 852, configurable: true })
    resize()
    const panel = screen.getByRole('region', { name: 'Cell Query' })
    const grip = screen.getByRole('button', { name: 'Move the cell query panel' })

    // Its place, which .shell-floating keeps inside the canvas, and where it
    // is drawn.
    expect(panel.style.getPropertyValue('--floating-right')).toBe('868px')
    expect(panel.style.width).toBe('520px')
    expect(grip).toHaveAccessibleDescription('12 px from the top, 548 px from the right')

    // Resizing pins it where it is drawn, so its right edge stays put.
    const resizeGrip = screen.getByRole('button', { name: 'Resize the cell query panel' })
    fireEvent.keyDown(resizeGrip, { key: 'ArrowRight' })
    expect(panel.style.getPropertyValue('--floating-right')).toBe('548px')
    expect(panel.style.width).toBe('500px')
    expect(grip).toHaveAccessibleDescription('12 px from the top, 548 px from the right')
  })

  // Under 860 px a window is full width: its grip changes only the height,
  // so the width it has on wide screens stays (EXP-302).
  it('changes only the height of a full-width window', () => {
    stubResizeObserver()
    const props = {
      title: 'Cell Query',
      status: 'No dataset',
      closeTitle: 'Close cell query',
      controlName: 'cell query panel',
      className: 'shell-query',
      bodyClassName: 'shell-query-body',
      defaultSize: QUERY_WINDOW_SIZE,
      minSize: QUERY_WINDOW_MIN_SIZE,
      open: true,
      onClose: vi.fn(),
      children: <p>Conditions</p>,
    }
    const { rerender } = render(<FloatingWindow {...props} fullWidth />)
    const grip = screen.getByRole('button', { name: 'Resize the cell query panel' })
    expect(grip).toHaveAccessibleDescription(`${QUERY_WINDOW_SIZE.height} px high`)
    expect(grip.title).toContain('up and down arrow keys')

    for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowLeft']) {
      fireEvent.keyDown(grip, { key })
    }
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(grip).toHaveAccessibleDescription(`${QUERY_WINDOW_SIZE.height + 20} px high`)

    rerender(<FloatingWindow {...props} />)
    const panel = screen.getByRole('region', { name: 'Cell Query' })
    expect(panel.style.width).toBe(`${QUERY_WINDOW_SIZE.width}px`)
  })

  it('leaves a field on the first Esc and closes on the second, as the drawer', () => {
    stubResizeObserver()
    const onClose = vi.fn()
    render(
      <FloatingWindow
        title="Cell Query"
        status="Ready"
        closeTitle="Close cell query"
        controlName="cell query panel"
        className="shell-query"
        bodyClassName="shell-query-body"
        defaultSize={QUERY_WINDOW_SIZE}
        minSize={QUERY_WINDOW_MIN_SIZE}
        open
        onClose={onClose}
      >
        <input aria-label="Value" type="text" title="Value" />
      </FloatingWindow>,
    )
    const field = screen.getByRole('textbox', { name: 'Value' })
    field.focus()

    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.getByRole('region', { name: 'Cell Query' })).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
