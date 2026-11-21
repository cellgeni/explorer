import { useCallback, useMemo, useState } from 'react'
import type { AnnotationColorStyle } from '../../rendering/cellStyling'
import type { SavedSelection } from '../roi/selectionListModel'
import type { GeneExpressionColorScale } from '../../rendering/deckLayerTypes'
import type {
  AnnotationLoader,
  RoiCellsLoader,
  SpatialDatasetLoader,
} from '../app-shell/appDependencies'
import {
  downloadBlob,
  downloadTextFile,
  type AppendDebugEvent,
} from '../app-shell/appRuntimeModel'
import { dotPlotModel } from './dotPlot'
import { heatmapModel } from './heatmap'
import { documentPlotPaint, plotFileName, plotStatsCsv, svgPngBlob } from './plotExport'
import type { PlotColourMode, PlotGene, PlotKind } from './plotModel'
import type { PlotScale } from './plotStats'
import {
  formatReadSize,
  PLOT_MAX_GENES,
  PLOT_READ_MAX_BYTES,
  plotGenesPhrase,
  plotGroupsInput,
  plotKindInfo,
  datasetSetGroupId,
  plotNonFiniteNotes,
  plotsPanelGroups,
  resolvePlotSetId,
  SELECTIONS_SET_ID,
  type PlotDatasetSet,
  type PlotSetOption,
  type PlotsSelectionInput,
} from './plotsPanelModel'
import { plotViewSvg, svgSize, type PlotView } from './plotViews'
import { svgDocument } from './svgMarkup'
import { useDatasetSetAnnotations } from './useDatasetSetAnnotations'
import { useSelectionCells } from './useSelectionCells'
import { openPlotsSource, usePlotsWorkflow, type PlotsData } from './usePlotsWorkflow'
import { violinPlotModel } from './violinPlot'
import type { Annotation } from '../../data/annotation'

// The Plots panel (plan 22-D): what it shows and what its controls do.

export interface PlotsModel {
  // The line under the heading.
  readonly status: string
  readonly loading: boolean
  readonly plotKind: PlotKind
  readonly onPlotKindChange: (kind: PlotKind) => void
  readonly setOptions: readonly PlotSetOption[]
  readonly setId: string | null
  readonly onSetChange: (setId: string) => void
  readonly scale: PlotScale
  // log1p is off for a matrix with negative values (22-D4).
  readonly log1pAvailable: boolean
  readonly onScaleChange: (scale: PlotScale) => void
  readonly colour: PlotColourMode
  readonly onColourChange: (colour: PlotColourMode) => void
  // The violin shows every cell, or the expressing cells only (22-F).
  readonly includeZeros: boolean
  readonly onIncludeZerosChange: (include: boolean) => void
  readonly showNumbers: boolean
  readonly onShowNumbersChange: (show: boolean) => void
  // A message in place of the plot, or the plot.
  readonly message: string | null
  readonly plot: PlotView | null
  // What the plot leaves out, and genes that failed.
  readonly notes: readonly string[]
  readonly geneErrors: readonly string[]
  readonly reading: boolean
  readonly onCancel: () => void
  // A large read waiting for Read (22-D7): what it fetches, for the button.
  readonly confirmReadTitle: string | null
  readonly onConfirmRead: () => void
  // After an error or a cancelled read.
  readonly canRetry: boolean
  readonly onRetry: () => void
  readonly onExportSvg: () => void
  readonly onExportPng: () => void
  readonly onExportCsv: () => void
}

