import { useState, type Dispatch, type SetStateAction } from 'react'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { AnnotationGroupOption } from '../../data/datasetAnnotations'
import type {
  AnnotationGroupState,
  AnnotationState,
  PlacedCellIds,
} from '../annotations/annotationModel'
import type { GeometricAnnotationFeature } from '../annotations/geometricAnnotationModel'

// Annotation sets and their labels, metadata tracks, and GeoJSON shapes
// (UNIFIED_PLAN.md, 15.2-A). The new shell moves the sets and tracks to the
// Cells section's Colour by and keeps the shapes in the Annotations section.
export interface AnnotationsSectionModel {
  // The header chip.
  readonly headerCopy: string
  readonly isLoading: boolean
  readonly sets: AnnotationSetsModel
  readonly metadataTracks: MetadataTracksModel
  readonly shapes: GeometricShapesModel
}

export interface AnnotationSetsModel {
  // False only on an image, where shapes are all that can be loaded.
  readonly available: boolean
  readonly loadEnabled: boolean
  readonly selectedGroupId: string
  readonly groupOptions: readonly AnnotationGroupOption[]
  readonly onGroupChange: (groupId: string) => void
  readonly state: AnnotationState
  readonly groupState: AnnotationGroupState
  readonly onLoad: () => void
  // Clearing also removes metadata tracks.
  readonly canClear: boolean
  readonly onClear: () => void
  readonly onExport: () => void
  readonly onImportFile: (file: File | null) => void
  readonly importUrl: string
  readonly onImportUrlChange: (url: string) => void
  readonly isImportingUrl: boolean
  // Keeps the address in the field when the labels were imported.
  readonly onImportUrl: (url: string) => Promise<void>
  readonly colors: Readonly<Record<string, string>>
  readonly hiddenSetIds: readonly string[]
  readonly hiddenIds: readonly string[]
  // Set when some cells are not on the map (Visium spots off the tissue),
  // so label counts leave them out.
  readonly placedCellIds: PlacedCellIds | null
  readonly onColorChange: (annotationId: string, color: string) => void
  readonly onSetVisibilityChange: (setId: string, visible: boolean) => void
  readonly onVisibilityChange: (annotationId: string, visible: boolean) => void
  readonly onRemove: (annotationId: string) => void
}

export interface MetadataTracksModel {
  readonly tracks: readonly ContinuousCellMetadataTrack[]
  readonly onRemove: (trackId: string) => void
}

export interface GeometricShapesModel {
  readonly enabled: boolean
  readonly shapes: readonly GeometricAnnotationFeature[]
  readonly onImportFile: (file: File | null) => void
  readonly onExport: () => void
  readonly onClear: () => void
  readonly onColorChange: (annotationId: string, color: string) => void
  readonly onVisibilityChange: (annotationId: string, visible: boolean) => void
  readonly onRemove: (annotationId: string) => void
}

export interface AnnotationsSectionModelInput {
  readonly annotationColors: Readonly<Record<string, string>>
  readonly annotationGroupOptions: readonly AnnotationGroupOption[]
  readonly annotationGroupState: AnnotationGroupState
  readonly annotationHeaderCopy: string
  readonly annotationImportUrl: string
  readonly annotationPlacedCellIds: PlacedCellIds | null
  readonly annotationState: AnnotationState
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly geometricAnnotations: readonly GeometricAnnotationFeature[]
  readonly geometricAnnotationsEnabled: boolean
  readonly handleAnnotationColorChange: (annotationId: string, color: string) => void
  readonly handleAnnotationGroupChange: (groupId: string) => void
  readonly handleAnnotationSetVisibilityChange: (setId: string, visible: boolean) => void
  readonly handleAnnotationVisibilityChange: (
    annotationId: string,
    visible: boolean,
  ) => void
  readonly handleClearAnnotations: () => void
  readonly handleClearGeometricAnnotations: () => void
  readonly handleExportAnnotations: () => void
  readonly handleExportGeometricAnnotations: () => void
  readonly handleGeometricAnnotationColorChange: (
    annotationId: string,
    color: string,
  ) => void
  readonly handleGeometricAnnotationVisibilityChange: (
    annotationId: string,
    visible: boolean,
  ) => void
  readonly handleImportAnnotationUrl: (url: string) => Promise<boolean>
  readonly handleImportAnnotations: (file: File | null) => Promise<void>
  readonly handleImportGeometricAnnotations: (file: File | null) => Promise<void>
  readonly handleLoadAnnotations: () => void
  readonly handleRemoveAnnotation: (annotationId: string) => void
  readonly handleRemoveCellMetadataTrack: (trackId: string) => void
  readonly handleRemoveGeometricAnnotation: (annotationId: string) => void
  readonly hiddenAnnotationIds: readonly string[]
  readonly hiddenAnnotationSetIds: readonly string[]
  readonly loadEnabled: boolean
  readonly selectedAnnotationGroupId: string
  readonly setAnnotationImportUrl: Dispatch<SetStateAction<string>>
}

