import { ALL_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import {
  normalizeAnnotationColor,
  unusedAnnotationPaletteColors,
} from '../../rendering/annotationPalette'
import { formatCsv } from '../../utils/csv'
import { slug } from '../../utils/slug'
import type { Annotation, AnnotationGroupOption } from '../../data/annotation'

export type AnnotationState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly annotations: readonly Annotation[]
      // The dataset's own annotation set that was loaded, which share links
      // carry as groups= (15.1-L). Imported annotations add to it.
      readonly groupId?: string
    }
  | { readonly status: 'error'; readonly url: string; readonly error: ErrorType }

export type AnnotationGroupState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly groups: readonly AnnotationGroupOption[]
    }
  | { readonly status: 'error'; readonly url: string; readonly error: ErrorType }

export const IDLE_ANNOTATION_STATE: AnnotationState<never> = { status: 'idle' }
export const IDLE_ANNOTATION_GROUP_STATE: AnnotationGroupState<never> = {
  status: 'idle',
}

export function annotationLoadStarted(url: string): AnnotationState<never> {
  return { status: 'loading', url }
}

export function annotationLoadReady(
  url: string,
  annotations: readonly Annotation[],
  groupId?: string,
): AnnotationState<never> {
  return groupId === undefined
    ? { status: 'ready', url, annotations }
    : { status: 'ready', url, annotations, groupId }
}

export function annotationLoadFailed<ErrorType>(
  url: string,
  error: ErrorType,
): AnnotationState<ErrorType> {
  return { status: 'error', url, error }
}

export function annotationGroupLoadStarted(url: string): AnnotationGroupState<never> {
  return { status: 'loading', url }
}

export function annotationGroupLoadReady(
  url: string,
  groups: readonly AnnotationGroupOption[],
): AnnotationGroupState<never> {
  return { status: 'ready', url, groups }
}

export function annotationGroupLoadFailed<ErrorType>(
  url: string,
  error: ErrorType,
): AnnotationGroupState<ErrorType> {
  return { status: 'error', url, error }
}

export interface AnnotationSizeRow {
  readonly id: string
  readonly label: string
  readonly cellCount: number
  readonly fraction: number
}

export interface AnnotationSizePlot {
  readonly id: string
  readonly label: string
  readonly totalCellAssignments: number
  readonly maxCellCount: number
  readonly rows: readonly AnnotationSizeRow[]
}

