import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { ViewerTranscriptHoverDetail } from '../../components/viewerCoreTypes'
import type { TranscriptPointDatum } from '../../rendering/deckLayers'
import { sameTranscriptHoverTarget, useTranscriptHover } from './useTranscriptHover'

function transcript(id: string): TranscriptPointDatum {
  return {
    id,
    position: [1, -1, 0],
    featureName: 'GENE1',
    fovName: null,
    cellId: null,
    qv: 30,
    fillColor: [1, 2, 3, 255],
  }
}

function hoverAt(target: TranscriptPointDatum, x: number): ViewerTranscriptHoverDetail {
  return { transcript: target, screen: { x, y: 10 } }
}

describe('useTranscriptHover (O6)', () => {
  it('renders App once for repeated moves over one transcript, again for the next', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      const [hovered, setHovered] = useState<ViewerTranscriptHoverDetail | null>(null)

      return { hovered, ...useTranscriptHover(setHovered) }
    })
    const first = transcript('t1')
    const second = transcript('t2')
    const rendersBefore = renders

    for (let x = 0; x < 20; x += 1) {
      act(() => {
        result.current.handleTranscriptHover(hoverAt(first, x))
      })
    }

    // The first move renders; React may call the component once more before
    // it bails out of an unchanged state, never once a move.
    expect(renders - rendersBefore).toBeLessThanOrEqual(2)
    expect(result.current.hovered?.transcript).toBe(first)
    // The tooltip's position is the viewer's; the dump reads the latest.
    expect(result.current.latestTranscriptHoverRef.current?.screen.x).toBe(19)

    const rendersOnFirst = renders

    act(() => {
      result.current.handleTranscriptHover(hoverAt(second, 0))
    })
    act(() => {
      result.current.handleTranscriptHover(null)
    })

    expect(renders - rendersOnFirst).toBe(2)
    expect(result.current.hovered).toBeNull()
    expect(result.current.latestTranscriptHoverRef.current).toBeNull()
  })

  it('compares the transcript or bin hovered, not the pointer', () => {
    const point = transcript('t1')

    expect(sameTranscriptHoverTarget(hoverAt(point, 1), hoverAt(point, 2))).toBe(true)
    expect(
      sameTranscriptHoverTarget(hoverAt(point, 1), hoverAt(transcript('t1'), 1)),
    ).toBe(false)
    expect(sameTranscriptHoverTarget(null, hoverAt(point, 1))).toBe(false)
    expect(sameTranscriptHoverTarget(null, null)).toBe(true)
  })
})
