import type { ShareableState } from '../../data/shareableState'
import { TRANSCRIPT_EXACT_RENDER_LIMIT } from '../../data/transcriptOverlay'
import {
  DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
} from '../../rendering/deckLayers'
import { DEFAULT_CELL_FILL_OPACITY } from '../../rendering/layerOpacity'

// The value of each shareable setting when neither the link nor the dataset
// manifest sets it. useAppDomainState starts from these, so share links can
// leave them out. Settings that depend on the dataset have no entry, and
// neither does the boundary limit, which comes from the device's performance
// budget. A measure unit that is not set follows the mouse coordinate unit.
export const DEFAULT_SHAREABLE_STATE = {
  activeTab: 'dataset',
  tool: 'pan',
  hiddenLayers: [],
  selectedGenes: [],
  geneExpressionColorScale: DEFAULT_GENE_EXPRESSION_COLOR_SCALE,
  geneExpressionScoreMode: DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  geneExpressionDetailMode: 'auto',
  observationColorMode: 'transcript-count',
  coordinateUnit: 'um',
  measurementUnit: 'um',
  shouldLoadMorphology: true,
  imageOpacity: 1,
  cellFillOpacity: DEFAULT_CELL_FILL_OPACITY,
  showCellBoundaries: true,
  showNucleusBoundaries: true,
  showHoverTooltips: true,
  cellBoundaryOpacity: 1,
  transcriptOverlay: false,
  transcriptDetailMode: 'auto',
  transcriptMinQv: 20,
  transcriptGeneOnly: true,
  transcriptFeatureFilterMode: 'selected',
  transcriptDensityColorScale: DEFAULT_TRANSCRIPT_DENSITY_COLOR_SCALE,
  transcriptPointColorMode: DEFAULT_TRANSCRIPT_POINT_COLOR_MODE,
  transcriptExactPointLimit: TRANSCRIPT_EXACT_RENDER_LIMIT,
  transcriptOpacity: 0.85,
  transcriptPointSize: 2,
  magicLensScope: 'cursor',
  magicLensActive: false,
  magicLensRadiusMicrometers: 80,
  magicLensMinQv: 20,
} as const satisfies ShareableState

// The state with every default value left out, for a version 2 link
// (15.1-L). A measure unit is kept when it differs from the mouse coordinate
// unit, because a link without one measures in that unit.
export function withoutShareableDefaults(state: ShareableState): ShareableState {
  const result: Record<string, unknown> = { ...state }

  for (const [key, defaultValue] of Object.entries(DEFAULT_SHAREABLE_STATE)) {
    if (key === 'measurementUnit') continue
    if (sameValue(result[key], defaultValue)) delete result[key]
  }

  const coordinateUnit = state.coordinateUnit ?? DEFAULT_SHAREABLE_STATE.coordinateUnit
  if (state.measurementUnit === coordinateUnit) delete result.measurementUnit

  return result as ShareableState
}

function sameValue(value: unknown, defaultValue: unknown): boolean {
  if (Array.isArray(value) && Array.isArray(defaultValue)) {
    return (
      value.length === defaultValue.length &&
      value.every((item, index) => item === defaultValue[index])
    )
  }

  return value === defaultValue
}