export function useAnnotationsSectionModel({
  annotationColors,
  annotationGroupOptions,
  annotationGroupState,
  annotationHeaderCopy,
  annotationImportUrl,
  annotationPlacedCellIds,
  annotationState,
  cellMetadataTracks,
  geometricAnnotations,
  geometricAnnotationsEnabled,
  handleAnnotationColorChange,
  handleAnnotationGroupChange,
  handleAnnotationSetVisibilityChange,
  handleAnnotationVisibilityChange,
  handleClearAnnotations,
  handleClearGeometricAnnotations,
  handleExportAnnotations,
  handleExportGeometricAnnotations,
  handleGeometricAnnotationColorChange,
  handleGeometricAnnotationVisibilityChange,
  handleImportAnnotationUrl,
  handleImportAnnotations,
  handleImportGeometricAnnotations,
  handleLoadAnnotations,
  handleRemoveAnnotation,
  handleRemoveCellMetadataTrack,
  handleRemoveGeometricAnnotation,
  hiddenAnnotationIds,
  hiddenAnnotationSetIds,
  loadEnabled,
  selectedAnnotationGroupId,
  setAnnotationImportUrl,
}: AnnotationsSectionModelInput): AnnotationsSectionModel {
  const [isImportingUrl, setIsImportingUrl] = useState(false)

  return {
    headerCopy: annotationHeaderCopy,
    isLoading:
      annotationState.status === 'loading' || annotationGroupState.status === 'loading',
    sets: {
      available:
        !geometricAnnotationsEnabled ||
        loadEnabled ||
        annotationState.status !== 'idle' ||
        annotationGroupState.status !== 'idle' ||
        cellMetadataTracks.length > 0,
      loadEnabled,
      selectedGroupId: selectedAnnotationGroupId,
      groupOptions: annotationGroupOptions,
      onGroupChange: handleAnnotationGroupChange,
      state: annotationState,
      groupState: annotationGroupState,
      onLoad: handleLoadAnnotations,
      canClear: annotationState.status === 'ready' || cellMetadataTracks.length > 0,
      onClear: handleClearAnnotations,
      onExport: handleExportAnnotations,
      onImportFile: (file) => {
        void handleImportAnnotations(file)
      },
      importUrl: annotationImportUrl,
      onImportUrlChange: setAnnotationImportUrl,
      isImportingUrl,
      onImportUrl: async (url) => {
        setIsImportingUrl(true)
        try {
          const imported = await handleImportAnnotationUrl(url)

          if (imported) {
            setAnnotationImportUrl(url)
          }
        } finally {
          setIsImportingUrl(false)
        }
      },
      colors: annotationColors,
      hiddenSetIds: hiddenAnnotationSetIds,
      hiddenIds: hiddenAnnotationIds,
      placedCellIds: annotationPlacedCellIds,
      onColorChange: handleAnnotationColorChange,
      onSetVisibilityChange: handleAnnotationSetVisibilityChange,
      onVisibilityChange: handleAnnotationVisibilityChange,
      onRemove: handleRemoveAnnotation,
    },
    metadataTracks: {
      tracks: cellMetadataTracks,
      onRemove: handleRemoveCellMetadataTrack,
    },
    shapes: {
      enabled: geometricAnnotationsEnabled,
      shapes: geometricAnnotations,
      onImportFile: (file) => {
        void handleImportGeometricAnnotations(file)
      },
      onExport: handleExportGeometricAnnotations,
      onClear: handleClearGeometricAnnotations,
      onColorChange: handleGeometricAnnotationColorChange,
      onVisibilityChange: handleGeometricAnnotationVisibilityChange,
      onRemove: handleRemoveGeometricAnnotation,
    },
  }
}
