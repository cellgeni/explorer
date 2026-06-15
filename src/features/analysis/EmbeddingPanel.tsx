import type { PointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  AnalysisEmbedding,
  AnalysisEmbeddingElementLabel,
  AnalysisEmbeddingPoint,
} from '../../data/analysisEmbeddings'
import type { AnnotationColorStyle } from '../../rendering/cellStyling'

const EMBEDDING_RENDER_POINT_LIMIT = 120_000
const EMBEDDING_PLOT_FALLBACK_WIDTH = 320
const EMBEDDING_PLOT_FALLBACK_HEIGHT = 190
const EMBEDDING_PLOT_PADDING = 12
const EMPTY_ANNOTATION_STYLES: readonly AnnotationColorStyle[] = []
const UNANNOTATED_EMBEDDING_COLOR = 'rgba(72, 68, 58, 0.34)'

interface EmbeddingBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

interface EmbeddingPanelProps {
  readonly embedding: AnalysisEmbedding | null
  readonly annotationStyles?: readonly AnnotationColorStyle[]
  readonly roiElementIds: readonly string[]
  readonly selectedElementId: string | null
  readonly elementLabel?: AnalysisEmbeddingElementLabel
  readonly onSelectElement: (elementId: string) => void
}

export function EmbeddingPanel({
  embedding,
  annotationStyles = EMPTY_ANNOTATION_STYLES,
  roiElementIds,
  selectedElementId,
  elementLabel = 'cells',
  onSelectElement,
}: EmbeddingPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sampledPoints = useMemo(
    () =>
      embedding === null
        ? []
        : sampleEmbeddingPoints(embedding.points, EMBEDDING_RENDER_POINT_LIMIT),
    [embedding],
  )
  const bounds = useMemo(
    () => (embedding === null ? null : embeddingBounds(embedding.points)),
    [embedding],
  )
  const pointByCellId = useMemo(
    () =>
      embedding === null
        ? new Map<string, AnalysisEmbeddingPoint>()
        : mapEmbeddingPoints(embedding.points),
    [embedding],
  )
  const roiPoints = useMemo(
    () =>
      roiElementIds.flatMap((elementId) => {
        const point = pointByCellId.get(elementId)

        return point === undefined ? [] : [point]
      }),
    [pointByCellId, roiElementIds],
  )
  const annotationPointGroups = useMemo(
    () =>
      annotationStyles.length === 0
        ? []
        : groupEmbeddingPointsByAnnotationColor(sampledPoints, annotationStyles),
    [annotationStyles, sampledPoints],
  )
  const selectedPoint =
    selectedElementId === null ? undefined : pointByCellId.get(selectedElementId)

  useEffect(() => {
    if (embedding === null || bounds === null) {
      return
    }

    const canvas = canvasRef.current

    if (canvas === null) {
      return
    }

    const context = canvas.getContext('2d')

    if (context === null) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const width = Math.max(
      1,
      Math.round(rect.width || canvas.clientWidth || EMBEDDING_PLOT_FALLBACK_WIDTH),
    )
    const height = Math.max(
      1,
      Math.round(rect.height || canvas.clientHeight || EMBEDDING_PLOT_FALLBACK_HEIGHT),
    )
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1)

    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    drawEmbeddingPlot(context, width, height, bounds, {
      basePoints: sampledPoints,
      annotationPointGroups,
      hasAnnotationStyles: annotationStyles.length > 0,
      roiPoints,
      selectedPoint,
    })
  }, [
    annotationPointGroups,
    annotationStyles.length,
    bounds,
    embedding,
    roiPoints,
    sampledPoints,
    selectedPoint,
  ])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (embedding === null || bounds === null) {
        return
      }

      const canvas = canvasRef.current

      if (canvas === null) {
        return
      }

      const rect = canvas.getBoundingClientRect()
      const width = rect.width || canvas.clientWidth || EMBEDDING_PLOT_FALLBACK_WIDTH
      const height = rect.height || canvas.clientHeight || EMBEDDING_PLOT_FALLBACK_HEIGHT
      const point = nearestEmbeddingPoint(
        embedding.points,
        bounds,
        event.clientX - rect.left,
        event.clientY - rect.top,
        width,
        height,
      )

      if (point !== null) {
        onSelectElement(point.id)
      }
    },
    [bounds, embedding, onSelectElement],
  )

  if (embedding === null) {
    return <p className="embedding-empty">No embedding loaded</p>
  }

  return (
    <div className="embedding-panel">
      <div className="embedding-plot-shell">
        <canvas
          ref={canvasRef}
          className="embedding-plot"
          role="img"
          aria-label={`${embedding.label} embedding, ${embedding.points.length.toLocaleString()} ${elementLabel}`}
          title={`${embedding.label} embedding, ${embedding.points.length.toLocaleString()} ${elementLabel}`}
          onPointerDown={handlePointerDown}
        />
      </div>
      <dl className="embedding-summary" aria-label="Embedding link summary">
        <div>
          <dt>{elementLabel === 'bins' ? 'Bins' : 'Cells'}</dt>
          <dd>{embedding.points.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Shown</dt>
          <dd>{sampledPoints.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>ROI</dt>
          <dd>{roiPoints.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Selected</dt>
          <dd>{selectedPoint === undefined ? '0' : '1'}</dd>
        </div>
      </dl>
    </div>
  )
}

function sampleEmbeddingPoints(
  points: readonly AnalysisEmbeddingPoint[],
  limit: number,
): readonly AnalysisEmbeddingPoint[] {
  if (points.length <= limit) {
    return points
  }

  const sampledPoints: AnalysisEmbeddingPoint[] = []
  const step = points.length / limit

  for (let index = 0; index < limit; index += 1) {
    const point = points[Math.floor((index + 0.5) * step)]

    if (point !== undefined) {
      sampledPoints.push(point)
    }
  }

  return sampledPoints
}

function mapEmbeddingPoints(
  points: readonly AnalysisEmbeddingPoint[],
): ReadonlyMap<string, AnalysisEmbeddingPoint> {
  const pointByCellId = new Map<string, AnalysisEmbeddingPoint>()

  for (const point of points) {
    pointByCellId.set(point.id, point)
  }

  return pointByCellId
}

interface EmbeddingPointColorGroup {
  readonly color: string
  readonly points: readonly AnalysisEmbeddingPoint[]
}

function groupEmbeddingPointsByAnnotationColor(
  points: readonly AnalysisEmbeddingPoint[],
  annotations: readonly AnnotationColorStyle[],
): readonly EmbeddingPointColorGroup[] {
  if (points.length === 0 || annotations.length === 0) {
    return []
  }

  const unstyledPointIds = new Set(points.map((point) => point.id))
  const colorByCellId = new Map<string, string>()

  for (const annotation of annotations) {
    const color = hexToCanvasRgba(annotation.color, 0.82)

    for (const cellId of annotation.cellIds) {
      if (unstyledPointIds.has(cellId)) {
        colorByCellId.set(cellId, color)
        unstyledPointIds.delete(cellId)
      }

      if (unstyledPointIds.size === 0) {
        break
      }
    }

    if (unstyledPointIds.size === 0) {
      break
    }
  }

  const pointsByColor = new Map<string, AnalysisEmbeddingPoint[]>()

  for (const point of points) {
    const color = colorByCellId.get(point.id) ?? UNANNOTATED_EMBEDDING_COLOR
    const colorPoints = pointsByColor.get(color)

    if (colorPoints === undefined) {
      pointsByColor.set(color, [point])
    } else {
      colorPoints.push(point)
    }
  }

  return Array.from(pointsByColor, ([color, colorPoints]) => ({
    color,
    points: colorPoints,
  }))
}

function embeddingBounds(points: readonly AnalysisEmbeddingPoint[]): EmbeddingBounds {
  if (points.length === 0) {
    return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  if (minX === maxX) {
    minX -= 0.5
    maxX += 0.5
  }

  if (minY === maxY) {
    minY -= 0.5
    maxY += 0.5
  }

  return { minX, maxX, minY, maxY }
}

function drawEmbeddingPlot(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bounds: EmbeddingBounds,
  layers: {
    readonly basePoints: readonly AnalysisEmbeddingPoint[]
    readonly annotationPointGroups: readonly EmbeddingPointColorGroup[]
    readonly hasAnnotationStyles: boolean
    readonly roiPoints: readonly AnalysisEmbeddingPoint[]
    readonly selectedPoint: AnalysisEmbeddingPoint | undefined
  },
) {
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#171511'
  context.fillRect(0, 0, width, height)

  if (layers.hasAnnotationStyles) {
    for (const group of layers.annotationPointGroups) {
      context.fillStyle = group.color

      for (const point of group.points) {
        const [x, y] = embeddingPointToScreen(point, bounds, width, height)
        context.fillRect(x, y, 1.2, 1.2)
      }
    }
  } else {
    context.fillStyle = 'rgba(246, 242, 232, 0.28)'

    for (const point of layers.basePoints) {
      const [x, y] = embeddingPointToScreen(point, bounds, width, height)
      context.fillRect(x, y, 1.2, 1.2)
    }
  }

  context.fillStyle = 'rgba(240, 200, 75, 0.92)'
  for (const point of layers.roiPoints) {
    const [x, y] = embeddingPointToScreen(point, bounds, width, height)
    context.beginPath()
    context.arc(x, y, 2.4, 0, Math.PI * 2)
    context.fill()
  }

  if (layers.selectedPoint !== undefined) {
    const [x, y] = embeddingPointToScreen(layers.selectedPoint, bounds, width, height)
    context.beginPath()
    context.arc(x, y, 4.4, 0, Math.PI * 2)
    context.fillStyle = 'rgba(215, 63, 124, 0.98)'
    context.fill()
    context.lineWidth = 1.5
    context.strokeStyle = 'rgba(255, 253, 247, 0.92)'
    context.stroke()
  }
}

function nearestEmbeddingPoint(
  points: readonly AnalysisEmbeddingPoint[],
  bounds: EmbeddingBounds,
  screenX: number,
  screenY: number,
  width: number,
  height: number,
): AnalysisEmbeddingPoint | null {
  let nearestPoint: AnalysisEmbeddingPoint | null = null
  let nearestDistanceSquared = 9 * 9

  for (const point of points) {
    const [x, y] = embeddingPointToScreen(point, bounds, width, height)
    const dx = x - screenX
    const dy = y - screenY
    const distanceSquared = dx * dx + dy * dy

    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared
      nearestPoint = point
    }
  }

  return nearestPoint
}

function embeddingPointToScreen(
  point: AnalysisEmbeddingPoint,
  bounds: EmbeddingBounds,
  width: number,
  height: number,
): readonly [number, number] {
  const plotWidth = Math.max(1, width - EMBEDDING_PLOT_PADDING * 2)
  const plotHeight = Math.max(1, height - EMBEDDING_PLOT_PADDING * 2)
  const xRatio = (point.x - bounds.minX) / Math.max(1e-9, bounds.maxX - bounds.minX)
  const yRatio = (point.y - bounds.minY) / Math.max(1e-9, bounds.maxY - bounds.minY)

  return [
    EMBEDDING_PLOT_PADDING + xRatio * plotWidth,
    EMBEDDING_PLOT_PADDING + (1 - yRatio) * plotHeight,
  ]
}

function hexToCanvasRgba(hexColor: string, alpha: number): string {
  const normalized = hexColor.trim().replace(/^#/, '')

  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return `rgba(215, 63, 124, ${alpha})`
  }

  return `rgba(${Number.parseInt(normalized.slice(0, 2), 16)}, ${Number.parseInt(
    normalized.slice(2, 4),
    16,
  )}, ${Number.parseInt(normalized.slice(4, 6), 16)}, ${alpha})`
}
