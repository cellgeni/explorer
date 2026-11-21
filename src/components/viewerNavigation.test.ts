import type { KeyboardEvent } from 'react'
import { describe, expect, it } from 'vitest'
import type { OverviewViewState } from '../rendering/deckLayers'
import { equivalentViewState, viewStateFromKeyboardEvent } from './viewerNavigation'

function key(
  name: string,
  modifiers: Partial<
    Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>
  > = {},
): KeyboardEvent<HTMLDivElement> {
  return {
    key: name,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers,
  } as KeyboardEvent<HTMLDivElement>
}

function view(zoom: number): OverviewViewState {
  return { target: [100, -200, 0], zoom, minZoom: -10, maxZoom: 10 }
}

// The view's centre in data coordinates (y down) and how far it moved, in
// screen px. Deck y is data y negated.
function screenMove(from: OverviewViewState, to: OverviewViewState): [number, number] {
  const scale = 2 ** from.zoom
  return [
    (to.target[0] - from.target[0]) * scale,
    (-to.target[1] - -from.target[1]) * scale,
  ]
}

describe('keyboard navigation', () => {
  it.each([0, 10])('pans 64 screen px the way each arrow points at zoom %i', (zoom) => {
    const start = view(zoom)
    const moves = Object.fromEntries(
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].map((name) => {
        const next = viewStateFromKeyboardEvent(key(name), start, start)
        expect(next).not.toBeNull()
        // ViewerCore keeps the current view when the two are equivalent.
        expect(equivalentViewState(start, next!), name).toBe(false)
        return [name, screenMove(start, next!)]
      }),
    )

    // The view moves toward the arrow: Up shows more of the top of the image.
    expect(moves.ArrowLeft?.[0]).toBeCloseTo(-64)
    expect(moves.ArrowRight?.[0]).toBeCloseTo(64)
    expect(moves.ArrowUp?.[1]).toBeCloseTo(-64)
    expect(moves.ArrowDown?.[1]).toBeCloseTo(64)
    expect(moves.ArrowLeft?.[1]).toBeCloseTo(0)
    expect(moves.ArrowUp?.[0]).toBeCloseTo(0)
  })

  it('pans 256 screen px with Shift, at the highest zoom too', () => {
    const start = view(10)
    const next = viewStateFromKeyboardEvent(
      key('ArrowUp', { shiftKey: true }),
      start,
      start,
    )

    expect(screenMove(start, next!)[1]).toBeCloseTo(-256)
  })

  it.each([
    ['+', { ctrlKey: true }],
    ['=', { ctrlKey: true }],
    ['-', { ctrlKey: true }],
    ['=', { metaKey: true }],
    ['-', { metaKey: true }],
    ['ArrowLeft', { altKey: true }],
    ['ArrowRight', { metaKey: true }],
    ['ArrowUp', { ctrlKey: true }],
    ['Home', { metaKey: true }],
  ] as const)('leaves %s with %o to the browser', (name, modifiers) => {
    const start = view(0)

    // ViewerCore calls preventDefault() only when this is not null.
    expect(viewStateFromKeyboardEvent(key(name, modifiers), start, start)).toBeNull()
  })
})

describe('equivalentViewState', () => {
  it('measures its tolerance in screen pixels', () => {
    const target = (zoom: number, dx: number): OverviewViewState => ({
      ...view(zoom),
      target: [100 + dx, -200, 0],
    })

    // At zoom 10 one data unit is 1024 px: a 20 px drag is not dropped.
    expect(equivalentViewState(view(10), target(10, 20 / 1024))).toBe(false)
    expect(equivalentViewState(view(10), target(10, 0.4 / 1024))).toBe(true)
    // At zoom -5 one screen px is 32 data units.
    expect(equivalentViewState(view(-5), target(-5, 32))).toBe(false)
    expect(equivalentViewState(view(-5), target(-5, 8))).toBe(true)
    expect(equivalentViewState(view(0), view(0.5))).toBe(false)
  })
})
