import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type { GeometricAnnotationFeature } from '../annotations/geometricAnnotationModel'
import type { AnnotationState } from '../annotations/annotationModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import {
  useUndoableRemovals,
  type AnnotationSnapshot,
  type UndoableRemovals,
} from './useUndoableRemovals'
import type { UndoOffer } from './useUndoToast'

const READY_ANNOTATIONS: AnnotationState<StructuredLoadError> = {
  status: 'ready',
  url: 'https://example.test/output',
  annotations: [
    { id: 'graphclust:1', label: 'graphclust: Cluster 1', cellIds: [] },
    { id: 'graphclust:2', label: 'graphclust: Cluster 2', cellIds: [] },
  ],
}

const SHAPE: GeometricAnnotationFeature = {
  id: 'geometry:1:tumour',
  label: 'Tumour',
  color: '#ff0000',
  visible: true,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        { x: micrometers(0), y: micrometers(0) },
        { x: micrometers(1), y: micrometers(0) },
        { x: micrometers(1), y: micrometers(1) },
        { x: micrometers(0), y: micrometers(0) },
      ],
    ],
  },
}

const BOX: RoiSelection = {
  kind: 'box',
  bbox: {
    minX: micrometers(0),
    minY: micrometers(0),
    maxX: micrometers(10),
    maxY: micrometers(10),
  },
}

// The removals with real state, as App holds it.
function useHarness() {
  const [annotationState, setAnnotationState] = useState(READY_ANNOTATIONS)
  const [annotationColors, setAnnotationColors] = useState<
    Readonly<Record<string, string>>
  >({ 'graphclust:2': '#00ff00' })
  const [hiddenAnnotationIds, setHiddenAnnotationIds] = useState<readonly string[]>([])
  const [hiddenAnnotationSetIds, setHiddenAnnotationSetIds] = useState<readonly string[]>(
    [],
  )
  const [cellMetadataTracks, setCellMetadataTracks] = useState<
    AnnotationSnapshot['cellMetadataTracks']
  >([])
  const [selectedCellMetadataTrackId, setSelectedCellMetadataTrackId] = useState<
    string | null
  >(null)
  const [observationColorMode, setObservationColorMode] =
    useState<ObservationColorMode>('annotations')
  const [shapes, setShapes] = useState<readonly GeometricAnnotationFeature[]>([SHAPE])
  const [selection, setSelection] = useState<RoiSelection | null>(BOX)
  const [name, setName] = useState('ROI 1')
  const [offer, setOffer] = useState<UndoOffer | null>(null)

  const removals: UndoableRemovals = useUndoableRemovals({
    offerUndo: setOffer,
    appendDebugEvent: vi.fn(),
    annotations: {
      annotationState,
      annotationColors,
      hiddenAnnotationIds,
      hiddenAnnotationSetIds,
      cellMetadataTracks,
      selectedCellMetadataTrackId,
      observationColorMode,
      restore: (snapshot) => {
        setAnnotationState(snapshot.annotationState)
        setAnnotationColors(snapshot.annotationColors)
        setHiddenAnnotationIds(snapshot.hiddenAnnotationIds)
        setHiddenAnnotationSetIds(snapshot.hiddenAnnotationSetIds)
        setCellMetadataTracks(snapshot.cellMetadataTracks)
        setSelectedCellMetadataTrackId(snapshot.selectedCellMetadataTrackId)
        setObservationColorMode(snapshot.observationColorMode)
      },
      onRemove: (annotationId) => {
        setAnnotationState((current) =>
          current.status === 'ready'
            ? {
                ...current,
                annotations: current.annotations.filter(
                  (annotation) => annotation.id !== annotationId,
                ),
              }
            : current,
        )
        setAnnotationColors({})
      },
      onRemoveTrack: vi.fn(),
      onClear: () => {
        setAnnotationState({ status: 'idle' })
        setObservationColorMode('transcript-count')
      },
    },
    shapes: {
      shapes,
      restore: setShapes,
      onRemove: (annotationId) => {
        setShapes((current) => current.filter((shape) => shape.id !== annotationId))
      },
      onClear: () => {
        setShapes([])
      },
    },
    selection: {
      selection,
      name,
      onClear: () => {
        setSelection(null)
      },
      restore: (restored, restoredName) => {
        setName(restoredName)
        setSelection(restored)
      },
    },
  })

  return {
    removals,
    offer,
    annotationState,
    annotationColors,
    observationColorMode,
    setAnnotationState,
    shapes,
    selection,
    setSelection,
    name,
    setName,
  }
}

