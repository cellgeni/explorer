import { OrbitView, type Layer, type LayerData, type PickingInfo } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'
import { metadataColor } from '../../rendering/cellStyling'
import { DEFAULT_OVERVIEW_CELL_FILL_RGB } from '../../rendering/deckLayerColors'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import { formatGeneScaleValue } from '../genes/geneControlsModel'
import {
  PREVIEW_CELL_RADIUS_MICROMETERS,
  type PreviewCells,
  type PreviewClasses,
} from './collectionPreviewData'
import type { StackPythonLayers } from './stackPythonLayers'
import { hexRgb, type PreviewOverlay } from './collectionPreviewRaster'
import {
  deckPositions,
  radiusProp,
  scoredCells,
  valueLabel,
  type LinkedScoredCells,
} from './linkedSectionLayers'

// The layers of serial sections stacked in 3D. Each section is its cells from
// its collection preview, drawn at (x, -y) and lifted to its depth by a model
// matrix, so changing the depth stretch uploads nothing. Cells with their own
// depths (a dataset placing cells in 3D) are drawn at (x, -y, z), and the
// model matrix stretches z the same way. Cells are balls the size of their
// area (10 µm across without one) that face the camera. The cells a section is coloured for (those
// scoring for the genes, in a shown class, or with a value of the metadata
// track; every cell without colouring) are drawn solid and hide what is
// behind them; the others are a faint outline of the tissue that hides
// nothing.

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
  // The Python console's layers, for the open dataset's cells (plan 29):
  // they take over its colouring while they colour or hide cells.
  readonly python?: StackPythonLayers | null
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
    billboard: true,
    stroked: false,
    filled: true,
  } as const

  // Solid cells first, so the faint ones blend over them where in front.
  const context: Layer[] = []
  const rings: Layer[] = []

  sections.forEach((section, index) => {
    if (section === null) return

    const { cells, overlay } = section
    const { modelMatrix } = section
    const id = (part: string) => `section-stack-${index.toString()}-${part}`
    // A radius per cell travels with the points (DeckPoints.radii).
    const cellRadius = {
      ...radius,
      ...radiusProp(cells.radius ?? PREVIEW_CELL_RADIUS_MICROMETERS),
    }

    const points = cellPoints(cells)
    const python = section.python ?? null

    // Highlights ring their cells above everything else in the section.
    for (const highlight of python?.highlights ?? []) {
      if (highlight.cells.length === 0) continue
      rings.push(
        new ScatterplotLayer({
          id: id(`python-ring-${highlight.name}`),
          data: pointData(ringPoints(points, highlight.cells), null),
          modelMatrix,
          pickable: false,
          ...cellRadius,
          radiusScale: options.radiusScale * RING_RADIUS_SCALE,
          radiusMinPixels: RING_RADIUS_MIN_PIXELS * options.radiusScale,
          filled: false,
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: RING_WIDTH_PIXELS,
          lineWidthMinPixels: RING_WIDTH_PIXELS,
          getLineColor: ringColor(highlight.color),
        }) as Layer,
      )
    }

    if (python !== null && (python.colors !== null || python.hidden !== null)) {
      const split = pythonSplit(cells, python)

      if (options.showContext && split.faded.positions.length > 0) {
        context.push(contextLayer(id('context'), split.faded, modelMatrix, cellRadius))
      }

      if (split.shown.index.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: id('python'),
            data: pointData(split.shown, split.shown.colors),
            modelMatrix,
            pickable: true,
            ...cellRadius,
          }) as Layer,
        )
        targets.set(id('python'), {
          section: index,
          kind: 'cell',
          order: split.shown.index,
        })
      }

      return
    }

    if (overlay === null) {
      layers.push(
        new ScatterplotLayer({
          id: id('cells'),
          data: pointData(points, null),
          getFillColor: CELL_RGBA,
          modelMatrix,
          pickable: true,
          ...cellRadius,
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
        context.push(contextLayer(id('context'), points, modelMatrix, cellRadius))
      }

      if (scored.order.length > 0) {
        layers.push(
          new ScatterplotLayer({
            id: id('scored'),
            data: pointData(scoredPoints(scored, overlay.scores.depths), scored.colors),
            modelMatrix,
            pickable: true,
            ...radius,
            ...radiusProp(scored.radius),
          }) as Layer,
        )
        targets.set(id('scored'), { section: index, kind: 'score', order: scored.order })
      }

      return
    }

    const split =
      overlay.kind === 'classes' ? classSplit(cells, overlay) : valueSplit(cells, overlay)

    if (options.showContext && split.faded.positions.length > 0) {
      context.push(contextLayer(id('context'), split.faded, modelMatrix, cellRadius))
    }

    if (split.shown.index.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: id(overlay.kind),
          data: pointData(split.shown, split.shown.colors),
          modelMatrix,
          pickable: true,
          ...cellRadius,
        }) as Layer,
      )
      targets.set(id(overlay.kind), {
        section: index,
        kind: 'cell',
        order: split.shown.index,
      })
    }
  })

  return { layers: [...layers, ...rings, ...context], targets }
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
  // The class it is drawn in, else its first, hidden, class.
  const shownClass =
    section.overlay?.kind === 'classes' ? (section.overlay.classOf[pick.index] ?? -1) : -1
  const classIndex =
    shownClass >= 0 ? shownClass : (section.classes?.classOf[pick.index] ?? -1)
  const classLabel =
    section.overlay?.kind === 'classes'
      ? section.classes?.classes[classIndex]?.label
      : undefined

  return [sectionLabel, cellId, classLabel, valueLabel(section.overlay, pick.index)]
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
// their own depths, and each point's radius when they differ.
interface DeckPoints {
  readonly positions: Float32Array
  readonly size: 2 | 3
  readonly radii?: Float32Array
}

