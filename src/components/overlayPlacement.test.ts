import { describe, expect, it } from 'vitest'
import {
  centredLabelShift,
  OVERLAY_EDGE,
  POINTER_TOOLTIP_OFFSET,
  pointerTooltipOffset,
} from './overlayPlacement'

describe('pointerTooltipOffset (EXP-304)', () => {
  it('puts a tooltip after the pointer where it fits', () => {
    expect(pointerTooltipOffset(100, 320, 920)).toBe(POINTER_TOOLTIP_OFFSET)
  })

  it('flips a tooltip before the pointer near the far edge', () => {
    // A 320 px tooltip at x 896 of a 920 px canvas showed 14 px.
    expect(pointerTooltipOffset(896, 320, 920)).toBe(-(POINTER_TOOLTIP_OFFSET + 320))
    // And above the pointer near the bottom.
    expect(pointerTooltipOffset(633, 180, 672)).toBe(-(POINTER_TOOLTIP_OFFSET + 180))
  })

  it('keeps a tooltip that fits neither side as far inside as it goes', () => {
    // A 265 px side panel: 216 of a 320 px tooltip lay outside.
    const offset = pointerTooltipOffset(150, 240, 265)
    expect(150 + offset).toBe(265 - OVERLAY_EDGE - 240)
    // Wider than the frame, it keeps its start inside.
    expect(150 + pointerTooltipOffset(150, 320, 265)).toBe(OVERLAY_EDGE)
  })
})

describe('centredLabelShift (EXP-304)', () => {
  it('leaves a label that fits where it is', () => {
    expect(centredLabelShift(400, 63, 920)).toBe(0)
  })

  it('moves a label near either edge back inside', () => {
    // "36.1 µm" (63 px) over a line 6 px from the left lost 23 px.
    expect(6 + centredLabelShift(6, 63, 920) - 63 / 2).toBe(OVERLAY_EDGE)
    expect(914 + centredLabelShift(914, 63, 920) + 63 / 2).toBe(920 - OVERLAY_EDGE)
  })
})
