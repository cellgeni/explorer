import type { Layer, OrbitViewState, PickingInfo } from '@deck.gl/core'
import { DeckGL } from '@deck.gl/react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { removeDeckFromTabOrder } from '../../components/deckTabOrder'
import { ReleasingDeck } from '../../components/releasingDeck'
import { Button, FitIcon, IconButton, Slider, Switch } from '../../components/ui'
import { fittedVolumeViewState } from '../../components/volumeViewerModel'
import { geneExpressionScaleGradient } from '../../rendering/deckLayerColors'
import { formatGeneScaleValue } from '../genes/geneControlsModel'
import {
  formatPercentile,
  geneScaleBounds,
  geneScalePercentile,
  geneScoreSpread,
} from '../genes/geneScaleRange'
import { collectionEntryLabel } from './collectionModel'
import type { PreviewScores } from './collectionPreviewData'
import type { CollectionPreviewStore, PreviewEntry } from './collectionPreviewStore'
import type { LinkedSectionsColoring } from './LinkedSections'
import { sectionOverlay } from './linkedSectionLayers'
import {
  SECTION_STACK_VIEW,
  sectionStackLayers,
  stackPick,
  stackPickDepth,
  stackPickText,
  type StackSectionInput,
} from './sectionStackLayers'
import {
  cellViewStatus,
  MAX_STACK_DEPTH_SCALE_LOG2,
  MIN_STACK_DEPTH_SCALE_LOG2,
  openingStackDepthScaleLog2,
  sectionModelMatrix,
  stackDepths,
  stackFrame,
  stackStatus,
  type StackSection,
} from './sectionStackModel'

// Serial sections stacked in 3D, over the views: each section's cells from
// its collection preview, at its depth, coloured as the main view colours
// cells. Closing it returns to the views underneath, which stay mounted.
// With mode 'cells', the one section is the open dataset, whose cells have
// their own depths (a third spatial coordinate).

interface SectionStackViewerProps {
  // Shallowest first.
  readonly sections: readonly StackSection[]
  readonly mode?: 'sections' | 'cells'
  readonly store: CollectionPreviewStore | null
  readonly coloring: LinkedSectionsColoring
  readonly cellPointScale: number
  // Settings › Hover tooltips.
  readonly hoverTooltips: boolean
  readonly onClose: () => void
}

interface StackHover {
  readonly x: number
  readonly y: number
  readonly text: string
}

const MemoDeckGL = memo(DeckGL) as typeof DeckGL
const DEFAULT_SIZE = { width: 800, height: 600 }
const NO_GENES: readonly string[] = []
const PICKING_RADIUS_PIXELS = 6

