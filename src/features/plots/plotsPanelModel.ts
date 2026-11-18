import type { Annotation } from '../../datasets/spatialDataset'
import type { AnnotationColorStyle } from '../../rendering/cellStyling'
import { ALL_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import { annotationSetGrouping } from '../annotations/annotationModel'
import type { PlotKind } from './plotModel'
import { PLOT_DENSITY_MAX_GROUPS, type PlotGroupsInput } from './plotStats'

// What the Plots panel plots (plan 22-D1 to 22-D3): the selected genes,
// grouped by the classes of one annotation set, with the active selection
// as an extra group first. Group by › Selections makes each saved
// selection a group instead, and the dataset's other sets are read for the
// plot alone.

// The Xenium reader's limit, kept for every platform (22-D1).
export const PLOT_MAX_GENES = 32
// Classes each plot shows (22-D2). The violin's, with the selection, stay
// within the groups the worker makes densities for.
export const DOT_PLOT_MAX_CLASSES = 60
export const VIOLIN_MAX_CLASSES = Math.min(60, PLOT_DENSITY_MAX_GROUPS - 1)
export const HEATMAP_MAX_CLASSES = 500

export interface PlotKindInfo {
  readonly value: PlotKind
  readonly label: string
  readonly maxClasses: number
  // The plot's name in file names.
  readonly fileName: string
}

const DOT_PLOT_KIND: PlotKindInfo = {
  value: 'dot',
  label: 'Dot plot',
  maxClasses: DOT_PLOT_MAX_CLASSES,
  fileName: 'dot-plot',
}

export const PLOT_KINDS: readonly PlotKindInfo[] = [
  DOT_PLOT_KIND,
  {
    value: 'violin',
    label: 'Violin',
    maxClasses: VIOLIN_MAX_CLASSES,
    fileName: 'violin',
  },
  {
    value: 'heatmap',
    label: 'Heatmap',
    maxClasses: HEATMAP_MAX_CLASSES,
    fileName: 'heatmap',
  },
]

// `plot=` (22-D8); the dot plot when the link names none or another.
export function parsePlotKind(value: string | undefined): PlotKind {
  return PLOT_KINDS.find((kind) => kind.value === value)?.value ?? DOT_PLOT_KIND.value
}

export function plotKindInfo(kind: PlotKind): PlotKindInfo {
  return PLOT_KINDS.find((info) => info.value === kind) ?? DOT_PLOT_KIND
}

// Where a Group by set comes from: loaded in Cells › Clusters (or imported,
// or kept with Save ROI), listed by the dataset and read by Plots alone, or
// the saved selections.
export type PlotSetKind = 'loaded' | 'dataset' | 'selections'

export interface PlotSetOption {
  readonly id: string
  readonly label: string
  readonly classCount: number
  readonly kind: PlotSetKind
}

export interface PlotGroup {
  readonly id: string
  readonly label: string
  readonly color: string
  readonly kind: 'selection' | 'class'
  readonly cellIds: readonly string[]
}

export interface PlotsSelectionInput {
  readonly name: string
  readonly color: string
  readonly cellIds: readonly string[]
  // The ROI query stopped at its cell limit (Xenium, 50,000 cells).
  readonly hitCellLimit: boolean
}

// Group by › Selections: every saved selection, as Annotations › Selections
// lists them.
export const SELECTIONS_SET_ID = 'saved-selections'
const SELECTIONS_SET_LABEL = 'Selections'

export type PlotSelectionCells =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly cellIds: readonly string[]
      // The query stopped at its cell limit (Xenium, 50,000 cells).
      readonly hitCellLimit: boolean
    }
  | { readonly status: 'error'; readonly message: string }

export interface PlotSavedSelection {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly visible: boolean
  readonly cells: PlotSelectionCells
}

// A set the dataset lists (Cells › Clusters › Annotation set) that Clusters
// has not loaded. Choosing it in Group by reads its classes for the plot
// alone, leaving the map's colours and the legend as they are.
export interface PlotDatasetSet {
  // The dataset's group id, as Clusters loads it.
  readonly groupId: string
  readonly label: string
  readonly classCount: number
}

export type PlotDatasetSetState =
  | { readonly groupId: string; readonly status: 'loading' }
  | {
      readonly groupId: string
      readonly status: 'ready'
      readonly annotations: readonly Annotation<string>[]
      readonly colors: Readonly<Record<string, string>>
    }
  | { readonly groupId: string; readonly status: 'error'; readonly message: string }

const DATASET_SET_PREFIX = 'dataset-set:'

export function datasetSetOptionId(groupId: string): string {
  return `${DATASET_SET_PREFIX}${groupId}`
}

