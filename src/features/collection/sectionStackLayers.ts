import { OrbitView, type Layer, type LayerData, type PickingInfo } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'
import { DEFAULT_OVERVIEW_CELL_FILL_RGB } from '../../rendering/deckLayerColors'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import { formatGeneScaleValue } from '../genes/geneControlsModel'
import type { PreviewCells, PreviewClasses } from './collectionPreviewData'
import { hexRgb, type PreviewOverlay } from './collectionPreviewRaster'
import {
  deckPositions,
  LINKED_SECTION_CELL_RADIUS_MICROMETERS,
  scoredCells,
} from './linkedSectionLayers'

// The layers of serial sections stacked in 3D. Each section is its cells from
// its collection preview, drawn at (x, -y) and lifted to its depth by a model
// matrix, so changing the depth stretch uploads nothing. Cells are balls 10
// µm across that face the camera. The cells a section is coloured for (those
// scoring for the genes, or in a shown class; every cell without colouring)
// are drawn solid and hide what is behind them; the others are a faint
// outline of the tissue that hides nothing.

export const SECTION_STACK_VIEW = new OrbitView({
  id: 'section-stack',
  orbitAxis: 'Y',
  fovy: 50,
})

const CELL_RADIUS_MIN_PIXELS = 1
const CELL_RADIUS_MAX_PIXELS = 24
const CELL_RGBA = [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 220] as const
// Fainter than the panels' outline: many sections fall on each other.
const CONTEXT_RGBA = [...DEFAULT_OVERVIEW_CELL_FILL_RGB, 36] as const
// Context cells are blended over what is drawn, but leave the depth buffer
// alone, so they never hide a coloured cell behind them.
const CONTEXT_PARAMETERS = { depthWriteEnabled: false } as const

export interface StackSectionInput {
  readonly cells: PreviewCells
  readonly classes: PreviewClasses | null
  readonly overlay: PreviewOverlay | null
  readonly modelMatrix: Float32Array
  // The section's own gene scale: its scores drawn at the bottom and top.
  readonly scaleMin: number
  readonly scaleMax: number
}

export interface SectionStackLayerOptions {
  readonly colorScale: GeneExpressionColorScale
  // The Cell point size multiplier.
  readonly radiusScale: number
  // Whether to draw the cells a section is not coloured for.
  readonly showContext: boolean
}

// What a picked point of a solid layer is: its section, and the index of its
// cell (in PreviewCells) or score (in PreviewScores).
export interface StackPick {
  readonly section: number
  readonly kind: 'cell' | 'score'
  readonly index: number
}

interface PickTarget {
  readonly section: number
  readonly kind: 'cell' | 'score'
  // Drawn point to cell or score index; null when they are the same.
  readonly order: Uint32Array | null
}

export interface SectionStackLayers {
  readonly layers: readonly Layer[]
  readonly targets: ReadonlyMap<string, PickTarget>
}

export function sectionStackLayers(
  sections: readonly (StackSectionInput | null)[],
  options: SectionStackLayerOptions,
): SectionStackLayers {
  const layers: Layer[] = []
  const targets = new Map<string, PickTarget>()
  const radius = {
    radiusUnits: 'common',
    radiusScale: options.radiusScale,
    radiusMinPixels: CELL_RADIUS_MIN_PIXELS * options.radiusScale,
    radiusMaxPixels: CELL_RADIUS_MAX_PIXELS * options.radiusScale,
    getRadius: LINKED_SECTION_CELL_RADIUS_MICROMETERS,
    billboard: true,
    stroked: false,
    filled: true,
  } as const

  // Solid cells first, so the faint ones blend over them where in front.
  const context: Layer[] = []

  sections.forEach((section, index) => {
    if (section === null) return

    const { cells, overlay } = section
    const { modelMatrix } = section
    const id = (part: string) => `section-stack-${index.toString()}-${part}`

    if (overlay === null) {
      layers.push(
        new ScatterplotLayer({
          id: id('cells'),
          data: pointData(deckPositions(cells.positions), null),
          getFillColor: CELL_RGBA,
          modelMatrix,
          pickable: true,
          ...radius,
        }) as Layer,
      )
      targets.set(id('cells'), { section: index, kind: 'cell', order: null })
      return
    }

    if (overlay.kind === 'scores') {
      const scored = scoredCells(overlay.scores, {
        colorScale: options.colorScale,
        scaleMin: section.scaleMin,
        scaleMax: section.scaleMax,
      })

      if (options.showContext) {
        context.push(
          contextLayer(
            id('context'),
            deckPositions(cells.positions),
            modelMatrix,
            radius,
          ),
        )
      }

      if (scored.order.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: id('scored'),
            data: pointData(scored.positions, scored.colors),
            modelMatrix,
            pickable: true,
            ...radius,
          }) as Layer,
        )
        targets.set(id('scored'), { section: index, kind: 'score', order: scored.order })
      }

      return
    }

    const split = classSplit(cells, overlay)

    if (options.showContext && split.faded.positions.length > 0) {
      context.push(
        contextLayer(id('context'), split.faded.positions, modelMatrix, radius),
      )
    }

    if (split.shown.index.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: id('classes'),
          data: pointData(split.shown.positions, split.shown.colors),
          modelMatrix,
          pickable: true,
          ...radius,
        }) as Layer,
      )
      targets.set(id('classes'), {
        section: index,
        kind: 'cell',
        order: split.shown.index,
      })
    }
  })

  return { layers: [...layers, ...context], targets }
}

