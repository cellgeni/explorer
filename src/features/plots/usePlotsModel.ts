import { useCallback, useMemo, useState } from 'react'
import type { Annotation } from '../../datasets/spatialDataset'
import type { AnnotationColorStyle } from '../../rendering/cellStyling'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'
import { downloadTextFile, type AppendDebugEvent } from '../app-shell/appRuntimeModel'
import {
  dotPlotModel,
  dotPlotSvg,
  type DotPlotGene,
  type DotPlotModel,
  type PlotColourMode,
} from './dotPlot'
import { documentPlotPaint, plotFileName, plotStatsCsv } from './plotExport'
import type { PlotScale } from './plotStats'
import {
  PLOT_MAX_GENES,
  plotGroupsInput,
  plotsPanelGroups,
  type PlotSetOption,
  type PlotsSelectionInput,
} from './plotsPanelModel'
import { svgDocument } from './svgMarkup'
import { openPlotsSource, usePlotsWorkflow, type PlotsData } from './usePlotsWorkflow'

// The Plots panel (plan 22-D): what it shows and what its controls do.

export interface PlotsModel {
  // The line under the heading.
  readonly status: string
  readonly loading: boolean
  readonly setOptions: readonly PlotSetOption[]
  readonly setId: string | null
  readonly onSetChange: (setId: string) => void
  readonly scale: PlotScale
  // log1p is off for a matrix with negative values (22-D4).
  readonly log1pAvailable: boolean
  readonly onScaleChange: (scale: PlotScale) => void
  readonly colour: PlotColourMode
  readonly onColourChange: (colour: PlotColourMode) => void
  readonly showNumbers: boolean
  readonly onShowNumbersChange: (show: boolean) => void
  // A message in place of the plot, or the plot.
  readonly message: string | null
  readonly plot: DotPlotModel | null
  // What the plot leaves out, and genes that failed.
  readonly notes: readonly string[]
  readonly geneErrors: readonly string[]
  readonly reading: boolean
  readonly onCancel: () => void
  // After an error or a cancelled read.
  readonly canRetry: boolean
  readonly onRetry: () => void
  readonly onExportSvg: () => void
  readonly onExportCsv: () => void
}

export interface PlotsModelInput {
  readonly open: boolean
  // The platform's cells have annotation sets (Visium HD bins do not).
  readonly available: boolean
  readonly datasetUrl: string | null
  readonly datasetReady: boolean
  readonly platformLabel: string
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly annotations: readonly Annotation<string>[]
  readonly visibleClasses: readonly Pick<AnnotationColorStyle, 'id' | 'color'>[]
  readonly selection: PlotsSelectionInput | null
  readonly selectedGenes: readonly string[]
  readonly colorScale: GeneExpressionColorScale
  readonly elementNoun: string
  readonly appendDebugEvent: AppendDebugEvent
}

// Ids for objects, so a key changes when a class's or the selection's cell
// list is replaced.
const objectIds = new WeakMap<object, number>()
let nextObjectId = 0

function objectId(value: object): number {
  let id = objectIds.get(value)
  if (id === undefined) {
    nextObjectId += 1
    id = nextObjectId
    objectIds.set(value, id)
  }
  return id
}