// The dataset group a Group by option reads, or null for any other option.
export function datasetSetGroupId(setId: string | null): string | null {
  return setId?.startsWith(DATASET_SET_PREFIX) === true
    ? setId.slice(DATASET_SET_PREFIX.length)
    : null
}

// The dataset's sets Plots may read itself: every one but those Clusters has
// loaded, which Group by lists with the loaded sets.
export function plotDatasetSets(
  groups: readonly {
    readonly id: string
    readonly label: string
    readonly groupCount?: number
  }[],
  loadedGroupId: string | undefined,
): readonly PlotDatasetSet[] {
  if (loadedGroupId === ALL_ANNOTATION_GROUP_ID) return []

  return groups.flatMap((group) =>
    group.id === loadedGroupId
      ? []
      : [{ groupId: group.id, label: group.label, classCount: group.groupCount ?? 0 }],
  )
}

export interface PlotSetSources {
  // Every loaded class, shown or hidden, in the legend's order.
  readonly annotations: readonly Annotation<string>[]
  readonly savedSelectionCount: number
  readonly datasetSets: readonly PlotDatasetSet[]
  // The set Plots read for the plot alone, whose set id follows the choice
  // once Clusters loads the same set.
  readonly datasetSet: PlotDatasetSetState | null
}

export interface PlotsPanelInput {
  // Every loaded class, shown or hidden, in the legend's order.
  readonly annotations: readonly Annotation<string>[]
  // The shown classes with the legend's colours.
  readonly visibleClasses: readonly Pick<AnnotationColorStyle, 'id' | 'color'>[]
  // The set chosen in Group by, or null for the default.
  readonly setId: string | null
  readonly selection: PlotsSelectionInput | null
  readonly savedSelections?: readonly PlotSavedSelection[]
  readonly datasetSets?: readonly PlotDatasetSet[]
  readonly datasetSet?: PlotDatasetSetState | null
  readonly selectedGenes: readonly string[]
  readonly maxClasses?: number
}

export interface PlotsPanelGroups {
  readonly setOptions: readonly PlotSetOption[]
  readonly setId: string | null
  readonly setLabel: string | null
  readonly setKind: PlotSetKind | null
  // The selection first, then the set's shown classes.
  readonly groups: readonly PlotGroup[]
  readonly hiddenClassCount: number
  // Shown classes past the limit.
  readonly omittedClassCount: number
  readonly genes: readonly string[]
  readonly omittedGeneCount: number
  readonly selectionHitCellLimit: boolean
  // What the set's groups are: classes, or saved selections.
  readonly groupNoun: 'class' | 'selection'
  // Selections whose cells are still being looked up; the groups wait.
  readonly pendingSelectionCount: number
  // Selections that stopped at the cell limit, and those that failed.
  readonly limitedSelections: readonly string[]
  readonly selectionErrors: readonly string[]
  // A dataset set Plots is reading, or why it could not.
  readonly pendingDatasetSet: boolean
  readonly datasetSetError: string | null
}

export function plotsPanelGroups({
  annotations,
  visibleClasses,
  setId: chosenSetId,
  selection,
  savedSelections = [],
  datasetSets = [],
  datasetSet = null,
  selectedGenes,
  maxClasses = DOT_PLOT_MAX_CLASSES,
}: PlotsPanelInput): PlotsPanelGroups {
  const sources: PlotSetSources = {
    annotations,
    savedSelectionCount: savedSelections.length,
    datasetSets,
    datasetSet,
  }
  const setOptions = plotSetOptions(sources)
  const setId = resolvePlotSetId(sources, chosenSetId)
  const option = setOptions.find((candidate) => candidate.id === setId)
  const genes = uniqueGenes(selectedGenes)
  const base = {
    setOptions,
    setId,
    setLabel: option?.label ?? null,
    setKind: option?.kind ?? null,
    genes: genes.slice(0, PLOT_MAX_GENES),
    omittedGeneCount: Math.max(0, genes.length - PLOT_MAX_GENES),
    pendingSelectionCount: 0,
    limitedSelections: [],
    selectionErrors: [],
    pendingDatasetSet: false,
    datasetSetError: null,
  }

  if (setId === SELECTIONS_SET_ID) {
    return { ...base, ...selectionsPanelGroups(savedSelections, maxClasses) }
  }

  const groupId = datasetSetGroupId(setId)

  if (groupId !== null) {
    const state =
      datasetSet?.groupId === groupId
        ? datasetSet
        : { groupId, status: 'loading' as const }
    const classes = state.status === 'ready' ? state.annotations : []
    const kept = classes.slice(0, maxClasses)

    return {
      ...base,
      groups: [
        ...selectionGroups(selection),
        ...classGroups(kept, (id) =>
          state.status === 'ready' ? state.colors[id] : undefined,
        ),
      ],
      hiddenClassCount: 0,
      omittedClassCount: classes.length - kept.length,
      selectionHitCellLimit: selection?.hitCellLimit === true,
      groupNoun: 'class',
      pendingDatasetSet: state.status === 'loading',
      datasetSetError: state.status === 'error' ? state.message : null,
    }
  }

  const setClasses = annotations.filter(
    (annotation) => annotationSetGrouping(annotation).id === setId,
  )
  const styleById = new Map(visibleClasses.map((style) => [style.id, style]))
  const shown = setClasses.filter((annotation) => styleById.has(annotation.id))
  const kept = shown.slice(0, maxClasses)

  return {
    ...base,
    groups: [
      ...selectionGroups(selection),
      ...classGroups(kept, (id) => styleById.get(id)?.color),
    ],
    hiddenClassCount: setClasses.length - shown.length,
    omittedClassCount: shown.length - kept.length,
    selectionHitCellLimit: selection?.hitCellLimit === true,
    groupNoun: 'class',
  }
}