export function annotationStatusCopy<ErrorType>(
  annotationState: AnnotationState<ErrorType>,
): string {
  if (annotationState.status === 'loading') {
    return 'Loading'
  }

  if (annotationState.status === 'ready') {
    const noun = annotationState.annotations.length === 1 ? 'label' : 'labels'
    return `${annotationState.annotations.length.toLocaleString()} ${noun}`
  }

  if (annotationState.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

export function annotationLabelsForCell<ErrorType>(
  annotationState: AnnotationState<ErrorType>,
  cellId: string,
): readonly string[] {
  if (annotationState.status !== 'ready') {
    return []
  }

  const labels: string[] = []

  for (const annotation of annotationState.annotations) {
    if (annotation.cellIds.some((candidateCellId) => candidateCellId === cellId)) {
      labels.push(annotation.label)
    }
  }

  return labels
}

export function annotationsToCsv(annotations: readonly Annotation[]): string {
  const rows = [
    ['annotation_id', 'label', 'cell_id'],
    ...annotations.flatMap((annotation) =>
      annotation.cellIds.map((cellId) => [annotation.id, annotation.label, cellId]),
    ),
  ]

  return formatCsv(rows)
}

export function filterAnnotationsByVisibleSets(
  annotations: readonly Annotation[],
  hiddenSetIds: ReadonlySet<string>,
): readonly Annotation[] {
  if (hiddenSetIds.size === 0) {
    return annotations
  }

  return annotations.filter(
    (annotation) => !hiddenSetIds.has(annotationSetIdForAnnotation(annotation)),
  )
}

export function filterAnnotationsByVisibleClasses(
  annotations: readonly Annotation[],
  hiddenAnnotationIds: ReadonlySet<string>,
): readonly Annotation[] {
  if (hiddenAnnotationIds.size === 0) {
    return annotations
  }

  return annotations.filter((annotation) => !hiddenAnnotationIds.has(annotation.id))
}

export function annotationSetIdForAnnotation(annotation: Annotation): string {
  return annotationSizeGrouping(annotation).id
}

// A link's hidden classes, written the short way per set: a set with more
// classes hidden than shown lists the shown ones (`shownClasses=`) instead,
// so "only this class" in a 150-class set is one ID, not 149. Hidden IDs that
// are not loaded, such as a link's own before its set loads, are kept.
export function compactHiddenAnnotationIds(
  annotations: readonly Annotation[],
  hiddenIds: readonly string[],
): { readonly hidden: readonly string[]; readonly shown: readonly string[] } {
  if (hiddenIds.length === 0) {
    return { hidden: hiddenIds, shown: [] }
  }

  const hiddenSet = new Set(hiddenIds)
  const classesBySet = new Map<string, Annotation[]>()

  for (const annotation of annotations) {
    const setId = annotationSetIdForAnnotation(annotation)
    const classes = classesBySet.get(setId)

    if (classes === undefined) {
      classesBySet.set(setId, [annotation])
    } else {
      classes.push(annotation)
    }
  }

  const listedByShown = new Set<string>()
  const shown: string[] = []

  for (const classes of classesBySet.values()) {
    const shownClasses = classes.filter((annotation) => !hiddenSet.has(annotation.id))

    if (
      shownClasses.length > 0 &&
      shownClasses.length < classes.length - shownClasses.length
    ) {
      shown.push(...shownClasses.map((annotation) => annotation.id))
      for (const annotation of classes) {
        listedByShown.add(annotation.id)
      }
    }
  }

  return {
    hidden: hiddenIds.filter((id) => !listedByShown.has(id)),
    shown,
  }
}

// The loaded classes a link hides: those `hiddenIds` names, and every other
// class of a set `shownIds` lists classes of.
export function annotationIdsHiddenByLink(
  annotations: readonly Annotation[],
  hiddenIds: readonly string[],
  shownIds: readonly string[],
): readonly string[] {
  if (hiddenIds.length === 0 && shownIds.length === 0) {
    return []
  }

  const hiddenSet = new Set(hiddenIds)
  const shownSet = new Set(shownIds)
  const shownSetIds = new Set(
    annotations
      .filter((annotation) => shownSet.has(annotation.id))
      .map(annotationSetIdForAnnotation),
  )

  return annotations
    .filter(
      (annotation) =>
        hiddenSet.has(annotation.id) ||
        (!shownSet.has(annotation.id) &&
          shownSetIds.has(annotationSetIdForAnnotation(annotation))),
    )
    .map((annotation) => annotation.id)
}

// The set a class belongs to, as the Clusters lists show it: its id and
// name, and the class's name within it.
export function annotationSetGrouping(annotation: Pick<Annotation, 'id' | 'label'>): {
  readonly id: string
  readonly label: string
  readonly rowLabel: string
} {
  return annotationSizeGrouping(annotation)
}

// Cells that are on the map. Visium hides spots off the tissue, which then
// should not count towards a label's size.
export interface PlacedCellIds {
  has(cellId: string): boolean
}

export function placedAnnotationCellCount(
  annotation: Annotation,
  placedCellIds: PlacedCellIds | null,
): number {
  return placedCellIds === null
    ? annotation.cellIds.length
    : annotation.cellIds.reduce(
        (count, cellId) => (placedCellIds.has(cellId) ? count + 1 : count),
        0,
      )
}

export function annotationSizePlots(
  annotations: readonly Annotation[],
  placedCellIds: PlacedCellIds | null = null,
): readonly AnnotationSizePlot[] {
  const groups = new Map<
    string,
    {
      readonly label: string
      rows: AnnotationSizeRow[]
      totalCellAssignments: number
      maxCellCount: number
    }
  >()

  for (const annotation of annotations) {
    const grouping = annotationSizeGrouping(annotation)
    const current = groups.get(grouping.id) ?? {
      label: grouping.label,
      rows: [],
      totalCellAssignments: 0,
      maxCellCount: 0,
    }
    const cellCount = placedAnnotationCellCount(annotation, placedCellIds)

    current.rows.push({
      id: annotation.id,
      label: grouping.rowLabel,
      cellCount,
      fraction: 0,
    })
    current.totalCellAssignments += cellCount
    current.maxCellCount = Math.max(current.maxCellCount, cellCount)
    groups.set(grouping.id, current)
  }

  return [...groups.entries()].map(([id, group]) => ({
    id,
    label: group.label,
    totalCellAssignments: group.totalCellAssignments,
    maxCellCount: group.maxCellCount,
    rows: group.rows
      .map((row) => ({
        ...row,
        fraction:
          group.totalCellAssignments === 0
            ? 0
            : row.cellCount / group.totalCellAssignments,
      }))
      .sort((left, right) => {
        const countDelta = right.cellCount - left.cellCount
        return countDelta === 0 ? left.label.localeCompare(right.label) : countDelta
      }),
  }))
}

export function hasReadyAnnotationsAfterRemove(
  annotationState: AnnotationState,
  annotationId: string,
): boolean {
  return (
    annotationState.status === 'ready' &&
    annotationState.annotations.some((annotation) => annotation.id !== annotationId)
  )
}

export function mergeImportedAnnotations(
  currentAnnotations: readonly Annotation[],
  importedAnnotations: readonly Annotation[],
  importedPrefix: string,
): readonly Annotation[] {
  return [
    ...currentAnnotations.filter(
      (annotation) => !annotation.id.startsWith(importedPrefix),
    ),
    ...importedAnnotations,
  ]
}

// New annotations take the colour their dataset stores, else the first
// palette colour no other class has; colours already set, including the
// user's, are kept.
export function colorsForAnnotations(
  annotations: readonly Pick<Annotation, 'id' | 'color'>[],
  currentColors: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const nextColors: Record<string, string> = { ...currentColors }
  const storedColor = (annotation: Pick<Annotation, 'color'>) =>
    annotation.color === undefined ? null : normalizeAnnotationColor(annotation.color)
  const nextPaletteColor = unusedAnnotationPaletteColors(
    [
      ...Object.values(currentColors),
      ...annotations.flatMap((annotation) => storedColor(annotation) ?? []),
    ],
    Object.keys(currentColors).length,
  )

  for (const annotation of annotations) {
    if (nextColors[annotation.id] !== undefined) {
      continue
    }

    nextColors[annotation.id] = storedColor(annotation) ?? nextPaletteColor()
  }

  return nextColors
}

// One new class's colour (Save ROI, Save As Class).
export function nextAnnotationColor(colors: Readonly<Record<string, string>>): string {
  return unusedAnnotationPaletteColors(
    Object.values(colors),
    Object.keys(colors).length,
  )()
}

export function removeAnnotationColor(
  colors: Readonly<Record<string, string>>,
  annotationId: string,
): Readonly<Record<string, string>> {
  const remainingColors: Record<string, string> = {}

  for (const [candidateId, color] of Object.entries(colors)) {
    if (candidateId !== annotationId) {
      remainingColors[candidateId] = color
    }
  }

  return remainingColors
}

export function removeAnnotationColorsByPrefix(
  colors: Readonly<Record<string, string>>,
  prefix: string,
): Readonly<Record<string, string>> {
  const remainingColors: Record<string, string> = {}

  for (const [annotationId, color] of Object.entries(colors)) {
    if (!annotationId.startsWith(prefix)) {
      remainingColors[annotationId] = color
    }
  }

  return remainingColors
}

export function removeHiddenAnnotationIdsByPrefix(
  annotationIds: readonly string[],
  prefix: string,
): readonly string[] {
  return annotationIds.filter((annotationId) => !annotationId.startsWith(prefix))
}

export function customAnnotationFilePrefix(fileName: string): string {
  return `custom:${slug(fileName)}:`
}

// The name an imported file's class and track IDs are made from. Names that
// slug alike, such as `My Labels.csv` and `my_labels.csv` or names in another
// script, would share a prefix, and an import replaces the labels under its
// prefix; a later name is numbered instead (`my_labels.csv 2`). A name
// imported before keeps its prefix, so importing it again replaces its
// labels. `imported` maps each prefix's slug to the file name that has it.
export function importedFileIdName(
  fileName: string,
  imported: ReadonlyMap<string, string>,
): string {
  for (let number = 1; ; number += 1) {
    const idName = number === 1 ? fileName : `${fileName} ${number.toString()}`
    const owner = imported.get(slug(idName))

    if (owner === undefined || owner === fileName) return idName
  }
}

function annotationSizeGrouping(annotation: Pick<Annotation, 'id' | 'label'>): {
  readonly id: string
  readonly label: string
  readonly rowLabel: string
} {
  if (annotation.id.startsWith('analysis:')) {
    const match = /^([^:]+):\s*(.+)$/.exec(annotation.label)

    if (match !== null) {
      const label = match[1]?.trim() ?? ''
      const rowLabel = match[2]?.trim() ?? ''

      if (label !== '' && rowLabel !== '') {
        return {
          id: `analysis:${slug(label)}`,
          label,
          rowLabel,
        }
      }
    }
  }

  if (annotation.id.startsWith('custom:')) {
    const idMatch = /^custom:([^:]+):([^:]+):/.exec(annotation.id)
    const labelMatch = /^([^:]+):\s*(.+)$/.exec(annotation.label)

    if (idMatch !== null && labelMatch !== null) {
      const fileSlug = idMatch[1]?.trim() ?? ''
      const setSlug = idMatch[2]?.trim() ?? ''
      const label = labelMatch[1]?.trim() ?? ''
      const rowLabel = labelMatch[2]?.trim() ?? ''

      if (fileSlug !== '' && setSlug !== '' && label !== '' && rowLabel !== '') {
        return {
          id: `custom:${fileSlug}:${setSlug}`,
          label,
          rowLabel,
        }
      }
    }
  }

  // Cell Query's saved classes (plan 23-D7) are a set of their own.
  if (annotation.id.startsWith('query:')) {
    return { id: QUERY_ANNOTATION_SET_ID, label: 'Queries', rowLabel: annotation.label }
  }

  return {
    id: 'loaded-annotations',
    label: 'Loaded annotations',
    rowLabel: annotation.label,
  }
}

export const QUERY_ANNOTATION_SET_ID = 'queries'

// More categories than this, and a column labels cells rather than grouping
// them.
const ID_LIKE_CATEGORY_LIMIT = 500

// H5AD and SpatialData columns that identify cells or ontology terms rather
// than group them (15.1-I). They are listed apart, under "More columns".
export function isIdLikeAnnotationGroup(group: AnnotationGroupOption): boolean {
  const label = group.label.toLowerCase()
  return (
    label.endsWith('_ontology_term_id') ||
    label === 'observation_joinid' ||
    group.groupCount > ID_LIKE_CATEGORY_LIMIT
  )
}

// The set chosen when a dataset's sets are listed: Xenium's graphclust, or
// the first set. "All" stacked every clustering and was a poor default.
export function defaultAnnotationGroupId(
  groups: readonly AnnotationGroupOption[],
): string | undefined {
  return (groups.find((group) => group.label === 'graphclust') ?? groups[0])?.id
}

// The first set a link's groups= names that the dataset lists (15.1-L).
export function linkAnnotationGroupId(
  groupIds: readonly string[],
  groups: readonly AnnotationGroupOption[],
): string | undefined {
  return groupIds.find(
    (id) => id === ALL_ANNOTATION_GROUP_ID || groups.some((group) => group.id === id),
  )
}
