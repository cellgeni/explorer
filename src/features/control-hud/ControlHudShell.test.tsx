import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ControlHudShell } from './ControlHudShell'

describe('ControlHudShell', () => {
  it('toggles collapse state and switches active tabs', () => {
    const onCollapsedChange = vi.fn()
    const onActiveTabChange = vi.fn()

    render(
      <ControlHudShell
        collapsed={false}
        activeTab="dataset"
        loadingTabIds={new Set(['genes'])}
        onCollapsedChange={onCollapsedChange}
        onActiveTabChange={onActiveTabChange}
      >
        <div>Panel content</div>
      </ControlHudShell>,
    )

    expect(screen.getByRole('tab', { name: 'Dataset' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Genes' })).toHaveAttribute(
      'aria-busy',
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Hide Controls' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Genes' }))

    expect(onCollapsedChange).toHaveBeenCalledWith(true)
    expect(onActiveTabChange).toHaveBeenCalledWith('genes', 'Genes')
  })

  it('omits hidden tabs from the tab list', () => {
    render(
      <ControlHudShell
        collapsed={false}
        activeTab="dataset"
        hiddenTabIds={new Set(['transcripts'])}
        loadingTabIds={new Set()}
        onCollapsedChange={vi.fn()}
        onActiveTabChange={vi.fn()}
      >
        <div>Panel content</div>
      </ControlHudShell>,
    )

    expect(screen.getByRole('tab', { name: 'Genes' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Transcripts' })).not.toBeInTheDocument()
  })
})
