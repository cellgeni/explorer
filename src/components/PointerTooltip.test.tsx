import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PointerTooltip } from './PointerTooltip'

// Layout from jsdom is all zeros: the frame is 920 × 672 and the tooltip
// 320 × 120.
function stubLayout() {
  const size = (element: HTMLElement, frame: number, tooltip: number) =>
    element.classList.contains('frame') ? frame : tooltip
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return size(this, 920, 320)
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return size(this, 672, 120)
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(920)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(672)
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.closest('.frame')
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PointerTooltip (EXP-304)', () => {
  it('sits beside the pointer, and flips near the right and bottom edges', () => {
    stubLayout()
    const { getByText, rerender } = render(
      <div className="frame">
        <PointerTooltip x={100} y={100} className="tip">
          Cell 1
        </PointerTooltip>
      </div>,
    )
    const tooltip = getByText('Cell 1')
    expect(tooltip).toHaveAttribute('aria-hidden', 'true')
    expect(tooltip.style.left).toBe('100px')
    expect(tooltip.style.transform).toBe('translate(10px, 10px)')

    rerender(
      <div className="frame">
        <PointerTooltip x={896} y={633} className="tip">
          Cell 1
        </PointerTooltip>
      </div>,
    )
    expect(tooltip.style.transform).toBe('translate(-330px, -130px)')
  })
})
