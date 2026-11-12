import { useState, type Dispatch, type SetStateAction } from 'react'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { AnnotationGroupOption } from '../../data/datasetAnnotations'
import type {
  AnnotationGroupState,
  AnnotationState,
  PlacedCellIds,
} from '../annotations/annotationModel'
import type { GeometricAnnotationFeature } from '../annotations/geometricAnnotationModel'
import type { SavedSelection } from '../roi/selectionListModel'
import type { SelectionList } from '../roi/useSelectionList'

// Annotation sets and their labels, metadata tracks, selections and GeoJSON
// shapes (UNIFIED_PLAN.md, 15.2-A). The sets and tracks are in the Cells
// section's Clusters (D4); selections (15.4-A) and shapes are in the
// Annotations section.
export interface AnnotationsSectionModel {
  // The header chip.
  readonly headerCopy: string
  readonly isLoading: boolean
  readonly sets: AnnotationSetsModel
  readonly metadataTracks: MetadataTracksModel
  readonly selections: SelectionListModel
  readonly shapes: GeometricShapesModel
}

// Saved selections (15.4-A): one row each, with colour, visibility, name,
// Go To, rename and delete. Choosing a name shows it in the Selection card.
export interface SelectionListModel {
  // False on an image, where drawing makes shapes.
  readonly available: boolean
  readonly selections: readonly SavedSelection[]
  readonly activeId: string | null
  readonly canActivate: boolean
  readonly onActivate: (id: string) => void
  readonly onRename: (id: string, name: string) => void
  readonly onColorChange: (id: string, color: string) => void
  readonly onVisibilityChange: (id: string, visible: boolean) => void
  readonly onDelete: (id: string) => void
  readonly onGoTo: (id: string) => void
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
  // How many imported cells are not on the map, if any.
  readonly importNotice: string | null
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
  // Why the last import added no shapes.
  readonly importError: string | null
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
  readonly annotationImportNotice: string | null
  readonly annotationImportUrl: string
  readonly annotationPlacedCellIds: PlacedCellIds | null
  readonly annotationState: AnnotationState
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly geometricAnnotationImportError: string | null
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
  readonly selectionList: SelectionList
  readonly selectionsAvailable: boolean
  readonly setAnnotationImportUrl: Dispatch<SetStateAction<string>>
}

export function useAnnotationsSectionModel({
  annotationColors,
  annotationGroupOptions,
  annotationGroupState,
  annotationHeaderCopy,
  annotationImportNotice,
  annotationImportUrl,
  annotationPlacedCellIds,
  annotationState,
  cellMetadataTracks,
  geometricAnnotationImportError,
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
  selectionList,
  selectionsAvailable,
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
      importNotice: annotationImportNotice,
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
    selections: {
      available: selectionsAvailable,
      selections: selectionList.selections,
      activeId: selectionList.activeId,
      canActivate: selectionList.canActivate,
      onActivate: selectionList.onActivate,
      onRename: selectionList.onRename,
      onColorChange: selectionList.onColorChange,
      onVisibilityChange: selectionList.onVisibilityChange,
      onDelete: selectionList.onDelete,
      onGoTo: selectionList.onGoTo,
    },
    shapes: {
      enabled: geometricAnnotationsEnabled,
      shapes: geometricAnnotations,
      importError: geometricAnnotationImportError,
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