// The active selection, an extra group first that overlaps the classes.
function selectionGroups(selection: PlotsSelectionInput | null): readonly PlotGroup[] {
  return selection === null
    ? []
    : [
        {
          id: 'selection',
          label: selection.name,
          color: selection.color,
          kind: 'selection',
          cellIds: selection.cellIds,
        },
      ]
}

function classGroups(
  classes: readonly Annotation<string>[],
  colorOf: (id: string) => string | undefined,
): readonly PlotGroup[] {
  return classes.map((annotation) => ({
    id: annotation.id,
    label: annotationSetGrouping(annotation).rowLabel,
    color: colorOf(annotation.id) ?? '#888888',
    kind: 'class',
    cellIds: annotation.cellIds,
  }))
}

// Each shown saved selection is a group, in the list's order. A cell in two
// selections counts in both. Nothing is grouped until every shown selection's
// cells are known, so the plot is drawn once.
function selectionsPanelGroups(
  savedSelections: readonly PlotSavedSelection[],
  maxClasses: number,
): Pick<
  PlotsPanelGroups,
  | 'groups'
  | 'hiddenClassCount'
  | 'omittedClassCount'
  | 'selectionHitCellLimit'
  | 'groupNoun'
  | 'pendingSelectionCount'
  | 'limitedSelections'
  | 'selectionErrors'
> {
  const shown = savedSelections.filter((saved) => saved.visible)
  const pendingSelectionCount = shown.filter(
    (saved) => saved.cells.status === 'loading',
  ).length
  const ready = shown.flatMap((saved) =>
    saved.cells.status === 'ready' ? [{ saved, cells: saved.cells }] : [],
  )
  const kept = pendingSelectionCount > 0 ? [] : ready.slice(0, maxClasses)

  return {
    groups: kept.map(({ saved, cells }) => ({
      id: `selection:${saved.id}`,
      label: saved.name,
      color: saved.color,
      kind: 'class' as const,
      cellIds: cells.cellIds,
    })),
    hiddenClassCount: savedSelections.length - shown.length,
    omittedClassCount: pendingSelectionCount > 0 ? 0 : ready.length - kept.length,
    selectionHitCellLimit: false,
    groupNoun: 'selection',
    pendingSelectionCount,
    limitedSelections: kept.flatMap(({ saved, cells }) =>
      cells.hitCellLimit ? [saved.name] : [],
    ),
    selectionErrors: shown.flatMap((saved) =>
      saved.cells.status === 'error' ? [`${saved.name}: ${saved.cells.message}`] : [],
    ),
  }
}

// The set Group by shows: the chosen one while it is listed, else the
// dataset's loaded set, else the saved selections, else a dataset set read
// for the plot.
export function resolvePlotSetId(
  sources: PlotSetSources,
  chosenSetId: string | null,
): string | null {
  const options = plotSetOptions(sources)
  const listed = (id: string | null | undefined) =>
    id !== null && id !== undefined && options.some((option) => option.id === id)

  if (listed(chosenSetId)) return chosenSetId

  // A set Plots read alone and Clusters has since loaded: the loaded set.
  const { datasetSet } = sources
  const loadedFromChoice =
    datasetSet?.status === 'ready' &&
    datasetSet.groupId === datasetSetGroupId(chosenSetId) &&
    datasetSet.annotations[0] !== undefined
      ? annotationSetGrouping(datasetSet.annotations[0]).id
      : null
  if (listed(loadedFromChoice)) return loadedFromChoice

  const fallback = defaultDatasetSet(sources.datasetSets)

  return (
    defaultPlotSetId(sources.annotations) ??
    (sources.savedSelectionCount > 0 ? SELECTIONS_SET_ID : null) ??
    (fallback === undefined ? null : datasetSetOptionId(fallback.groupId))
  )
}

