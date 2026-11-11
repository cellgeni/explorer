import { describe, expect, it } from 'vitest'
import {
  GENE_EXPRESSION_COLOR_SCALE_OPTIONS,
  TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS,
  geneExpressionColor,
  geneExpressionScaleGradient,
  transcriptDensityColor,
  transcriptDensityScaleGradient,
} from './deckLayerColors'
import type { Color } from '@deck.gl/core'

function cssStop(color: Color, position: string): string {
  const [red, green, blue, alpha = 255] = color
  return `rgba(${red}, ${green}, ${blue}, ${Math.round((alpha / 255) * 100) / 100}) ${position}`
}

describe('colour scale gradients', () => {
  it('writes the stops as a left-to-right CSS gradient', () => {
    expect(geneExpressionScaleGradient('plasma')).toBe(
      'linear-gradient(90deg, rgba(13, 8, 135, 0.51) 0%, ' +
        'rgba(203, 71, 119, 0.8) 50%, rgba(240, 249, 33, 0.96) 100%)',
    )
  })

  it.each(GENE_EXPRESSION_COLOR_SCALE_OPTIONS.map((option) => option.id))(
    'matches the map colours of the %s gene expression scale',
    (scale) => {
      expect(geneExpressionScaleGradient(scale)).toBe(
        `linear-gradient(90deg, ${cssStop(geneExpressionColor(scale, 0), '0%')}, ` +
          `${cssStop(geneExpressionColor(scale, 0.5), '50%')}, ` +
          `${cssStop(geneExpressionColor(scale, 1), '100%')})`,
      )
    },
  )

  it.each(TRANSCRIPT_DENSITY_COLOR_SCALE_OPTIONS.map((option) => option.id))(
    'matches the map colours of the %s transcript density scale',
    (scale) => {
      expect(transcriptDensityScaleGradient(scale)).toBe(
        `linear-gradient(90deg, ${cssStop(transcriptDensityColor(scale, 0), '0%')}, ` +
          `${cssStop(transcriptDensityColor(scale, 0.5), '50%')}, ` +
          `${cssStop(transcriptDensityColor(scale, 1), '100%')})`,
      )
    },
  )
})