// The section and cell or score under the pointer, from a deck.gl pick.
export function stackPick(
  info: PickingInfo,
  targets: ReadonlyMap<string, PickTarget>,
): StackPick | null {
  const target =
    info.layer === null || info.layer === undefined
      ? undefined
      : targets.get(info.layer.id)
  if (target === undefined || info.index < 0) return null

  const index = target.order === null ? info.index : target.order[info.index]
  return index === undefined
    ? null
    : { section: target.section, kind: target.kind, index }
}

// The tooltip for a picked point: its section, then its cell and class, or
// its score for the genes.
export function stackPickText(
  pick: StackPick,
  sectionLabel: string,
  section: StackSectionInput,
  genes: readonly string[],
): string {
  if (pick.kind === 'score') {
    const score =
      section.overlay?.kind === 'scores'
        ? section.overlay.scores.scores[pick.index]
        : undefined

    return score === undefined
      ? sectionLabel
      : `${sectionLabel} · ${genes.length === 1 ? genes[0] : 'Score'} ${formatGeneScaleValue(score)}`
  }

  const cellId = section.cells.cellIds[pick.index] ?? ''
  const classIndex = section.classes?.classOf[pick.index] ?? -1
  const classLabel =
    section.overlay?.kind === 'classes'
      ? section.classes?.classes[classIndex]?.label
      : undefined

  return [sectionLabel, cellId, classLabel]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ')
}

function contextLayer(
  id: string,
  positions: Float32Array,
  modelMatrix: Float32Array,
  radius: object,
): Layer {
  return new ScatterplotLayer({
    id,
    data: pointData(positions, null),
    getFillColor: CONTEXT_RGBA,
    modelMatrix,
    parameters: CONTEXT_PARAMETERS,
    pickable: false,
    ...radius,
  }) as Layer
}

interface ClassSplit {
  // Cells in a shown class: positions, colours, and each one's cell index.
  readonly shown: {
    readonly positions: Float32Array
    readonly colors: Uint8Array
    readonly index: Uint32Array
  }
  // Cells in a hidden class, or in none.
  readonly faded: { readonly positions: Float32Array }
}

// Cached per class array and colours, so a camera move or a depth change
// hands deck.gl the same arrays and nothing is uploaded again.
const classSplitCache = new WeakMap<
  Int32Array,
  { readonly key: string; readonly positions: Float32Array; readonly split: ClassSplit }
>()

function classSplit(
  cells: PreviewCells,
  overlay: Extract<PreviewOverlay, { readonly kind: 'classes' }>,
): ClassSplit {
  const key = overlay.colors.join('|')
  const cached = classSplitCache.get(overlay.classOf)
  if (cached?.key === key && cached.positions === cells.positions) return cached.split

  const rgb = overlay.colors.map(hexRgb)
  const positions = deckPositions(cells.positions)
  const shown: number[] = []
  const faded: number[] = []

  overlay.classOf.forEach((classIndex, cell) => {
    ;(rgb[classIndex] == null ? faded : shown).push(cell)
  })

  const colors = new Uint8Array(shown.length * 4)

  shown.forEach((cell, index) => {
    colors.set([...(rgb[overlay.classOf[cell] ?? -1] ?? [0, 0, 0]), 255], index * 4)
  })

  const split: ClassSplit = {
    shown: {
      positions: gather(positions, shown),
      colors,
      index: Uint32Array.from(shown),
    },
    faded: { positions: gather(positions, faded) },
  }

  classSplitCache.set(overlay.classOf, { key, positions: cells.positions, split })
  return split
}

function gather(positions: Float32Array, cells: readonly number[]): Float32Array {
  const gathered = new Float32Array(cells.length * 2)

  cells.forEach((cell, index) => {
    gathered[index * 2] = positions[cell * 2] ?? 0
    gathered[index * 2 + 1] = positions[cell * 2 + 1] ?? 0
  })

  return gathered
}

// Binary point data, one object per positions array (and colours), so
// deck.gl sees unchanged data across renders.
type PointData = LayerData<unknown>

const pointDataCache = new WeakMap<Float32Array, Map<Uint8Array | null, PointData>>()

function pointData(positions: Float32Array, colors: Uint8Array | null): PointData {
  let byColors = pointDataCache.get(positions)

  if (byColors === undefined) {
    byColors = new Map()
    pointDataCache.set(positions, byColors)
  }

  const cached = byColors.get(colors)
  if (cached !== undefined) return cached

  const data: PointData = {
    length: positions.length / 2,
    attributes: {
      getPosition: { value: positions, size: 2 },
      ...(colors === null
        ? {}
        : { getFillColor: { value: colors, size: 4, type: 'unorm8' } }),
    },
  }

  byColors.set(colors, data)
  return data
}
