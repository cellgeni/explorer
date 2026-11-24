import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonBlock } from './StructureBrowser'

// jsdom lays nothing out, so each test says how tall the text is.
function textHeight(height: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'PRE' ? height : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'PRE' ? 240 : 0
  })
}

describe('JsonBlock', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a named Tab stop when it scrolls, so the keyboard can scroll it', () => {
    textHeight(900)
    render(<JsonBlock title="Attributes" value={{ a: 1 }} />)

    const block = screen.getByRole('region', { name: 'Attributes' })
    expect(block.tagName).toBe('PRE')
    expect(block).toHaveAttribute('tabindex', '0')
  })

  it('names a block without a title as metadata', () => {
    textHeight(900)
    render(<JsonBlock value={{ zarr_format: 3 }} />)

    expect(screen.getByRole('region', { name: 'Metadata' })).toHaveAttribute(
      'tabindex',
      '0',
    )
  })

  it('is no Tab stop when it fits, until longer text replaces it', async () => {
    textHeight(100)
    const { container, rerender } = render(
      <JsonBlock title="Attributes" value={{ a: 1 }} />,
    )
    const block = container.querySelector('pre')!
    expect(block).not.toHaveAttribute('tabindex')
    expect(screen.queryByRole('region')).toBeNull()

    textHeight(900)
    rerender(<JsonBlock title="Attributes" value={{ a: 1, b: 'a much longer value' }} />)

    expect(await screen.findByRole('region', { name: 'Attributes' })).toBe(block)
  })
})
