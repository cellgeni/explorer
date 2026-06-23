import type { AnnotationGroupOption } from '../../data/datasetAnnotations'
import type { Annotation } from '../../datasets/spatialDataset'
import { annotationPaletteColor } from '../../rendering/annotationPalette'
import { slug } from '../../utils/slug'

export type AnnotationState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly annotations: readonly Annotation[]
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

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
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

export function annotationSetIdForAnnotation(annotation: Annotation): string {
  return annotationSizeGrouping(annotation).id
}

export function annotationSizePlots(
  annotations: readonly Annotation[],
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
    const cellCount = annotation.cellIds.length

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

export function colorsForAnnotations(
  annotations: readonly Annotation[],
  currentColors: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const nextColors: Record<string, string> = { ...currentColors }
  let colorIndex = Object.keys(nextColors).length

  for (const annotation of annotations) {
    if (nextColors[annotation.id] !== undefined) {
      continue
    }

    nextColors[annotation.id] = annotationPaletteColor(colorIndex)
    colorIndex += 1
  }

  return nextColors
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

export function customAnnotationFilePrefix(fileName: string): string {
  return `custom:${slug(fileName)}:`
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }

  return value
}

function annotationSizeGrouping(annotation: Annotation): {
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

  return {
    id: 'loaded-annotations',
    label: 'Loaded annotations',
    rowLabel: annotation.label,
  }
}
