import type { DeckProps, LayersList } from '@deck.gl/core'
import { useCallback, useState } from 'react'

type DeckDevice = Parameters<NonNullable<DeckProps['onDeviceInitialized']>>[0]

// A GPU reset, sleep, or Chromium's limit of 16 live WebGL contexts can take a
// view's context away. luma.gl does not ask for it back, and deck.gl stops
// drawing without a word, so the cells, bins and transcripts go while the
// image (a 2D canvas) stays (EXP-325). The view is drawn again on a new canvas
// instead, which `generation` keys. Past a few losses it stops and says to
// reload: something keeps taking the context, and each new one could take
// another view's.
const MAX_REDRAWS = 3

export type DeckDeviceLossNotice = 'redrawn' | 'stopped'

export interface DeckDeviceLoss {
  readonly generation: number
  readonly notice: DeckDeviceLossNotice | null
  readonly onDeviceInitialized: (device: DeckDevice) => void
  readonly dismissNotice: () => void
}

export function useDeckDeviceLoss(): DeckDeviceLoss {
  const [losses, setLosses] = useState(0)
  const [noticeShown, setNoticeShown] = useState(false)
  const onDeviceInitialized = useCallback((device: DeckDevice) => {
    void device.lost.then(() => {
      // ReleasingDeck loses the context of a view that has left the page.
      const canvas = device.canvasContext?.canvas
      if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) return
      setLosses((count) => count + 1)
      setNoticeShown(true)
    })
  }, [])
  const dismissNotice = useCallback(() => {
    setNoticeShown(false)
  }, [])

  return {
    generation: Math.min(losses, MAX_REDRAWS),
    notice: !noticeShown ? null : losses > MAX_REDRAWS ? 'stopped' : 'redrawn',
    onDeviceInitialized,
    dismissNotice,
  }
}

// New instances of the same layers, for a new Deck.
export function cloneLayers(layers: LayersList): LayersList {
  return layers.map((layer) =>
    Array.isArray(layer) ? cloneLayers(layer) : layer ? layer.clone({}) : layer,
  )
}
