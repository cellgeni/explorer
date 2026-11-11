import { describe, expect, it } from 'vitest'
import {
  isFitKey,
  isLayerPanelKey,
  SHORTCUTS,
  TOOL_ORDER,
  TOOL_SHORTCUT_KEYS,
  toolForShortcutKey,
} from './shortcuts'

function key(
  value: string,
  modifiers: Partial<Record<'alt' | 'ctrl' | 'meta', boolean>> = {},
) {
  return {
    key: value,
    altKey: modifiers.alt ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
  }
}

describe('shortcuts', () => {
  it('picks each tool by its letter, in either case', () => {
    expect(toolForShortcutKey(key('p'))).toBe('pan')
    expect(toolForShortcutKey(key('R'))).toBe('box')
    expect(toolForShortcutKey(key('l'))).toBe('lasso')
    expect(toolForShortcutKey(key('m'))).toBe('measure')
    expect(toolForShortcutKey(key('o'))).toBe('magic-lens')
    expect(toolForShortcutKey(key('x'))).toBeNull()
  })

  it('leaves keys with modifiers to the browser', () => {
    expect(toolForShortcutKey(key('r', { meta: true }))).toBeNull()
    expect(toolForShortcutKey(key('l', { ctrl: true }))).toBeNull()
    expect(toolForShortcutKey(key('m', { alt: true }))).toBeNull()
  })

  it('lists every tool key once in the shortcut table', () => {
    const letters = TOOL_ORDER.map((tool) => TOOL_SHORTCUT_KEYS[tool])
    const listed = SHORTCUTS.flatMap((shortcut) => shortcut.keys)

    expect(new Set(letters).size).toBe(letters.length)
    for (const letter of letters) {
      expect(listed.filter((listedKey) => listedKey === letter)).toHaveLength(1)
    }
  })

  it('hides the layer panel with a backslash', () => {
    expect(isLayerPanelKey(key('\\'))).toBe(true)
    expect(isLayerPanelKey(key('\\', { meta: true }))).toBe(false)
    expect(toolForShortcutKey(key('\\'))).toBeNull()
    expect(SHORTCUTS.some((shortcut) => shortcut.keys.includes('\\'))).toBe(true)
  })

  it('fits the view with F, which no tool uses', () => {
    expect(isFitKey(key('f'))).toBe(true)
    expect(isFitKey(key('F', { ctrl: true }))).toBe(false)
    expect(toolForShortcutKey(key('f'))).toBeNull()
    expect(SHORTCUTS.find((shortcut) => shortcut.keys.includes('F'))?.action).toBe(
      'Fit the data to the view',
    )
  })
})