function labels(state: AnnotationState<StructuredLoadError>): readonly string[] {
  return state.status === 'ready' ? state.annotations.map((a) => a.label) : []
}

describe('useUndoableRemovals', () => {
  it('puts back a removed class, with its colour', () => {
    const { result } = renderHook(useHarness)

    act(() => {
      result.current.removals.handleRemoveAnnotation('graphclust:2')
    })
    expect(result.current.offer?.message).toBe('Removed graphclust: Cluster 2')
    expect(labels(result.current.annotationState)).toEqual(['graphclust: Cluster 1'])

    act(() => {
      result.current.offer?.undo()
    })
    expect(labels(result.current.annotationState)).toEqual([
      'graphclust: Cluster 1',
      'graphclust: Cluster 2',
    ])
    expect(result.current.annotationColors).toEqual({ 'graphclust:2': '#00ff00' })
  })

  it('puts back cleared annotations and the colour mode', () => {
    const { result } = renderHook(useHarness)

    act(() => {
      result.current.removals.handleClearAnnotations()
    })
    expect(result.current.offer?.message).toBe('Cleared annotations')
    expect(result.current.observationColorMode).toBe('transcript-count')

    act(() => {
      result.current.offer?.undo()
    })
    expect(labels(result.current.annotationState)).toHaveLength(2)
    expect(result.current.observationColorMode).toBe('annotations')
  })

  it('does not undo over annotations that changed since', () => {
    const { result } = renderHook(useHarness)

    act(() => {
      result.current.removals.handleRemoveAnnotation('graphclust:2')
    })
    const later: AnnotationState<StructuredLoadError> = {
      status: 'ready',
      url: 'https://example.test/output',
      annotations: [{ id: 'kmeans:1', label: 'kmeans: Cluster 1', cellIds: [] }],
    }
    act(() => {
      result.current.setAnnotationState(later)
    })
    act(() => {
      result.current.offer?.undo()
    })

    expect(result.current.annotationState).toBe(later)
  })

  it('puts back a removed shape, or all of them', () => {
    const { result } = renderHook(useHarness)

    act(() => {
      result.current.removals.handleRemoveShape(SHAPE.id)
    })
    expect(result.current.offer?.message).toBe('Removed Tumour')
    act(() => {
      result.current.offer?.undo()
    })
    expect(result.current.shapes).toEqual([SHAPE])

    act(() => {
      result.current.removals.handleClearShapes()
    })
    expect(result.current.offer?.message).toBe('Cleared 1 shape')
    act(() => {
      result.current.offer?.undo()
    })
    expect(result.current.shapes).toEqual([SHAPE])
  })

  it('draws a cleared selection again under its name, unless one was drawn since', () => {
    const { result } = renderHook(useHarness)

    act(() => {
      result.current.removals.handleClearSelection()
      result.current.setName('ROI 2')
    })
    expect(result.current.offer?.message).toBe('Cleared ROI 1')
    expect(result.current.selection).toBeNull()
    act(() => {
      result.current.offer?.undo()
    })
    expect(result.current.selection).toBe(BOX)
    expect(result.current.name).toBe('ROI 1')

    act(() => {
      result.current.removals.handleClearSelection()
    })
    const newer: RoiSelection = { ...BOX, kind: 'box' }
    act(() => {
      result.current.setSelection(newer)
    })
    act(() => {
      result.current.offer?.undo()
    })
    expect(result.current.selection).toBe(newer)
  })
})
