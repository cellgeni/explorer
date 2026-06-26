import type { CSSProperties } from 'react'
import { scaleFromZoom } from '../data/coords'
import type { OverviewViewState } from '../rendering/deckLayers'
import type { CssViewportSize } from '../rendering/morphologyCanvas'
import type { ViewerMagicLensStatus, ViewerMagicLensSummary } from './viewerCoreTypes'
import type { ScreenPoint } from './viewerMeasurements'

export interface MagicLensOverlayModel {
  readonly circleStyle: CSSProperties
  readonly hudStyle: CSSProperties
}

export function magicLensOverlayModel(
  screen: ScreenPoint,
  radiusMicrometers: number,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
  status: ViewerMagicLensStatus,
  summary: ViewerMagicLensSummary | null,
): MagicLensOverlayModel {
  const radiusPixels = Math.max(10, radiusMicrometers * scaleFromZoom(viewState.zoom))
  const hudWidth = 190
  const geneCount = Math.min(summary?.topGenes.length ?? 1, 8)
  const hudHeight = status === 'loading' ? 58 : 46 + geneCount * 22
  const gap = 10
  let hudLeft = screen.x + radiusPixels + gap
  let hudTop = screen.y - hudHeight / 2

  if (hudLeft + hudWidth > viewport.width - 8) {
    hudLeft = screen.x - radiusPixels - gap - hudWidth
  }

  hudTop = Math.max(8, Math.min(viewport.height - hudHeight - 8, hudTop))

  return {
    circleStyle: {
      left: screen.x,
      top: screen.y,
      width: radiusPixels * 2,
      height: radiusPixels * 2,
    },
    hudStyle: {
      left: Math.max(8, hudLeft),
      top: hudTop,
      width: hudWidth,
    },
  }
}