// graphclust, as Clusters picks for Xenium, else the first set that groups
// the cells into a dot plot's worth of classes: one class compares nothing,
// and thousands are a column of cell IDs.
function defaultDatasetSet(sets: readonly PlotDatasetSet[]): PlotDatasetSet | undefined {
  return (
    sets.find((set) => set.label === 'graphclust') ??
    sets.find((set) => set.classCount >= 2 && set.classCount <= DOT_PLOT_MAX_CLASSES) ??
    sets.find((set) => set.classCount >= 2) ??
    sets[0]
  )
}

// The sets as the Clusters lists group them: the dataset's set, each
// imported file's sets, and selections kept with Save ROI together; then
// the dataset's other sets; then the saved selections, when there are any.
export function plotSetOptions(sources: PlotSetSources): readonly PlotSetOption[] {
  const options = new Map<string, { label: string; classCount: number }>()

  for (const annotation of sources.annotations) {
    const { id, label } = annotationSetGrouping(annotation)
    const option = options.get(id) ?? { label, classCount: 0 }
    option.classCount += 1
    options.set(id, option)
  }

  return [
    ...[...options].map(([id, option]) => ({ id, ...option, kind: 'loaded' as const })),
    ...sources.datasetSets.map((set) => ({
      id: datasetSetOptionId(set.groupId),
      label: set.label,
      classCount: set.classCount,
      kind: 'dataset' as const,
    })),
    ...(sources.savedSelectionCount === 0
      ? []
      : [
          {
            id: SELECTIONS_SET_ID,
            label: SELECTIONS_SET_LABEL,
            classCount: sources.savedSelectionCount,
            kind: 'selections' as const,
          },
        ]),
  ]
}

// The dataset's own set: the first with a class that is not a saved
// selection or query, since Save ROI and Save As Class put theirs first.
export function defaultPlotSetId(
  annotations: readonly Annotation<string>[],
): string | null {
  const annotation =
    annotations.find(
      (candidate) =>
        !candidate.id.startsWith('roi:') && !candidate.id.startsWith('query:'),
    ) ?? annotations[0]
  return annotation === undefined ? null : annotationSetGrouping(annotation).id
}

export function plotGroupsInput(groups: readonly PlotGroup[]): PlotGroupsInput {
  return {
    selection: groups.find((group) => group.kind === 'selection')?.cellIds ?? null,
    classes: groups
      .filter((group) => group.kind === 'class')
      .map((group) => group.cellIds),
  }
}

function uniqueGenes(genes: readonly string[]): readonly string[] {
  return [...new Set(genes)]
}

// The read budget (22-D7). Reads up to the prompt size start at once; larger
// ones wait for Read, and over the limit, the size of the cell profile
// budget for dense Zarr, the panel reads nothing.
export const PLOT_READ_PROMPT_BYTES = 32 * 1024 * 1024
export const PLOT_READ_MAX_BYTES = 256 * 1024 * 1024

export type PlotReadDecision = 'read' | 'ask' | 'refuse'

// `approvedBytes` is the largest read Read has allowed for the dataset: a
// CSR matrix costs the same for every gene, so asking again for each gene
// added would ask the same question.
export function plotReadDecision(bytes: number, approvedBytes: number): PlotReadDecision {
  if (bytes > PLOT_READ_MAX_BYTES) return 'refuse'
  return bytes > PLOT_READ_PROMPT_BYTES && bytes > approvedBytes ? 'ask' : 'read'
}

// Sizes as the budget is set, in binary units.
export function formatReadSize(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024)

  if (mebibytes >= 1024) return `${(mebibytes / 1024).toFixed(1)} GiB`
  if (mebibytes >= 10) return `${Math.round(mebibytes).toLocaleString()} MiB`
  return mebibytes < 0.1 ? 'under 0.1 MiB' : `${mebibytes.toFixed(1)} MiB`
}

// "Gad1", "Gad1 and Sst", or "3 genes".
export function plotGenesPhrase(genes: readonly string[]): string {
  if (genes.length === 1) return genes[0] ?? '1 gene'
  if (genes.length === 2) return `${genes[0] ?? ''} and ${genes[1] ?? ''}`
  return `${genes.length.toLocaleString()} genes`
}