export interface PlotsModelInput {
  readonly open: boolean
  // The plot shown, kept in the link as `plot=` (22-D8).
  readonly plotKind: PlotKind
  readonly onPlotKindChange: (kind: PlotKind) => void
  // The platform's cells have annotation sets (Visium HD bins do not).
  readonly available: boolean
  readonly datasetUrl: string | null
  readonly datasetReady: boolean
  readonly platformLabel: string
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly annotations: readonly Annotation<string>[]
  readonly visibleClasses: readonly Pick<AnnotationColorStyle, 'id' | 'color'>[]
  readonly selection: PlotsSelectionInput | null
  // Saved selections, each a group under Group by › Selections, and how
  // their cells are looked up.
  readonly savedSelections: readonly SavedSelection[]
  readonly loadSelectionCells: RoiCellsLoader
  // The dataset's sets Clusters has not loaded, which Plots reads itself.
  readonly datasetSets: readonly PlotDatasetSet[]
  readonly loadSetAnnotations: AnnotationLoader
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
  plotKind,
  onPlotKindChange,
  available,
  datasetUrl,
  datasetReady,
  platformLabel,
  getSpatialDataset,
  annotations,
  visibleClasses,
  selection,
  savedSelections: savedSelectionList,
  loadSelectionCells,
  datasetSets,
  loadSetAnnotations,
  selectedGenes,
  colorScale,
  elementNoun,
  appendDebugEvent,
}: PlotsModelInput): PlotsModel {
  const [chosenSetId, setChosenSetId] = useState<string | null>(null)
  const [chosenScale, setChosenScale] = useState<PlotScale | null>(null)
  const [colour, setColour] = useState<PlotColourMode>('shared')
  const [includeZeros, setIncludeZeros] = useState(true)
  const [showNumbers, setShowNumbers] = useState(false)
  const kindInfo = plotKindInfo(plotKind)
  const active = open && available && datasetReady
  // The set Group by shows before a dataset set's classes are known; a set
  // Plots reads alone is the one chosen, or the default.
  const baseSources = {
    annotations,
    savedSelectionCount: savedSelectionList.length,
    datasetSets,
    datasetSet: null,
  }
  const baseSetId = resolvePlotSetId(baseSources, chosenSetId)
  const datasetSet = useDatasetSetAnnotations({
    enabled: active && datasetSetGroupId(baseSetId) !== null,
    datasetUrl,
    groupId: datasetSetGroupId(chosenSetId) ?? datasetSetGroupId(baseSetId),
    loadAnnotations: loadSetAnnotations,
    appendDebugEvent,
  })
  const savedSelections = useSelectionCells({
    enabled:
      active &&
      resolvePlotSetId({ ...baseSources, datasetSet }, chosenSetId) === SELECTIONS_SET_ID,
    datasetUrl,
    selections: savedSelectionList,
    loadCells: loadSelectionCells,
    appendDebugEvent,
  })

  const panel = useMemo(
    () =>
      plotsPanelGroups({
        annotations,
        visibleClasses,
        setId: chosenSetId,
        selection,
        savedSelections,
        datasetSets,
        datasetSet,
        selectedGenes,
        maxClasses: kindInfo.maxClasses,
      }),
    [
      annotations,
      chosenSetId,
      datasetSet,
      datasetSets,
      kindInfo.maxClasses,
      savedSelections,
      selectedGenes,
      selection,
      visibleClasses,
    ],
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
  const genes = useMemo<readonly PlotGene[]>(
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

  const plot = useMemo((): PlotView | null => {
    if (genes.every(({ stats }) => stats === null)) return null

    const input = {
      groups: panel.groups,
      genes,
      scale,
      valueLabel,
      setLabel: panel.setLabel,
    }
    switch (plotKind) {
      case 'dot':
        return { kind: 'dot', model: dotPlotModel({ ...input, colour, colorScale }) }
      case 'violin':
        return { kind: 'violin', model: violinPlotModel({ ...input, includeZeros }) }
      case 'heatmap':
        return { kind: 'heatmap', model: heatmapModel({ ...input, colour, colorScale }) }
    }
  }, [
    colorScale,
    colour,
    genes,
    includeZeros,
    panel.groups,
    panel.setLabel,
    plotKind,
    scale,
    valueLabel,
  ])
  const fileName = (extension: string) =>
    datasetUrl === null
      ? null
      : plotFileName(datasetUrl, kindInfo.fileName, panel.setLabel, extension)
  const plotName = kindInfo.label.toLowerCase()

  const largeRead = largeReadNotice(data)
  const message = plotsMessage({
    available,
    datasetReady,
    data,
    hasGenes: panel.genes.length > 0,
    hasGroups: panel.groups.length > 0,
    pendingSelectionCount: panel.pendingSelectionCount,
    pendingSetLabel: panel.pendingDatasetSet ? panel.setLabel : null,
    datasetSetError:
      panel.datasetSetError === null
        ? null
        : `${panel.setLabel ?? 'The set'} could not be read: ${panel.datasetSetError}`,
    hasPlot: plot !== null,
    platformLabel,
    elementNoun,
    largeRead,
  })
  // With genes already plotted, the large read is a note under the plot.
  const notes = [
    ...(plot !== null && largeRead !== null ? [largeRead] : []),
    ...plotsNotes(panel, data, elementNoun, log1pAvailable, plotKind),
    ...plotNonFiniteNotes(loadedStats, elementNoun),
  ]
  const geneErrors = panel.genes.flatMap((gene) => {
    const error = data.geneErrors.get(gene)
    return error === undefined ? [] : [error]
  })
  const reading = data.status === 'reading' || data.status === 'preparing'

  return {
    status: plotsStatus(panel, data),
    loading: reading || panel.pendingSelectionCount > 0 || panel.pendingDatasetSet,
    plotKind,
    onPlotKindChange: (kind) => {
      onPlotKindChange(kind)
      appendDebugEvent(`Plots: showing the ${plotKindInfo(kind).label.toLowerCase()}`)
    },
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
    includeZeros,
    onIncludeZerosChange: setIncludeZeros,
    showNumbers,
    onShowNumbersChange: setShowNumbers,
    message,
    plot: message === null ? plot : null,
    notes,
    geneErrors,
    reading,
    onCancel: data.cancel,
    confirmReadTitle:
      data.status === 'confirm' && data.largeRead !== null
        ? `Read ${plotGenesPhrase(data.largeRead.genes)}: about ${formatReadSize(data.largeRead.bytes)} of the matrix, uncompressed`
        : null,
    onConfirmRead: () => {
      data.confirmRead()
      appendDebugEvent('Plots: read allowed')
    },
    canRetry:
      data.status === 'cancelled' || data.status === 'error' || geneErrors.length > 0,
    onRetry: data.retry,
    onExportSvg: () => {
      const name = fileName('svg')
      if (plot === null || name === null) return
      downloadTextFile(
        name,
        svgDocument(plotViewSvg(plot, documentPlotPaint(), plot.kind)),
        'image/svg+xml;charset=utf-8',
      )
      appendDebugEvent(`Plots: exported the ${plotName} as SVG`)
    },
    onExportPng: () => {
      const name = fileName('png')
      if (plot === null || name === null) return
      const svg = plotViewSvg(plot, documentPlotPaint(), plot.kind)
      const { width, height } = svgSize(svg)
      svgPngBlob(svgDocument(svg), width, height).then(
        (blob) => {
          downloadBlob(name, blob)
          appendDebugEvent(`Plots: exported the ${plotName} as PNG`)
        },
        (error: unknown) => {
          appendDebugEvent(
            `Plots: PNG export failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        },
      )
    },
    onExportCsv: () => {
      const name = fileName('csv')
      if (plot === null || name === null) return
      downloadTextFile(
        name,
        plotStatsCsv({
          setLabel: panel.setLabel,
          groups: panel.groups,
          genes,
          scale,
          valueLabel,
        }),
      )
      appendDebugEvent(`Plots: exported the ${plotName} numbers as CSV`)
    },
  }
}

function plotsStatus(
  panel: ReturnType<typeof plotsPanelGroups>,
  data: PlotsData,
): string {
  const geneCount = panel.genes.length
  const groupCount = panel.groups.length
  const setLabel = panel.setLabel

  if (panel.pendingDatasetSet) return `Reading ${panel.setLabel ?? 'the set'}`
  if (panel.pendingSelectionCount > 0) {
    const count = panel.pendingSelectionCount
    return `Finding the cells in ${count.toLocaleString()} ${count === 1 ? 'selection' : 'selections'}`
  }
  if (data.status === 'reading') {
    const count = data.readingGenes.length
    return `Reading ${count.toLocaleString()} ${count === 1 ? 'gene' : 'genes'}`
  }
  if (data.status === 'preparing') return 'Preparing'
  if (data.status === 'confirm') return 'Waiting for Read'
  if (data.status === 'too-large') return 'Too large to read'
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
  pendingSelectionCount,
  pendingSetLabel,
  datasetSetError,
  hasPlot,
  platformLabel,
  elementNoun,
  largeRead,
}: {
  readonly available: boolean
  readonly datasetReady: boolean
  readonly data: PlotsData
  readonly hasGenes: boolean
  readonly hasGroups: boolean
  readonly pendingSelectionCount: number
  // A dataset set Plots is reading, and why one could not be read.
  readonly pendingSetLabel: string | null
  readonly datasetSetError: string | null
  readonly hasPlot: boolean
  readonly platformLabel: string
  readonly elementNoun: string
  readonly largeRead: string | null
}): string | null {
  if (!available) {
    return `${platformLabel} ${elementNoun} have no annotation sets to group by.`
  }
  if (!datasetReady) return 'Plots show once the dataset has loaded.'
  if (data.status === 'unavailable') return data.message
  if (!hasGenes) return 'Select genes in Cells › Genes to plot them.'
  if (pendingSetLabel !== null) return `Reading the classes of ${pendingSetLabel}…`
  if (datasetSetError !== null) return datasetSetError
  if (pendingSelectionCount > 0) return `Finding the ${elementNoun} in each selection…`
  if (!hasGroups) {
    return `Load an annotation set in Cells › Clusters, or draw a selection, to group the ${elementNoun}.`
  }
  if (data.status === 'error') return `Plots failed: ${data.message ?? 'unknown error'}`
  if (hasPlot) return null
  if (largeRead !== null) return largeRead
  if (data.status === 'cancelled') return 'Reading cancelled.'
  return data.status === 'ready'
    ? 'No gene could be read.'
    : 'Reading the selected genes…'
}

// What a large read fetches, and why (22-D7).
function largeReadNotice(data: PlotsData): string | null {
  const read = data.largeRead
  if (read === null) return null

  const genes = plotGenesPhrase(read.genes)
  const size = formatReadSize(read.bytes)
  const detail = read.detail === null ? '' : ` ${read.detail}`

  if (data.status === 'confirm') {
    return `Reading ${genes} reads about ${size} of the matrix, uncompressed.${detail} Read to go ahead.`
  }
  if (data.status === 'too-large') {
    return `Reading ${genes} would read about ${size} of the matrix, uncompressed: over the ${formatReadSize(PLOT_READ_MAX_BYTES)} the panel reads.${detail}`
  }
  return null
}

function plotsNotes(
  panel: ReturnType<typeof plotsPanelGroups>,
  data: PlotsData,
  elementNoun: string,
  log1pAvailable: boolean,
  plotKind: PlotKind,
): readonly string[] {
  const notes: string[] = []
  const summary = data.summary

  if (panel.omittedGeneCount > 0) {
    notes.push(
      `Plotting the first ${PLOT_MAX_GENES} of ${(PLOT_MAX_GENES + panel.omittedGeneCount).toLocaleString()} selected genes.`,
    )
  }
  const groupNouns = (count: number) =>
    panel.groupNoun === 'selection'
      ? count === 1
        ? 'selection'
        : 'selections'
      : count === 1
        ? 'class'
        : 'classes'

  if (panel.hiddenClassCount > 0) {
    notes.push(
      `${panel.hiddenClassCount.toLocaleString()} hidden ${groupNouns(panel.hiddenClassCount)} left out.`,
    )
  }
  if (panel.omittedClassCount > 0) {
    const shown = panel.groups.filter((group) => group.kind === 'class').length
    const showing = `Showing the first ${shown.toLocaleString()} of ${(shown + panel.omittedClassCount).toLocaleString()} ${groupNouns(2)}`
    // A set read for the plot alone has no legend to hide classes in.
    notes.push(
      panel.setKind === 'dataset'
        ? `${showing}; load ${panel.setLabel ?? 'the set'} in Cells › Clusters to choose classes${plotKind === 'heatmap' ? '' : ', or use the heatmap'}.`
        : `${showing}; hide ${groupNouns(2)} to choose others.`,
    )
  }
  for (const name of panel.limitedSelections) {
    notes.push(
      `${name} holds its first ${elementNoun} only: the query stopped at its limit.`,
    )
  }
  for (const error of panel.selectionErrors) {
    notes.push(`Left out, as its ${elementNoun} could not be found: ${error}`)
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
      `${summary.repeatedCells.toLocaleString()} ${elementNoun} are in more than one ${groupNouns(1)} and count in each.`,
    )
  }
  if (!log1pAvailable) {
    notes.push('The matrix holds negative values, so it looks scaled: log1p is off.')
  }

  return notes
}
