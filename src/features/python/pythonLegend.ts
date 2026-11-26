import type {
  PythonLegendItem,
  PythonLegendSection,
} from '../../components/viewerLegendTypes'
import type { PythonOverlay } from '../../rendering/pythonOverlay'
import { formatGeneScaleValue } from '../genes/geneControlsModel'
import { PYTHON_SHOWN_ITEM_ID, pythonLayerItemId } from './pythonLayerStore'

export const PYTHON_LEGEND_ID = 'python'

// The legend's Python section (plan 29-D8): each layer with its swatch or
// ramp, and the cells show() keeps. Null without layers.
export function pythonLegendSection(
  overlay: PythonOverlay,
  cellCount: number,
  noun: { readonly singular: string; readonly plural: string },
): PythonLegendSection | null {
  if (overlay.cellCount !== cellCount || cellCount === 0) return null
  const items: PythonLegendItem[] = overlay.layers.map((layer) => ({
    id: pythonLayerItemId(layer),
    label: layer.name,
    count: layer.rows.length,
    swatch:
      layer.kind === 'highlight'
        ? { kind: 'ring', color: `rgb(${layer.color.join(', ')})` }
        : layer.legend.kind === 'color'
          ? { kind: 'color', color: layer.legend.color }
          : {
              kind: 'ramp',
              gradient: layer.legend.gradient,
              min: formatGeneScaleValue(layer.legend.min),
              max: formatGeneScaleValue(layer.legend.max),
            },
  }))

  if (overlay.shown !== null) {
    items.push({
      id: PYTHON_SHOWN_ITEM_ID,
      label: `Shown: ${overlay.shown.length.toLocaleString()} of ${cellCount.toLocaleString()}`,
      count: overlay.shown.length,
      swatch: { kind: 'shown' },
    })
  }

  if (items.length === 0) return null
  const colored = overlay.layers.some((layer) => layer.kind === 'color')

  return {
    kind: 'python',
    id: PYTHON_LEGEND_ID,
    title: 'Python',
    items,
    detail: colored
      ? `Other ${noun.plural} ${overlay.others === 'hide' ? 'hidden' : 'faded'}`
      : undefined,
    noun,
  }
}