export function usePlotsModel({
  open,
  available,
  datasetUrl,
  datasetReady,
  platformLabel,
  getSpatialDataset,
  annotations,
  visibleClasses,
  selection,
  selectedGenes,
  colorScale,
  elementNoun,
  appendDebugEvent,
}: PlotsModelInput): PlotsModel {
  const [chosenSetId, setChosenSetId] = useState<string | null>(null)
  const [chosenScale, setChosenScale] = useState<PlotScale | null>(null)
  const [colour, setColour] = useState<PlotColourMode>('shared')
  const [showNumbers, setShowNumbers] = useState(false)

  const panel = useMemo(
    () =>
      plotsPanelGroups({
        annotations,
        visibleClasses,
        setId: chosenSetId,
        selection,
        selectedGenes,
      }),
    [annotations, chosenSetId, selectedGenes, selection, visibleClasses],
  )
  const groupsRequest = useMemo(
    () =>
      panel.groups.length === 0
        ? null
        : {
            key: panel.groups
              .map((group) => `${group.id}#${objectId(group.cellIds)}`)
              .join('|'),
            input: plotGroupsInput(panel.groups),
          },
    [panel.groups],
  )
  const openSource = useCallback(
    (url: string) => openPlotsSource(getSpatialDataset, url, platformLabel),
    [getSpatialDataset, platformLabel],
  )
  const data = usePlotsWorkflow({
    enabled: open && available && datasetReady,
    datasetUrl,
    openSource,
    genes: panel.genes,
    groups: groupsRequest,
    appendDebugEvent,
  })

  // Stats for these groups, in the genes' order.
  const current = data.groupsKey !== null && data.groupsKey === groupsRequest?.key
  const genes = useMemo<readonly DotPlotGene[]>(
    () =>
      panel.genes.map((gene) => ({
        gene,
        stats: current ? (data.stats.get(gene) ?? null) : null,
      })),
    [current, data.stats, panel.genes],
  )
  const loadedStats = genes.flatMap(({ stats }) => (stats === null ? [] : [stats]))
  const log1pAvailable = loadedStats.every((stats) => !stats.negative)
  const wholeNumbers = loadedStats.every((stats) => stats.wholeNumbers)
  const scale: PlotScale = !log1pAvailable
    ? 'stored'
    : (chosenScale ?? (wholeNumbers ? 'log1p' : 'stored'))
  const storedLabel = wholeNumbers && loadedStats.length > 0 ? 'counts' : 'X'
  const valueLabel = scale === 'log1p' ? `log1p(${storedLabel})` : storedLabel

  const plot = useMemo(
    () =>
      genes.every(({ stats }) => stats === null)
        ? null
        : dotPlotModel({
            groups: panel.groups,
            genes,
            scale,
            colour,
            colorScale,
            valueLabel,
            setLabel: panel.setLabel,
          }),
    [colorScale, colour, genes, panel.groups, panel.setLabel, scale, valueLabel],
  )

  const message = plotsMessage({
    available,
    datasetReady,
    data,
    hasGenes: panel.genes.length > 0,
    hasGroups: panel.groups.length > 0,
    hasPlot: plot !== null,
    platformLabel,
    elementNoun,
  })
  const notes = plotsNotes(panel, data, elementNoun, log1pAvailable)
  const geneErrors = panel.genes.flatMap((gene) => {
    const error = data.geneErrors.get(gene)
    return error === undefined ? [] : [error]
  })
  const reading = data.status === 'reading' || data.status === 'preparing'

  return {
    status: plotsStatus(panel.genes.length, panel.groups.length, panel.setLabel, data),
    loading: reading,
    setOptions: panel.setOptions,
    setId: panel.setId,
    onSetChange: (setId) => {
      setChosenSetId(setId)
      appendDebugEvent(`Plots: group by ${setId}`)
    },
    scale,
    log1pAvailable,
    onScaleChange: setChosenScale,
    colour,
    onColourChange: setColour,
    showNumbers,
    onShowNumbersChange: setShowNumbers,
    message,
    plot: message === null ? plot : null,
    notes,
    geneErrors,
    reading,
    onCancel: data.cancel,
    canRetry:
      data.status === 'cancelled' || data.status === 'error' || geneErrors.length > 0,
    onRetry: data.retry,
    onExportSvg: () => {
      if (plot === null || datasetUrl === null) return
      downloadTextFile(
        plotFileName(datasetUrl, 'dot-plot', panel.setLabel, 'svg'),
        svgDocument(dotPlotSvg(plot, documentPlotPaint(), 'dot-plot')),
        'image/svg+xml;charset=utf-8',
      )
      appendDebugEvent('Plots: exported the dot plot as SVG')
    },
    onExportCsv: () => {
      if (plot === null || datasetUrl === null) return
      downloadTextFile(
        plotFileName(datasetUrl, 'dot-plot', panel.setLabel, 'csv'),
        plotStatsCsv({ setLabel: panel.setLabel, groups: panel.groups, genes }),
      )
      appendDebugEvent('Plots: exported the dot plot numbers as CSV')
    },
  }
}

