import { useId } from 'react'
import { Button, Select, Switch } from '../../components/ui'
import {
  dotPlotSvg,
  formatPercent,
  formatPlotNumber,
  PANEL_PLOT_PAINT,
  type DotPlotModel,
  type PlotColourMode,
} from './dotPlot'
import type { PlotScale } from './plotStats'
import { SvgTree } from './SvgTree'
import type { PlotsModel } from './usePlotsModel'

// The Plots panel's body (plan 22-D, 22-E): Group by, Scale and Colour, the
// dot plot or a table of its numbers, notes, and the exports.
export function PlotsPanel({ plots }: { readonly plots: PlotsModel }) {
  return (
    <>
      <PlotsControls plots={plots} />
      {/* The plot scrolls when larger than the window, so the keyboard can
          reach it to scroll. */}
      <div
        className="plots-view"
        {...(plots.message === null && plots.plot !== null
          ? { tabIndex: 0, role: 'group', 'aria-label': 'Plot' }
          : {})}
      >
        {plots.message !== null || plots.plot === null ? (
          <p className="plots-message">
            {plots.message ?? 'Reading the selected genes…'}
          </p>
        ) : plots.showNumbers ? (
          <DotPlotTable plot={plots.plot} />
        ) : (
          <DotPlotFigure plot={plots.plot} />
        )}
      </div>
      <PlotsFooter plots={plots} />
    </>
  )
}

const SCALE_LABELS: Readonly<Record<PlotScale, string>> = {
  log1p: 'log1p',
  stored: 'As stored',
}

const COLOUR_OPTIONS: readonly {
  readonly value: PlotColourMode
  readonly label: string
}[] = [
  { value: 'shared', label: 'Shared across genes' },
  { value: 'per-gene', label: 'Per gene' },
]

function PlotsControls({ plots }: { readonly plots: PlotsModel }) {
  return (
    <div className="plots-controls">
      <Select
        title="The annotation set whose classes group the cells"
        label="Group by"
        value={plots.setId ?? ''}
        options={
          plots.setOptions.length === 0
            ? [{ value: '', label: 'No set loaded', disabled: true }]
            : plots.setOptions.map((option) => ({
                value: option.id,
                label: `${option.label} (${option.classCount.toLocaleString()})`,
              }))
        }
        disabled={plots.setOptions.length === 0}
        onChange={plots.onSetChange}
      />
      <Select<PlotScale>
        title={
          plots.log1pAvailable
            ? 'How values are shown: log1p(value), or as the matrix stores them'
            : 'The matrix holds negative values, so log1p is off'
        }
        label="Scale"
        value={plots.scale}
        options={[
          { value: 'log1p', label: SCALE_LABELS.log1p, disabled: !plots.log1pAvailable },
          { value: 'stored', label: SCALE_LABELS.stored },
        ]}
        onChange={plots.onScaleChange}
      />
      <Select<PlotColourMode>
        title="Colour means on one range for every gene, or from each gene's lowest to highest mean"
        label="Colour"
        value={plots.colour}
        options={COLOUR_OPTIONS}
        onChange={plots.onColourChange}
      />
      <Switch
        title="Show the plot's numbers as a table"
        label="Show numbers"
        checked={plots.showNumbers}
        onChange={plots.onShowNumbersChange}
      />
    </div>
  )
}

function DotPlotFigure({ plot }: { readonly plot: DotPlotModel }) {
  const idPrefix = useId().replaceAll(':', '')

  return (
    <div className="plots-figure">
      <SvgTree node={dotPlotSvg(plot, PANEL_PLOT_PAINT, `dot-plot-${idPrefix}`)} />
    </div>
  )
}

// The plot's numbers, which is also its text alternative (22-D9).
function DotPlotTable({ plot }: { readonly plot: DotPlotModel }) {
  return (
    <div className="plots-table-scroll">
      <table className="plots-table">
        <caption>{plot.summary}</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Gene</th>
            <th scope="col">Cells</th>
            <th scope="col">% expressing</th>
            <th scope="col">Mean {plot.valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {plot.cells.map((cell) => {
            const group = plot.groups[cell.groupIndex]
            const gene = plot.genes[cell.geneIndex]?.gene ?? ''
            return (
              <tr key={`${cell.groupIndex}:${cell.geneIndex}`}>
                <th scope="row">
                  {group?.label ?? ''}
                  {group?.kind === 'selection' ? ' (selection)' : ''}
                </th>
                <td>{gene}</td>
                <td>{cell.cells.toLocaleString()}</td>
                <td>{cell.percent === null ? '–' : formatPercent(cell.percent)}</td>
                <td>{cell.mean === null ? '–' : formatPlotNumber(cell.mean)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PlotsFooter({ plots }: { readonly plots: PlotsModel }) {
  const notes = [...plots.notes, ...plots.geneErrors]

  return (
    <div className="plots-footer">
      {notes.length === 0 ? null : (
        <ul className="plots-notes" aria-live="polite">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <div className="plots-actions">
        {plots.confirmReadTitle === null ? null : (
          <Button
            variant="primary"
            title={plots.confirmReadTitle}
            onClick={plots.onConfirmRead}
          >
            Read
          </Button>
        )}
        {plots.reading ? (
          <Button title="Stop reading the selected genes" onClick={plots.onCancel}>
            Cancel
          </Button>
        ) : null}
        {plots.canRetry && !plots.reading ? (
          <Button
            title="Read the genes that failed or were cancelled"
            onClick={plots.onRetry}
          >
            Try again
          </Button>
        ) : null}
        <Button
          title="Download the dot plot as an SVG file"
          disabled={plots.plot === null}
          onClick={plots.onExportSvg}
        >
          Export SVG
        </Button>
        <Button
          title="Download each group's numbers for each gene as CSV"
          disabled={plots.plot === null}
          onClick={plots.onExportCsv}
        >
          Export CSV
        </Button>
      </div>
    </div>
  )
}
