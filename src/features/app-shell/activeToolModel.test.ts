import { describe, expect, it } from 'vitest'
import {
  isTextEntryTarget,
  resolveStateAction,
  roiModeForTool,
  toolAfterMagicLens,
  toolAfterMeasurement,
  toolAfterRoiMode,
} from './activeToolModel'

describe('activeToolModel', () => {
  it('lets one tool replace another', () => {
    expect(toolAfterRoiMode('magic-lens', 'box')).toBe('box')
    expect(toolAfterMeasurement('lasso', true)).toBe('measure')
    expect(toolAfterMagicLens('measure', true)).toBe('magic-lens')
  })

  it('returns to Pan only when the active tool turns off', () => {
    expect(toolAfterRoiMode('box', 'idle')).toBe('pan')
    expect(toolAfterRoiMode('measure', 'idle')).toBe('measure')
    expect(toolAfterMeasurement('measure', false)).toBe('pan')
    expect(toolAfterMeasurement('magic-lens', false)).toBe('magic-lens')
    expect(toolAfterMagicLens('magic-lens', false)).toBe('pan')
    expect(toolAfterMagicLens('box', false)).toBe('box')
  })

  it('reads the ROI mode and functional updates', () => {
    expect(roiModeForTool('lasso')).toBe('lasso')
    expect(roiModeForTool('measure')).toBe('idle')
    expect(resolveStateAction((on: boolean) => !on, false)).toBe(true)
    expect(resolveStateAction(true, false)).toBe(true)
  })

  it('leaves Esc to text fields', () => {
    const text = document.createElement('input')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'

    expect(isTextEntryTarget(text)).toBe(true)
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true)
    expect(isTextEntryTarget(checkbox)).toBe(false)
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})