function pointRadii(radius: PreviewCells['radius']): Pick<DeckPoints, 'radii'> {
  return radius instanceof Float32Array ? { radii: radius } : {}
}

// Cached per cells read, so a camera move hands deck.gl the same arrays.
const cellPointsCache = new WeakMap<PreviewCells, DeckPoints>()

function cellPoints(cells: PreviewCells): DeckPoints {
  const cached = cellPointsCache.get(cells)
  if (cached !== undefined) return cached

  const flat = deckPositions(cells.positions)
  const points =
    cells.depths === undefined
      ? { positions: flat, size: 2 as const, ...pointRadii(cells.radius) }
      : withDepths(flat, (index) => cells.depths?.values[index], cells.radius)
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
  if (depths === undefined) {
    return { positions: scored.positions, size: 2, ...pointRadii(scored.radius) }
  }

  const cached = scoredPointsCache.get(scored.positions)
  if (cached !== undefined) return cached

  const points = withDepths(
    scored.positions,
    (index) => {
      const scoreIndex = scored.order[index]
      return scoreIndex === undefined ? undefined : depths[scoreIndex]
    },
    scored.radius,
  )
  scoredPointsCache.set(scored.positions, points)
  return points
}

// (x, -y) points with a z each; a point without one is at z 0.
function withDepths(
  flat: Float32Array,
  depthOf: (index: number) => number | undefined,
  radius: PreviewCells['radius'],
): DeckPoints {
  const count = flat.length / 2
  const positions = new Float32Array(count * 3)

  for (let index = 0; index < count; index += 1) {
    const z = depthOf(index)
    positions[index * 3] = flat[index * 2] ?? 0
    positions[index * 3 + 1] = flat[index * 2 + 1] ?? 0
    positions[index * 3 + 2] = z !== undefined && Number.isFinite(z) ? z : 0
  }

  return { positions, size: 3, ...pointRadii(radius) }
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

// The cells with a value in the metadata colour of it, and those without one.
// Cached per values read and range, as classSplit is.
const valueSplitCache = new WeakMap<
  Extract<PreviewOverlay, { readonly kind: 'values' }>['values'],
  { readonly key: string; readonly cells: PreviewCells; readonly split: ClassSplit }
>()

function valueSplit(
  cells: PreviewCells,
  overlay: Extract<PreviewOverlay, { readonly kind: 'values' }>,
): ClassSplit {
  const { values, track } = overlay
  const key = `${track.min}|${track.max}`
  const cached = valueSplitCache.get(values)
  if (cached?.key === key && cached.cells === cells) return cached.split

  const points = cellPoints(cells)
  const shown: number[] = []
  const faded: number[] = []

  values.values.forEach((value, cell) => {
    ;(Number.isFinite(value) ? shown : faded).push(cell)
  })

  const colors = new Uint8Array(shown.length * 4)

  shown.forEach((cell, index) => {
    const color = metadataColor(values.values[cell] ?? 0, track.min, track.max)
    colors.set([color[0], color[1], color[2], 255], index * 4)
  })

  const split: ClassSplit = {
    shown: { ...gather(points, shown), colors, index: Uint32Array.from(shown) },
    faded: gather(points, faded),
  }

  valueSplitCache.set(values, { key, cells, split })
  return split
}

// A ring a little wider than its cell, at least a few pixels across.
const RING_RADIUS_SCALE = 1.6
const RING_RADIUS_MIN_PIXELS = 4
const RING_WIDTH_PIXELS = 2
const RING_ALPHA = 235

// One colour array per colour, so deck.gl sees the same prop each render.
const ringColors = new Map<string, [number, number, number, number]>()

function ringColor(
  color: readonly [number, number, number],
): [number, number, number, number] {
  const key = color.join(',')
  let rgba = ringColors.get(key)
  if (rgba === undefined) {
    rgba = [color[0], color[1], color[2], RING_ALPHA]
    ringColors.set(key, rgba)
  }
  return rgba
}

const ringPointsCache = new WeakMap<Uint32Array, DeckPoints>()

function ringPoints(points: DeckPoints, cells: Uint32Array): DeckPoints {
  const cached = ringPointsCache.get(cells)
  if (cached !== undefined) return cached
  const gathered = gather(points, [...cells])
  ringPointsCache.set(cells, gathered)
  return gathered
}

// Python's coloured cells in their colours (every shown cell in the cells'
// colour, with show() alone), the uncoloured ones faint, hidden ones left
// out. Cached per layers and cells, as classSplit is.
const pythonSplitCache = new WeakMap<
  StackPythonLayers,
  { readonly cells: PreviewCells; readonly split: ClassSplit }
>()

function pythonSplit(cells: PreviewCells, python: StackPythonLayers): ClassSplit {
  const cached = pythonSplitCache.get(python)
  if (cached?.cells === cells) return cached.split

  const points = cellPoints(cells)
  const { colors, hidden } = python
  const shown: number[] = []
  const faded: number[] = []

  for (let cell = 0; cell < cells.cellIds.length; cell += 1) {
    if (hidden?.[cell] === 1) continue
    if (colors === null || colors[cell * 4 + 3] !== 0) shown.push(cell)
    else faded.push(cell)
  }

  const shownColors = new Uint8Array(shown.length * 4)
  shown.forEach((cell, index) => {
    shownColors.set(
      colors === null ? CELL_RGBA : [...colors.subarray(cell * 4, cell * 4 + 3), 255],
      index * 4,
    )
  })

  const split: ClassSplit = {
    shown: {
      ...gather(points, shown),
      colors: shownColors,
      index: Uint32Array.from(shown),
    },
    faded: gather(points, faded),
  }
  pythonSplitCache.set(python, { cells, split })
  return split
}

function gather(points: DeckPoints, cells: readonly number[]): DeckPoints {
  const { positions, size, radii } = points
  const gathered = new Float32Array(cells.length * size)
  const gatheredRadii = radii === undefined ? null : new Float32Array(cells.length)

  cells.forEach((cell, index) => {
    for (let axis = 0; axis < size; axis += 1) {
      gathered[index * size + axis] = positions[cell * size + axis] ?? 0
    }
    if (gatheredRadii !== null) {
      gatheredRadii[index] = radii?.[cell] ?? PREVIEW_CELL_RADIUS_MICROMETERS
    }
  })

  return {
    positions: gathered,
    size,
    ...(gatheredRadii === null ? {} : { radii: gatheredRadii }),
  }
}

// Binary point data, one object per positions array (and colours), so
// deck.gl sees unchanged data across renders. A positions array always comes
// with the same radii.
type PointData = LayerData<unknown>

const pointDataCache = new WeakMap<Float32Array, Map<Uint8Array | null, PointData>>()

function pointData(points: DeckPoints, colors: Uint8Array | null): PointData {
  const { positions, size, radii } = points
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
      ...(radii === undefined ? {} : { getRadius: { value: radii, size: 1 } }),
      ...(colors === null
        ? {}
        : { getFillColor: { value: colors, size: 4, type: 'unorm8' } }),
    },
  }

  byColors.set(colors, data)
  return data
}
