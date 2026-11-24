import { describe, expect, it } from 'vitest'
import {
  QUERY_WINDOW_SIZE,
  windowOpensUnderDrawer,
  narrowShownWindow,
} from './floatingWindowModel'

describe('windowOpensUnderDrawer (EXP-029)', () => {
  it('says a window would start under the drawer on a 1024 px screen', () => {
    // A 664 px canvas beside the docked layer panel, under a 380 px drawer.
    expect(
      windowOpensUnderDrawer({
        canvasWidth: 664,
        drawerRight: 380,
        rightOffset: undefined,
        width: QUERY_WINDOW_SIZE.width,
      }),
    ).toBe(true)
  })

  it('leaves a window clear of the drawer alone', () => {
    expect(
      windowOpensUnderDrawer({
        canvasWidth: 1280,
        drawerRight: 380,
        rightOffset: undefined,
        width: QUERY_WINDOW_SIZE.width,
      }),
    ).toBe(false)
  })

  it('counts the windows already open to its right', () => {
    // 1280 - 380 - 520 = 380: starts at the drawer's edge.
    expect(
      windowOpensUnderDrawer({
        canvasWidth: 1280,
        drawerRight: 380,
        rightOffset: 380,
        width: QUERY_WINDOW_SIZE.width,
      }),
    ).toBe(false)
    expect(
      windowOpensUnderDrawer({
        canvasWidth: 1280,
        drawerRight: 380,
        rightOffset: 868,
        width: QUERY_WINDOW_SIZE.width,
      }),
    ).toBe(true)
  })
})

describe('narrowShownWindow', () => {
  const allOpen = { embedding: true, plots: true, query: true }

  it('shows the window in front, else the first open in the top bar order', () => {
    expect(narrowShownWindow(allOpen, 'query')).toBe('query')
    expect(narrowShownWindow(allOpen, null)).toBe('embedding')
    expect(narrowShownWindow({ ...allOpen, embedding: false }, null)).toBe('plots')
    // The front window was closed.
    expect(narrowShownWindow({ ...allOpen, query: false }, 'query')).toBe('embedding')
    expect(
      narrowShownWindow({ embedding: false, plots: false, query: false }, 'plots'),
    ).toBeNull()
  })
})
