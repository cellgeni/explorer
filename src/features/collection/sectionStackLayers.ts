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
  type LinkedScoredCells,
} from './linkedSectionLayers'

// The layers of serial sections stacked in 3D. Each section is its cells from
// its collection preview, drawn at (x, -y) and lifted to its depth by a model
// matrix, so changing the depth stretch uploads nothing. Cells with their own
// depths (a dataset placing cells in 3D) are drawn at (x, -y, z), and the
// model matrix stretches z the same way. Cells are balls 10
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

    const points = cellPoints(cells)

    if (overlay === null) {
      layers.push(
        new ScatterplotLayer({
          id: id('cells'),
          data: pointData(points, null),
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
        context.push(contextLayer(id('context'), points, modelMatrix, radius))
      }

      if (scored.order.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: id('scored'),
            data: pointData(scoredPoints(scored, overlay.scores.depths), scored.colors),
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
      context.push(contextLayer(id('context'), split.faded, modelMatrix, radius))
    }

    if (split.shown.index.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: id('classes'),
          data: pointData(split.shown, split.shown.colors),
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

// A picked point's own depth, for cells placed in 3D; null for cells in the
// plane of their section.
export function stackPickDepth(
  pick: StackPick,
  section: StackSectionInput,
): number | null {
  const depth =
    pick.kind === 'cell'
      ? section.cells.depths?.values[pick.index]
      : section.overlay?.kind === 'scores'
        ? section.overlay.scores.depths?.[pick.index]
        : undefined

  return depth === undefined || !Number.isFinite(depth) ? null : depth
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
  points: DeckPoints,
  modelMatrix: Float32Array,
  radius: object,
): Layer {
  return new ScatterplotLayer({
    id,
    data: pointData(points, null),
    getFillColor: CONTEXT_RGBA,
    modelMatrix,
    parameters: CONTEXT_PARAMETERS,
    pickable: false,
    ...radius,
  }) as Layer
}

// Positions as deck.gl takes them: (x, -y), or (x, -y, z) for cells with
// their own depths.
interface DeckPoints {
  readonly positions: Float32Array
  readonly size: 2 | 3
}

// Cached per cells read, so a camera move hands deck.gl the same arrays.
const cellPointsCache = new WeakMap<PreviewCells, DeckPoints>()

function cellPoints(cells: PreviewCells): DeckPoints {
  const cached = cellPointsCache.get(cells)
  if (cached !== undefined) return cached

  const flat = deckPositions(cells.positions)
  const points =
    cells.depths === undefined
      ? { positions: flat, size: 2 as const }
      : withDepths(flat, (index) => cells.depths?.values[index])
  cellPointsCache.set(cells, points)
  return points
}

// The scored cells' positions, with each one's depth when the scores have
// them. Cached per positions, which scoredCells keeps per colouring.
const scoredPointsCache = new WeakMap<Float32Array, DeckPoints>()

function scoredPoints(
  scored: LinkedScoredCells,
  depths: Float32Array | undefined,
): DeckPoints {
  if (depths === undefined) return { positions: scored.positions, size: 2 }

  const cached = scoredPointsCache.get(scored.positions)
  if (cached !== undefined) return cached

  const points = withDepths(scored.positions, (index) => {
    const scoreIndex = scored.order[index]
    return scoreIndex === undefined ? undefined : depths[scoreIndex]
  })
  scoredPointsCache.set(scored.positions, points)
  return points
}

// (x, -y) points with a z each; a point without one is at z 0.
function withDepths(
  flat: Float32Array,
  depthOf: (index: number) => number | undefined,
): DeckPoints {
  const count = flat.length / 2
  const positions = new Float32Array(count * 3)

  for (let index = 0; index < count; index += 1) {
    const z = depthOf(index)
    positions[index * 3] = flat[index * 2] ?? 0
    positions[index * 3 + 1] = flat[index * 2 + 1] ?? 0
    positions[index * 3 + 2] = z !== undefined && Number.isFinite(z) ? z : 0
  }

  return { positions, size: 3 }
}

interface ClassSplit {
  // Cells in a shown class: positions, colours, and each one's cell index.
  readonly shown: DeckPoints & {
    readonly colors: Uint8Array
    readonly index: Uint32Array
  }
  // Cells in a hidden class, or in none.
  readonly faded: DeckPoints
}

// Cached per class array and colours, so a camera move or a depth change
// hands deck.gl the same arrays and nothing is uploaded again.
const classSplitCache = new WeakMap<
  Int32Array,
  { readonly key: string; readonly cells: PreviewCells; readonly split: ClassSplit }
>()

function classSplit(
  cells: PreviewCells,
  overlay: Extract<PreviewOverlay, { readonly kind: 'classes' }>,
): ClassSplit {
  const key = overlay.colors.join('|')
  const cached = classSplitCache.get(overlay.classOf)
  if (cached?.key === key && cached.cells === cells) return cached.split

  const rgb = overlay.colors.map(hexRgb)
  const points = cellPoints(cells)
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
      ...gather(points, shown),
      colors,
      index: Uint32Array.from(shown),
    },
    faded: gather(points, faded),
  }

  classSplitCache.set(overlay.classOf, { key, cells, split })
  return split
}

function gather(points: DeckPoints, cells: readonly number[]): DeckPoints {
  const { positions, size } = points
  const gathered = new Float32Array(cells.length * size)

  cells.forEach((cell, index) => {
    for (let axis = 0; axis < size; axis += 1) {
      gathered[index * size + axis] = positions[cell * size + axis] ?? 0
    }
  })

  return { positions: gathered, size }
}

// Binary point data, one object per positions array (and colours), so
// deck.gl sees unchanged data across renders.
type PointData = LayerData<unknown>

const pointDataCache = new WeakMap<Float32Array, Map<Uint8Array | null, PointData>>()

function pointData(points: DeckPoints, colors: Uint8Array | null): PointData {
  const { positions, size } = points
  let byColors = pointDataCache.get(positions)

  if (byColors === undefined) {
    byColors = new Map()
    pointDataCache.set(positions, byColors)
  }

  const cached = byColors.get(colors)
  if (cached !== undefined) return cached

  const data: PointData = {
    length: positions.length / size,
    attributes: {
      getPosition: { value: positions, size },
      ...(colors === null
        ? {}
        : { getFillColor: { value: colors, size: 4, type: 'unorm8' } }),
    },
  }

  byColors.set(colors, data)
  return data
}
