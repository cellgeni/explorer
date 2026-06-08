import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MagicLensHudPanel } from './MagicLensHudPanel'

describe('MagicLensHudPanel', () => {
  it('renders cursor lens controls and forwards changes', () => {
    const onScopeChange = vi.fn()
    const onRadiusChange = vi.fn()
    const onMinQvChange = vi.fn()
    const onCursorActiveChange = vi.fn()

    render(
      <MagicLensHudPanel
        active
        magicLensScopeInputId="lens-scope"
        magicLensRadiusInputId="lens-radius"
        magicLensMinQvInputId="lens-qv"
        magicLensCopy="Lens off"
        loadEnabled
        roiAvailable={false}
        magicLensScope="cursor"
        magicLensState={{ status: 'idle' }}
        magicLensRadiusMicrometers={80}
        magicLensMinQv={20}
        magicLensIsCursorActive={false}
        magicLensCanScan={false}
        onScopeChange={onScopeChange}
        onRadiusChange={onRadiusChange}
        onMinQvChange={onMinQvChange}
        onCursorActiveChange={onCursorActiveChange}
        onRunMagicLens={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'ROI' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Viewport' }))
    fireEvent.change(screen.getByLabelText('Radius'), { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText('Min QV'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enable Lens' }))

    expect(onScopeChange).toHaveBeenCalledWith('viewport')
    expect(onRadiusChange).toHaveBeenCalledWith(120)
    expect(onMinQvChange).toHaveBeenCalledWith(30)
    expect(onCursorActiveChange).toHaveBeenCalledWith(true)
  })

  it('runs viewport scans when the current scope can scan', () => {
    const onRunMagicLens = vi.fn()

    render(
      <MagicLensHudPanel
        active
        magicLensScopeInputId="lens-scope"
        magicLensRadiusInputId="lens-radius"
        magicLensMinQvInputId="lens-qv"
        magicLensCopy="Ready"
        loadEnabled
        roiAvailable
        magicLensScope="viewport"
        magicLensState={{ status: 'idle' }}
        magicLensRadiusMicrometers={80}
        magicLensMinQv={20}
        magicLensIsCursorActive={false}
        magicLensCanScan
        onScopeChange={vi.fn()}
        onRadiusChange={vi.fn()}
        onMinQvChange={vi.fn()}
        onCursorActiveChange={vi.fn()}
        onRunMagicLens={onRunMagicLens}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Scan Lens' }))

    expect(onRunMagicLens).toHaveBeenCalledTimes(1)
  })
})
