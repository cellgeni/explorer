import type { Annotation } from '../../datasets/spatialDataset'
import type { AnnotationColorStyle } from '../../rendering/cellStyling'
import { annotationSetGrouping } from '../annotations/annotationModel'
import type { PlotGroupsInput } from './plotStats'

// What the Plots panel plots (plan 22-D1 to 22-D3): the selected genes,
// grouped by the classes of one annotation set, with the active selection
// as an extra group first.

// The Xenium reader's limit, kept for every platform (22-D1).
export const PLOT_MAX_GENES = 32
// Classes a dot plot shows (22-D2).
export const DOT_PLOT_MAX_CLASSES = 60

export interface PlotSetOption {
  readonly id: string
  readonly label: string
  readonly classCount: number
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

export interface PlotsPanelInput {
  // Every loaded class, shown or hidden, in the legend's order.
  readonly annotations: readonly Annotation<string>[]
  // The shown classes with the legend's colours.
  readonly visibleClasses: readonly Pick<AnnotationColorStyle, 'id' | 'color'>[]
  // The set chosen in Group by, or null for the default.
  readonly setId: string | null
  readonly selection: PlotsSelectionInput | null
  readonly selectedGenes: readonly string[]
  readonly maxClasses?: number
}

export interface PlotsPanelGroups {
  readonly setOptions: readonly PlotSetOption[]
  readonly setId: string | null
  readonly setLabel: string | null
  // The selection first, then the set's shown classes.
  readonly groups: readonly PlotGroup[]
  readonly hiddenClassCount: number
  // Shown classes past the limit.
  readonly omittedClassCount: number
  readonly genes: readonly string[]
  readonly omittedGeneCount: number
  readonly selectionHitCellLimit: boolean
}

export function plotsPanelGroups({
  annotations,
  visibleClasses,
  setId: chosenSetId,
  selection,
  selectedGenes,
  maxClasses = DOT_PLOT_MAX_CLASSES,
}: PlotsPanelInput): PlotsPanelGroups {
  const setOptions = plotSetOptions(annotations)
  const setId =
    setOptions.find((option) => option.id === chosenSetId)?.id ??
    defaultPlotSetId(annotations)
  const setLabel = setOptions.find((option) => option.id === setId)?.label ?? null
  const setClasses = annotations.filter(
    (annotation) => annotationSetGrouping(annotation).id === setId,
  )
  const styleById = new Map(visibleClasses.map((style) => [style.id, style]))
  const shown = setClasses.filter((annotation) => styleById.has(annotation.id))
  const kept = shown.slice(0, maxClasses)
  const genes = uniqueGenes(selectedGenes)

  return {
    setOptions,
    setId,
    setLabel,
    groups: [
      ...(selection === null
        ? []
        : [
            {
              id: 'selection',
              label: selection.name,
              color: selection.color,
              kind: 'selection' as const,
              cellIds: selection.cellIds,
            },
          ]),
      ...kept.map((annotation) => ({
        id: annotation.id,
        label: annotationSetGrouping(annotation).rowLabel,
        color: styleById.get(annotation.id)?.color ?? '#888888',
        kind: 'class' as const,
        cellIds: annotation.cellIds,
      })),
    ],
    hiddenClassCount: setClasses.length - shown.length,
    omittedClassCount: shown.length - kept.length,
    genes: genes.slice(0, PLOT_MAX_GENES),
    omittedGeneCount: Math.max(0, genes.length - PLOT_MAX_GENES),
    selectionHitCellLimit: selection?.hitCellLimit === true,
  }
}

// The sets as the Clusters lists group them: the dataset's set, each
// imported file's sets, and saved selections together.
export function plotSetOptions(
  annotations: readonly Annotation<string>[],
): readonly PlotSetOption[] {
  const options = new Map<string, { label: string; classCount: number }>()

  for (const annotation of annotations) {
    const { id, label } = annotationSetGrouping(annotation)
    const option = options.get(id) ?? { label, classCount: 0 }
    option.classCount += 1
    options.set(id, option)
  }

  return [...options].map(([id, option]) => ({ id, ...option }))
}

// The dataset's own set: the first with a class that is not a saved
// selection, since Save ROI puts its class first.
export function defaultPlotSetId(
  annotations: readonly Annotation<string>[],
): string | null {
  const annotation =
    annotations.find((candidate) => !candidate.id.startsWith('roi:')) ?? annotations[0]
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
