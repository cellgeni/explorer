import { describe, expect, it } from 'vitest'
import {
  isFitKey,
  isHelpKey,
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

  it('picks tools and Fit by where the key is when the layout types another script', () => {
    // Russian: the P key types "з", the F key "а".
    expect(toolForShortcutKey({ ...key('з'), code: 'KeyP' })).toBe('pan')
    expect(isFitKey({ ...key('а'), code: 'KeyF' })).toBe(true)
    // An input method has the key.
    expect(toolForShortcutKey({ ...key('Process'), code: 'KeyR' })).toBe('box')
    // A layout's own Latin letters win: AZERTY types "a" at the US Q.
    expect(toolForShortcutKey({ ...key('p'), code: 'KeyR' })).toBe('pan')
    expect(toolForShortcutKey({ ...key('a'), code: 'KeyQ' })).toBeNull()
    // Not a letter key.
    expect(toolForShortcutKey({ ...key('1'), code: 'Digit1' })).toBeNull()
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
    // AltGr (Ctrl and Alt on Windows) on German or French layouts, Option on
    // a Mac.
    expect(isLayerPanelKey(key('\\', { ctrl: true, alt: true }))).toBe(true)
    expect(isLayerPanelKey(key('\\', { alt: true }))).toBe(true)
    expect(isLayerPanelKey(key('\\', { ctrl: true }))).toBe(false)
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

  it('opens Help with ?, typed with or without Shift', () => {
    expect(isHelpKey(key('?'))).toBe(true)
    const shifted = { ...key('?'), shiftKey: true }
    expect(isHelpKey(shifted)).toBe(true)
    expect(isHelpKey(key('?', { meta: true }))).toBe(false)
    expect(isHelpKey(key('/'))).toBe(false)
    expect(SHORTCUTS.find((shortcut) => shortcut.keys.includes('?'))?.action).toBe(
      'Show or hide this help',
    )
  })

  it('prints the keys as typed', () => {
    const zoom = SHORTCUTS.find((shortcut) => shortcut.action === 'Zoom in or out')
    expect(zoom?.keys).toEqual(['+', '-'])
  })
})
