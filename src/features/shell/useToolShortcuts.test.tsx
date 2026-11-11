import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ActiveTool } from '../app-shell/activeToolModel'
import { useToolShortcuts } from './useToolShortcuts'

function Probe({
  enabled,
  onSelect,
  onFit,
}: {
  readonly enabled: boolean
  readonly onSelect: (tool: ActiveTool) => void
  readonly onFit?: () => void
}) {
  useToolShortcuts(enabled, onSelect, onFit)
  return <input aria-label="Search" title="Search" />
}

describe('useToolShortcuts', () => {
  it('picks tools from their letters', () => {
    const onSelect = vi.fn()
    render(<Probe enabled onSelect={onSelect} />)

    fireEvent.keyDown(document.body, { key: 'r' })
    fireEvent.keyDown(document.body, { key: 'M' })
    fireEvent.keyDown(document.body, { key: 'x' })

    expect(onSelect.mock.calls).toEqual([['box'], ['measure']])
  })

  it('fits the view with F', () => {
    const onSelect = vi.fn()
    const onFit = vi.fn()
    const { getByLabelText } = render(<Probe enabled onSelect={onSelect} onFit={onFit} />)

    fireEvent.keyDown(document.body, { key: 'f' })
    fireEvent.keyDown(getByLabelText('Search'), { key: 'f' })

    expect(onFit).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('leaves typing, held keys and modifiers alone', () => {
    const onSelect = vi.fn()
    const { getByLabelText } = render(<Probe enabled onSelect={onSelect} />)

    fireEvent.keyDown(getByLabelText('Search'), { key: 'l' })
    fireEvent.keyDown(document.body, { key: 'l', repeat: true })
    fireEvent.keyDown(document.body, { key: 'l', metaKey: true })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does nothing while off', () => {
    const onSelect = vi.fn()
    render(<Probe enabled={false} onSelect={onSelect} />)

    fireEvent.keyDown(document.body, { key: 'p' })

    expect(onSelect).not.toHaveBeenCalled()
  })
})
