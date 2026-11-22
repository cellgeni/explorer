import { memo, useId, useMemo } from 'react'
import { Button, Select, Switch } from '../../components/ui'
import { HeatmapFigure } from './HeatmapFigure'
import { PANEL_PLOT_PAINT, type PlotColourMode, type PlotKind } from './plotModel'
import type { PlotScale } from './plotStats'
import { PLOT_KINDS, type PlotSetKind } from './plotsPanelModel'
import { plotViewSvg, plotViewTable, type PlotView } from './plotViews'
import { SvgTree } from './SvgTree'
import type { PlotsModel } from './usePlotsModel'

// The Plots panel's body (plan 22-D, 22-E to 22-G): Plot, Group by, Scale
// and the plot's own controls, the plot or a table of its numbers, notes,
// and the exports.
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
          <PlotTableView plot={plots.plot} />
        ) : (
          <PlotFigure plot={plots.plot} />
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

const PLOT_KIND_OPTIONS = PLOT_KINDS.map(({ value, label }) => ({ value, label }))

// Group by's headings: sets Clusters has loaded, and the dataset's others,
// which Plots reads for the plot alone.
const SET_GROUPS: Readonly<Record<PlotSetKind, string | undefined>> = {
  loaded: 'Loaded',
  dataset: 'In the dataset',
  selections: undefined,
}

function PlotsControls({ plots }: { readonly plots: PlotsModel }) {
  return (
    <div className="plots-controls">
      <Select<PlotKind>
        title="The plot: dot plot, violin or group-mean heatmap"
        label="Plot"
        value={plots.plotKind}
        options={PLOT_KIND_OPTIONS}
        onChange={plots.onPlotKindChange}
      />
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
                group: SET_GROUPS[option.kind],
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
      {plots.plotKind === 'violin' ? (
        <Switch
          title="Show every cell, with the cells at 0, or only the cells expressing the gene"
          label="Include zeros"
          checked={plots.includeZeros}
          onChange={plots.onIncludeZerosChange}
        />
      ) : (
        <Select<PlotColourMode>
          title="Colour means on one range for every gene, or from each gene's lowest to highest mean"
          label="Colour"
          value={plots.colour}
          options={COLOUR_OPTIONS}
          onChange={plots.onColourChange}
        />
      )}
      <Switch
        title="Show the plot's numbers as a table"
        label="Show numbers"
        checked={plots.showNumbers}
        onChange={plots.onShowNumbersChange}
      />
    </div>
  )
}

// The figure and the table are drawn once per plot: App renders the panel
// on every hover and view change, and a large violin's tree or a heatmap's
// table takes tenths of a second to build.
const PlotFigure = memo(function PlotFigure({ plot }: { readonly plot: PlotView }) {
  const idPrefix = useId().replaceAll(':', '')
  const node = useMemo(
    () =>
      plot.kind === 'heatmap'
        ? null
        : plotViewSvg(plot, PANEL_PLOT_PAINT, `${plot.kind}-plot-${idPrefix}`),
    [idPrefix, plot],
  )

  if (plot.kind === 'heatmap') return <HeatmapFigure plot={plot.model} />

  return (
    <div className="plots-figure">{node === null ? null : <SvgTree node={node} />}</div>
  )
})

// The plot's numbers, which is also its text alternative (22-D9).
const PlotTableView = memo(function PlotTableView({ plot }: { readonly plot: PlotView }) {
  const table = useMemo(() => plotViewTable(plot), [plot])
  return (
    <div className="plots-table-scroll">
      <table className="plots-table">
        <caption>{table.caption}</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            {table.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.group}</th>
              {row.values.map((value, index) => (
                <td key={table.columns[index] ?? index}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

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
          title="Download the plot as an SVG file"
          disabled={plots.plot === null}
          onClick={plots.onExportSvg}
        >
          Export SVG
        </Button>
        <Button
          title="Download the plot as a PNG image, at twice its size"
          disabled={plots.plot === null}
          onClick={plots.onExportPng}
        >
          Export PNG
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