function plotsStatus(
  geneCount: number,
  groupCount: number,
  setLabel: string | null,
  data: PlotsData,
): string {
  if (data.status === 'reading') {
    const count = data.readingGenes.length
    return `Reading ${count.toLocaleString()} ${count === 1 ? 'gene' : 'genes'}`
  }
  if (data.status === 'preparing') return 'Preparing'
  if (geneCount === 0 || groupCount === 0) return 'Nothing to plot'

  const genes = `${geneCount.toLocaleString()} ${geneCount === 1 ? 'gene' : 'genes'}`
  return setLabel === null ? `${genes} in the selection` : `${genes} by ${setLabel}`
}

function plotsMessage({
  available,
  datasetReady,
  data,
  hasGenes,
  hasGroups,
  hasPlot,
  platformLabel,
  elementNoun,
}: {
  readonly available: boolean
  readonly datasetReady: boolean
  readonly data: PlotsData
  readonly hasGenes: boolean
  readonly hasGroups: boolean
  readonly hasPlot: boolean
  readonly platformLabel: string
  readonly elementNoun: string
}): string | null {
  if (!available) {
    return `${platformLabel} ${elementNoun} have no annotation sets to group by.`
  }
  if (!datasetReady) return 'Plots show once the dataset has loaded.'
  if (data.status === 'unavailable') return data.message
  if (!hasGenes) return 'Select genes in Cells › Genes to plot them.'
  if (!hasGroups) {
    return `Load an annotation set in Cells › Clusters, or draw a selection, to group the ${elementNoun}.`
  }
  if (data.status === 'error') return `Plots failed: ${data.message ?? 'unknown error'}`
  if (hasPlot) return null
  if (data.status === 'cancelled') return 'Reading cancelled.'
  return data.status === 'ready'
    ? 'No gene could be read.'
    : 'Reading the selected genes…'
}

function plotsNotes(
  panel: ReturnType<typeof plotsPanelGroups>,
  data: PlotsData,
  elementNoun: string,
  log1pAvailable: boolean,
): readonly string[] {
  const notes: string[] = []
  const summary = data.summary

  if (panel.omittedGeneCount > 0) {
    notes.push(
      `Plotting the first ${PLOT_MAX_GENES} of ${(PLOT_MAX_GENES + panel.omittedGeneCount).toLocaleString()} selected genes.`,
    )
  }
  if (panel.hiddenClassCount > 0) {
    notes.push(
      `${panel.hiddenClassCount.toLocaleString()} hidden ${panel.hiddenClassCount === 1 ? 'class' : 'classes'} left out.`,
    )
  }
  if (panel.omittedClassCount > 0) {
    const shown = panel.groups.filter((group) => group.kind === 'class').length
    notes.push(
      `Showing the first ${shown.toLocaleString()} of ${(shown + panel.omittedClassCount).toLocaleString()} classes; hide classes to choose others.`,
    )
  }
  if (panel.selectionHitCellLimit) {
    const name = panel.groups.find((group) => group.kind === 'selection')?.label
    notes.push(
      `${name ?? 'The selection'} holds its first ${elementNoun} only: the query stopped at its limit.`,
    )
  }
  if (summary !== null && summary.unmatchedIds > 0) {
    notes.push(
      `${summary.unmatchedIds.toLocaleString()} listed ${elementNoun} match no ${elementNoun.replace(/s$/, '')} in the matrix and are left out.`,
    )
  }
  if (summary !== null && summary.repeatedCells > 0) {
    notes.push(
      `${summary.repeatedCells.toLocaleString()} ${elementNoun} are in more than one class and count in each.`,
    )
  }
  if (!log1pAvailable) {
    notes.push('The matrix holds negative values, so it looks scaled: log1p is off.')
  }

  return notes
}
