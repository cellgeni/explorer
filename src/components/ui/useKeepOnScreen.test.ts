import { describe, expect, it } from 'vitest'
import { screenPlacement, SCREEN_MARGIN } from './useKeepOnScreen'

const phone = { width: 320, height: 640 }

describe('screenPlacement (EXP-297, EXP-301)', () => {
  it('leaves a panel inside the window where it is', () => {
    expect(
      screenPlacement({ left: 40, right: 280, top: 54, height: 222 }, phone),
    ).toEqual({
      shiftX: 0,
      maxHeight: null,
    })
  })

  it('moves a panel off the left edge back onto the screen', () => {
    // The Tools menu at 320 px: 240 px wide, right-aligned to a mid-bar button.
    expect(
      screenPlacement({ left: -80, right: 160, top: 54, height: 222 }, phone),
    ).toEqual({
      shiftX: 80 + SCREEN_MARGIN,
      maxHeight: null,
    })
  })

  it('moves a panel off the right edge back onto the screen', () => {
    // Measure options at 320 px: left-aligned to a chevron near the right.
    expect(
      screenPlacement({ left: 112, right: 352, top: 54, height: 120 }, phone),
    ).toEqual({
      shiftX: -(32 + SCREEN_MARGIN),
      maxHeight: null,
    })
  })

  it('keeps the left edge of a panel wider than the window on screen', () => {
    expect(
      screenPlacement({ left: 20, right: 380, top: 54, height: 120 }, phone).shiftX,
    ).toBe(SCREEN_MARGIN - 20)
  })

  it('limits the height of a panel taller than the room below it', () => {
    // Help, 566 px, on a landscape phone.
    expect(
      screenPlacement(
        { left: 400, right: 760, top: 54, height: 566 },
        { width: 844, height: 390 },
      ),
    ).toEqual({ shiftX: 0, maxHeight: 390 - SCREEN_MARGIN - 54 })
  })

  it('leaves a few rows to scroll in a very short window', () => {
    expect(
      screenPlacement(
        { left: 8, right: 300, top: 54, height: 298 },
        { width: 320, height: 120 },
      ).maxHeight,
    ).toBe(96)
  })
})
