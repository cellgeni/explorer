import { useCallback, useEffect, useRef } from 'react'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type { AnnotationState } from '../annotations/annotationModel'
import type { GeometricAnnotationFeature } from '../annotations/geometricAnnotationModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { AppendDebugEvent } from './appRuntimeModel'
import type { UndoOffer } from './useUndoToast'

// The removals that offer Undo (UNIFIED_PLAN.md, 15.3-C): removing a
// class, a metadata track or every annotation, removing a shape or clearing
// them all. Deleting a selection offers its own (useSelectionList, 15.4-A). Each takes a snapshot first, and
// Undo puts it back only if nothing it covers has changed since, so Undo
// never throws away later work.

// Everything a class or annotation removal can change.
export interface AnnotationSnapshot {
  readonly annotationState: AnnotationState<StructuredLoadError>
  readonly annotationColors: Readonly<Record<string, string>>
  readonly hiddenAnnotationIds: readonly string[]
  readonly hiddenAnnotationSetIds: readonly string[]
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly selectedCellMetadataTrackId: string | null
  readonly observationColorMode: ObservationColorMode
}

export interface UndoableRemovalsInput {
  readonly offerUndo: (offer: UndoOffer) => void
  readonly appendDebugEvent: AppendDebugEvent
  readonly annotations: AnnotationSnapshot & {
    readonly restore: (snapshot: AnnotationSnapshot) => void
    readonly onRemove: (annotationId: string) => void
    readonly onRemoveTrack: (trackId: string) => void
    readonly onClear: () => void
  }
  readonly shapes: {
    readonly shapes: readonly GeometricAnnotationFeature[]
    readonly restore: (shapes: readonly GeometricAnnotationFeature[]) => void
    readonly onRemove: (annotationId: string) => void
    readonly onClear: () => void
  }
}

export interface UndoableRemovals {
  readonly handleRemoveAnnotation: (annotationId: string) => void
  readonly handleRemoveCellMetadataTrack: (trackId: string) => void
  readonly handleClearAnnotations: () => void
  readonly handleRemoveShape: (annotationId: string) => void
  readonly handleClearShapes: () => void
}

// Counts the commits in which any of `values` changed. A removal expects
// exactly one more (its own); any other means later work it must not undo.
function useCommitCount(values: readonly unknown[]): { readonly current: number } {
  const count = useRef(0)
  useEffect(() => {
    count.current += 1
    // The values are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, values)
  return count
}

export function useUndoableRemovals({
  offerUndo,
  appendDebugEvent,
  annotations,
  shapes,
}: UndoableRemovalsInput): UndoableRemovals {
  const {
    annotationState,
    annotationColors,
    hiddenAnnotationIds,
    hiddenAnnotationSetIds,
    cellMetadataTracks,
    selectedCellMetadataTrackId,
    observationColorMode,
    restore: restoreAnnotations,
    onRemove: removeAnnotation,
    onRemoveTrack: removeTrack,
    onClear: clearAnnotations,
  } = annotations
  const annotationCommits = useCommitCount([
    annotationState,
    annotationColors,
    hiddenAnnotationIds,
    hiddenAnnotationSetIds,
    cellMetadataTracks,
    selectedCellMetadataTrackId,
    observationColorMode,
  ])
  const shapeCommits = useCommitCount([shapes.shapes])

  const offerAnnotationUndo = useCallback(
    (message: string, remove: () => void) => {
      const snapshot: AnnotationSnapshot = {
        annotationState,
        annotationColors,
        hiddenAnnotationIds,
        hiddenAnnotationSetIds,
        cellMetadataTracks,
        selectedCellMetadataTrackId,
        observationColorMode,
      }
      const expectedCommits = annotationCommits.current + 1
      remove()
      offerUndo({
        message,
        undo: () => {
          if (annotationCommits.current !== expectedCommits) {
            appendDebugEvent(`Not undone: annotations changed since (${message})`)
            return
          }
          restoreAnnotations(snapshot)
          appendDebugEvent(`Undone: ${message}`)
        },
      })
    },
    [
      annotationCommits,
      annotationColors,
      annotationState,
      appendDebugEvent,
      cellMetadataTracks,
      hiddenAnnotationIds,
      hiddenAnnotationSetIds,
      observationColorMode,
      offerUndo,
      restoreAnnotations,
      selectedCellMetadataTrackId,
    ],
  )

  const handleRemoveAnnotation = useCallback(
    (annotationId: string) => {
      const label =
        annotationState.status === 'ready'
          ? annotationState.annotations.find(
              (annotation) => annotation.id === annotationId,
            )?.label
          : undefined
      offerAnnotationUndo(`Removed ${label ?? 'the class'}`, () => {
        removeAnnotation(annotationId)
      })
    },
    [annotationState, offerAnnotationUndo, removeAnnotation],
  )
  const handleRemoveCellMetadataTrack = useCallback(
    (trackId: string) => {
      const label = cellMetadataTracks.find((track) => track.id === trackId)?.label
      offerAnnotationUndo(`Removed ${label ?? 'the metadata track'}`, () => {
        removeTrack(trackId)
      })
    },
    [cellMetadataTracks, offerAnnotationUndo, removeTrack],
  )
  const handleClearAnnotations = useCallback(() => {
    offerAnnotationUndo('Cleared annotations', clearAnnotations)
  }, [clearAnnotations, offerAnnotationUndo])

  const { shapes: currentShapes, restore: restoreShapes } = shapes
  const offerShapeUndo = useCallback(
    (message: string, remove: () => void) => {
      const snapshot = currentShapes
      const expectedCommits = shapeCommits.current + 1
      remove()
      offerUndo({
        message,
        undo: () => {
          if (shapeCommits.current !== expectedCommits) {
            appendDebugEvent(`Not undone: shapes changed since (${message})`)
            return
          }
          restoreShapes(snapshot)
          appendDebugEvent(`Undone: ${message}`)
        },
      })
    },
    [appendDebugEvent, currentShapes, offerUndo, restoreShapes, shapeCommits],
  )
  const { onRemove: removeShape, onClear: clearShapes } = shapes
  const handleRemoveShape = useCallback(
    (annotationId: string) => {
      const label = currentShapes.find((shape) => shape.id === annotationId)?.label
      offerShapeUndo(`Removed ${label ?? 'the shape'}`, () => {
        removeShape(annotationId)
      })
    },
    [currentShapes, offerShapeUndo, removeShape],
  )
  const handleClearShapes = useCallback(() => {
    if (currentShapes.length === 0) return
    offerShapeUndo(
      `Cleared ${currentShapes.length.toLocaleString()} ${
        currentShapes.length === 1 ? 'shape' : 'shapes'
      }`,
      clearShapes,
    )
  }, [clearShapes, currentShapes.length, offerShapeUndo])

  return {
    handleRemoveAnnotation,
    handleRemoveCellMetadataTrack,
    handleClearAnnotations,
    handleRemoveShape,
    handleClearShapes,
  }
}