export function SectionStackViewer({
  sections,
  mode = 'sections',
  store,
  coloring,
  cellPointScale,
  hoverTooltips,
  onClose,
}: SectionStackViewerProps) {
  const containerRef = useRef<HTMLElement>(null)
  // The canvas host, hidden from assistive technology, whose deck.gl root
  // leaves the tab order once loaded.
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const handleDeckLoad = useCallback(() => {
    removeDeckFromTabOrder(canvasHostRef.current)
  }, [])
  const [size, setSize] = useState<{
    readonly width: number
    readonly height: number
  } | null>(null)
  // Null until the Depth control is moved: the stretch the stack opens with.
  const [depthScaleLog2, setDepthScaleLog2] = useState<number | null>(null)
  const [showContext, setShowContext] = useState(true)
  const [viewState, setViewState] = useState<OrbitViewState | null>(null)
  const [hover, setHover] = useState<StackHover | null>(null)
  const readPreviews = useMemo(() => previewsReader(sections, store), [sections, store])
  const previews = useSyncExternalStore(store?.subscribe ?? noSubscription, readPreviews)
  const { annotations, colorScale, scaleRange } = coloring
  const genes = annotations === null ? coloring.genes : NO_GENES
  const colored = annotations !== null || genes.length > 0
  const percentile = geneScalePercentile(scaleRange)
  const sharedScale = typeof scaleRange.max === 'number'
  const cellsMode = mode === 'cells'
  const frame = useMemo(
    () =>
      stackFrame(
        stackDepths(sections, previews),
        previews.map((preview) => preview?.cells?.bounds ?? null),
      ),
    [previews, sections],
  )
  const shownDepthScaleLog2 = depthScaleLog2 ?? openingStackDepthScaleLog2(frame)
  const depthScale = 2 ** shownDepthScaleLog2
  // Each section's colouring and gene scale. On Auto or a percentile top, a
  // section tops out at that percentile of its own scores, as its panel and
  // preview do; a typed top is shared.
  const colorings = useMemo(
    () =>
      previews.map((preview) => {
        const overlay = sectionOverlay(preview, { genes, annotations })
        const top = overlay?.kind === 'scores' ? ownTop(overlay.scores, percentile) : 0
        const { min, max } = geneScaleBounds(scaleRange, top)

        return { overlay, scaleMin: min, scaleMax: max }
      }),
    [annotations, genes, percentile, previews, scaleRange],
  )
  const inputs = useMemo(
    (): readonly (StackSectionInput | null)[] =>
      sections.map((section, index) => {
        const preview = previews[index] ?? null
        const sectionColoring = colorings[index]
        if (preview?.cells == null || frame === null || sectionColoring === undefined) {
          return null
        }

        return {
          cells: preview.cells,
          classes: preview.classes,
          ...sectionColoring,
          modelMatrix: sectionModelMatrix(frame, section.z, depthScale),
        }
      }),
    [colorings, depthScale, frame, previews, sections],
  )
  const stack = useMemo(
    () =>
      sectionStackLayers(inputs, {
        colorScale,
        radiusScale: cellPointScale,
        showContext,
      }),
    [cellPointScale, colorScale, inputs, showContext],
  )
  const extent = useMemo(
    (): [number, number, number] =>
      frame === null
        ? [1, 1, 1]
        : [
            Math.max(frame.width, 1),
            Math.max(frame.height, 1),
            Math.max(frame.depth * depthScale, 1),
          ],
    [depthScale, frame],
  )
  const shownViewState = viewState ?? fittedVolumeViewState(extent, size ?? DEFAULT_SIZE)
  const handleHover = useCallback(
    (info: PickingInfo) => {
      if (!hoverTooltips) return

      const pick = stackPick(info, stack.targets)
      const section = pick === null ? undefined : sections[pick.section]
      const input = pick === null ? null : (inputs[pick.section] ?? null)
      const depth = pick === null || input === null ? null : stackPickDepth(pick, input)
      // The section, then the cell's own depth when it has one.
      const label =
        section === undefined
          ? ''
          : [
              ...(cellsMode ? [] : [collectionEntryLabel(section.entry)]),
              ...(depth === null ? [] : [`z ${formatDepth(section.z + depth)} µm`]),
            ].join(' · ')

      setHover(
        pick === null || section === undefined || input === null
          ? null
          : {
              x: info.x,
              y: info.y,
              text: stackPickText(pick, label, input, genes),
            },
      )
    },
    [cellsMode, genes, hoverTooltips, inputs, sections, stack.targets],
  )
  const handleViewStateChange = useCallback(
    ({ viewState: next }: { readonly viewState: unknown }) => {
      setViewState(next as OrbitViewState)
    },
    [],
  )

  useEffect(() => {
    const element = containerRef.current

    if (element === null || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })

    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  const status = cellsMode
    ? cellViewStatus(previews[0] ?? null, colored)
    : stackStatus(sections, previews, colored)
  const first = sections[0]?.z ?? 0
  const last = sections.at(-1)?.z ?? 0
  const cells = previews[0]?.cells ?? null

  return (
    <section
      className="volume-viewer section-stack"
      aria-label={cellsMode ? '3D cells' : '3D section stack'}
      ref={containerRef}
      onPointerLeave={() => {
        setHover(null)
      }}
    >
      <div className="volume-viewer-canvas" aria-hidden="true" ref={canvasHostRef}>
        <MemoDeckGL
          Deck={ReleasingDeck}
          views={SECTION_STACK_VIEW}
          viewState={shownViewState}
          onViewStateChange={handleViewStateChange}
          onHover={handleHover}
          pickingRadius={PICKING_RADIUS_PIXELS}
          controller
          layers={stack.layers as Layer[]}
          onLoad={handleDeckLoad}
        />
      </div>
      <div
        className="volume-viewer-toolbar"
        role="group"
        aria-label={cellsMode ? '3D cell settings' : '3D stack settings'}
      >
        {cellsMode ? (
          cells?.depths === undefined ? null : (
            <p className="section-stack-summary">
              {cells.cellIds.length.toLocaleString()} cells, z{' '}
              {formatDepth(cells.depths.min)} to {formatDepth(cells.depths.max)} µm
            </p>
          )
        ) : (
          <p className="section-stack-summary">
            {sections.length.toLocaleString()} sections, z {formatDepth(first)} to{' '}
            {formatDepth(last)} µm
          </p>
        )}
        <Slider
          title={
            cellsMode
              ? 'Stretch or flatten the cells along z; ×1 is their true depth'
              : "Stretch or flatten the stack along z; ×1 is the sections' true spacing"
          }
          label="Depth"
          min={MIN_STACK_DEPTH_SCALE_LOG2}
          max={MAX_STACK_DEPTH_SCALE_LOG2}
          step={0.25}
          value={shownDepthScaleLog2}
          formatValue={(value) => formatDepthScale(2 ** value)}
          onChange={setDepthScaleLog2}
        />
        {colored ? (
          <Switch
            title={
              annotations === null
                ? 'Show the cells that do not score for the genes faintly, as an outline of the tissue'
                : 'Show the cells outside the shown classes faintly, as an outline of the tissue'
            }
            label="Other cells"
            checked={showContext}
            onChange={setShowContext}
          />
        ) : null}
        {genes.length > 0 ? (
          <div
            className="section-stack-scale"
            title={
              cellsMode
                ? sharedScale
                  ? 'The range set in Gene scale'
                  : `Runs up to the ${formatPercentile(percentile)} percentile of the scores above 0; cells above it get the top colour`
                : sharedScale
                  ? 'Every section uses this scale, the range set in Gene scale'
                  : `Each section runs up to its own ${formatPercentile(percentile)} percentile of the scores above 0; cells above it get the top colour. Type a top score in Gene scale to put every section on one scale`
            }
          >
            <span className="section-stack-scale-genes">
              {genes.length === 1 ? genes[0] : `${genes.length.toLocaleString()} genes`}
            </span>
            <span>{formatGeneScaleValue(geneScaleBounds(scaleRange, 0).min)}</span>
            <span
              className="section-stack-scale-ramp"
              style={{ background: geneExpressionScaleGradient(colorScale) }}
              aria-hidden="true"
            />
            <span>
              {sharedScale
                ? formatGeneScaleValue(geneScaleBounds(scaleRange, 0).max)
                : `p${percentile}`}
            </span>
          </div>
        ) : null}
        <div className="volume-viewer-actions">
          <IconButton
            title="Reset the 3D view"
            icon={<FitIcon />}
            onClick={() => {
              setViewState(null)
            }}
          />
          <Button title="Return to the 2D view" onClick={onClose}>
            2D View
          </Button>
        </div>
      </div>
      <div className="volume-viewer-status">
        {status.reading === null ? null : (
          <p className="viewport-message" aria-live="polite">
            {status.reading}
          </p>
        )}
        {status.missing === null ? null : (
          <p className="viewport-message" aria-live="polite">
            {status.missing}
          </p>
        )}
      </div>
      {hover === null || !hoverTooltips ? null : (
        <div
          className="linked-section-tooltip"
          style={{ left: hover.x, top: hover.y }}
          aria-hidden="true"
        >
          {hover.text}
        </div>
      )}
      <p className="volume-viewer-hint">
        Drag to rotate · Shift-drag to pan · Scroll to zoom
      </p>
    </section>
  )
}

// The sections' previews, as one array that changes only when one of them
// does, not on every read of the collection's other datasets.
function previewsReader(
  sections: readonly StackSection[],
  store: CollectionPreviewStore | null,
): () => readonly (PreviewEntry | null)[] {
  let last: readonly (PreviewEntry | null)[] = []

  return () => {
    const next = sections.map((section) => store?.entry(section.entry.url) ?? null)
    if (next.length === last.length && next.every((entry, i) => entry === last[i])) {
      return last
    }

    last = next
    return next
  }
}

// A section's top at a percentile of its scores above 0, kept per scores
// read, as the stack is redrawn while it turns.
const ownTopCache = new WeakMap<PreviewScores, Map<number, number>>()

function ownTop(scores: PreviewScores, percentile: number): number {
  let byPercentile = ownTopCache.get(scores)

  if (byPercentile === undefined) {
    byPercentile = new Map()
    ownTopCache.set(scores, byPercentile)
  }

  const cached = byPercentile.get(percentile)
  if (cached !== undefined) return cached

  const top = geneScoreSpread(scores.scores, percentile).top
  byPercentile.set(percentile, top)
  return top
}

function formatDepth(z: number): string {
  return Number(z.toFixed(1)).toLocaleString()
}

function formatDepthScale(scale: number): string {
  return `×${Number(scale.toFixed(2)).toString()}`
}

function noSubscription(): () => void {
  return () => {}
}
