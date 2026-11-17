import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { HEATMAP_COLUMN_WIDTH, heatmapRowHeight, type HeatmapModel } from './heatmap'
import {
  formatPlotNumber,
  intensityColour,
  meanCellTitle,
  selectionGroupTitle,
  type PlotMeanCell,
} from './plotModel'

// The heatmap in the panel (plan 22-G, 22-D9): tiles on a canvas scaled for
// the device pixel ratio, with the group and gene labels as text around it.
// Hovering finds the tile under the pointer. The table under Show numbers
// is its text alternative. Hover state stays here, so it redraws nothing
// else.
export function HeatmapFigure({ plot }: { readonly plot: HeatmapModel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hovered, setHovered] = useState<PlotMeanCell | null>(null)
  const rowHeight = heatmapRowHeight(plot.groups.length)
  const width = plot.genes.length * HEATMAP_COLUMN_WIDTH
  const height = plot.groups.length * rowHeight
  const compact = rowHeight < 16

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d') ?? null
    if (canvas === null || context === null) return
    drawHeatmap(canvas, context, plot, width, height, rowHeight)
  }, [height, plot, rowHeight, width])

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const geneIndex = Math.floor((event.clientX - rect.left) / HEATMAP_COLUMN_WIDTH)
    const groupIndex = Math.floor((event.clientY - rect.top) / rowHeight)
    const cell =
      plot.cells.find(
        (candidate) =>
          candidate.geneIndex === geneIndex && candidate.groupIndex === groupIndex,
      ) ?? null
    if (cell !== hovered) setHovered(cell)
  }

  const range = plot.colourRange
  const [lowLabel, highLabel] =
    plot.colour === 'per-gene'
      ? ['lowest', 'highest']
      : range === null
        ? ['', '']
        : [formatPlotNumber(range.low), formatPlotNumber(range.high)]

  return (
    <div
      className={`plots-heatmap${compact ? ' plots-heatmap--compact' : ''}`}
      style={{ '--heatmap-row': `${rowHeight}px` } as CSSProperties}
    >
      <ol className="plots-heatmap-genes" aria-hidden="true">
        {plot.genes.map(({ gene }) => (
          <li key={gene} title={gene}>
            {gene}
          </li>
        ))}
      </ol>
      <ol className="plots-heatmap-groups" aria-hidden="true">
        {plot.groups.map((group) => (
          <li
            key={group.id}
            title={
              group.kind === 'selection' ? selectionGroupTitle(group.label) : group.label
            }
          >
            <span className="plots-heatmap-label">{group.label}</span>
            <span
              className={`plots-heatmap-swatch${group.kind === 'selection' ? ' plots-heatmap-swatch--selection' : ''}`}
              style={{ background: group.color }}
            />
          </li>
        ))}
      </ol>
      <div className="plots-heatmap-grid" role="img" aria-label={plot.summary}>
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ width, height }}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => {
            setHovered(null)
          }}
        />
        {hovered === null ? null : (
          <p
            className="plots-heatmap-tip"
            aria-hidden="true"
            style={tipPosition(hovered, plot.genes.length, rowHeight)}
          >
            {meanCellTitle(
              plot.groups[hovered.groupIndex]?.label ?? '',
              plot.genes[hovered.geneIndex]?.gene ?? '',
              hovered,
              plot.valueLabel,
            )}
          </p>
        )}
      </div>
      <div className="plots-heatmap-legend">
        <span>
          {plot.colour === 'per-gene'
            ? `Mean ${plot.valueLabel}, per gene`
            : `Mean ${plot.valueLabel}`}
        </span>
        <span
          className="plots-heatmap-bar"
          style={{
            background: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1]
              .map((offset) => intensityColour(plot.colorScale, offset))
              .join(', ')})`,
          }}
        />
        <span className="plots-heatmap-ends">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </span>
      </div>
    </div>
  )
}

// Beside the tile, on the side with more room.
function tipPosition(
  cell: PlotMeanCell,
  geneCount: number,
  rowHeight: number,
): CSSProperties {
  const top = cell.groupIndex * rowHeight
  return cell.geneIndex < geneCount / 2
    ? { top, left: (cell.geneIndex + 1) * HEATMAP_COLUMN_WIDTH + 6 }
    : { top, right: (geneCount - cell.geneIndex) * HEATMAP_COLUMN_WIDTH + 6 }
}

function drawHeatmap(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  plot: HeatmapModel,
  width: number,
  height: number,
  rowHeight: number,
): void {
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1)
  canvas.width = Math.round(width * pixelRatio)
  canvas.height = Math.round(height * pixelRatio)
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, width, height)

  // Groups with no cells stay blank.
  for (const cell of plot.cells) {
    if (cell.mean === null) continue
    context.fillStyle = intensityColour(plot.colorScale, cell.intensity ?? 0)
    context.fillRect(
      cell.geneIndex * HEATMAP_COLUMN_WIDTH,
      cell.groupIndex * rowHeight,
      HEATMAP_COLUMN_WIDTH,
      rowHeight,
    )
  }

  // A rule under the selection, which overlaps the classes below it, in the
  // theme's rule colour.
  const selectionRows = plot.groups.filter((group) => group.kind === 'selection').length
  if (selectionRows > 0 && plot.groups.length > selectionRows) {
    const y = selectionRows * rowHeight
    context.strokeStyle =
      getComputedStyle(canvas).getPropertyValue('--border-strong').trim() || '#6e6b62'
    context.lineWidth = 1
    context.setLineDash([3, 3])
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
    context.setLineDash([])
  }
}
