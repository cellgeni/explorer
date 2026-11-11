import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ActiveTool } from '../app-shell/activeToolModel'
import { useToolShortcuts } from './useToolShortcuts'

function Probe({
  enabled,
  onSelect,
}: {
  readonly enabled: boolean
  readonly onSelect: (tool: ActiveTool) => void
}) {
  useToolShortcuts(enabled, onSelect)
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
