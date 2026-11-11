import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  useAnnotationsSectionModel,
  type AnnotationsSectionModelInput,
} from './annotationsSectionModel'

function input(
  overrides: Partial<AnnotationsSectionModelInput> = {},
): AnnotationsSectionModelInput {
  return {
    annotationColors: {},
    annotationGroupOptions: [],
    annotationGroupState: { status: 'idle' },
    annotationHeaderCopy: 'Idle',
    annotationImportUrl: '',
    annotationPlacedCellIds: null,
    annotationState: { status: 'idle' },
    cellMetadataTracks: [],
    geometricAnnotations: [],
    geometricAnnotationsEnabled: false,
    handleAnnotationColorChange: vi.fn(),
    handleAnnotationGroupChange: vi.fn(),
    handleAnnotationSetVisibilityChange: vi.fn(),
    handleAnnotationVisibilityChange: vi.fn(),
    handleClearAnnotations: vi.fn(),
    handleClearGeometricAnnotations: vi.fn(),
    handleExportAnnotations: vi.fn(),
    handleExportGeometricAnnotations: vi.fn(),
    handleGeometricAnnotationColorChange: vi.fn(),
    handleGeometricAnnotationVisibilityChange: vi.fn(),
    handleImportAnnotationUrl: vi.fn(async () => true),
    handleImportAnnotations: vi.fn(async () => {}),
    handleImportGeometricAnnotations: vi.fn(async () => {}),
    handleLoadAnnotations: vi.fn(),
    handleRemoveAnnotation: vi.fn(),
    handleRemoveCellMetadataTrack: vi.fn(),
    handleRemoveGeometricAnnotation: vi.fn(),
    hiddenAnnotationIds: [],
    hiddenAnnotationSetIds: [],
    loadEnabled: true,
    selectedAnnotationGroupId: '',
    selectionList: {
      selections: [],
      activeId: null,
      active: null,
      canActivate: true,
      onDrawn: vi.fn(),
      onActivate: vi.fn(),
      onCloseActive: vi.fn(),
      onRename: vi.fn(),
      onColorChange: vi.fn(),
      onVisibilityChange: vi.fn(),
      onDelete: vi.fn(),
      onGoTo: vi.fn(),
    },
    selectionsAvailable: true,
    setAnnotationImportUrl: vi.fn(),
    ...overrides,
  }
}

describe('useAnnotationsSectionModel', () => {
  it('marks the URL import busy and keeps the address once imported', async () => {
    let finishImport: (imported: boolean) => void = () => {}
    const options = input({
      handleImportAnnotationUrl: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finishImport = resolve
          }),
      ),
    })
    const { result } = renderHook(() => useAnnotationsSectionModel(options))

    let importing: Promise<void> = Promise.resolve()
    act(() => {
      importing = result.current.sets.onImportUrl('https://example.test/labels.csv')
    })

    expect(result.current.sets.isImportingUrl).toBe(true)

    await act(async () => {
      finishImport(true)
      await importing
    })

    expect(result.current.sets.isImportingUrl).toBe(false)
    expect(options.handleImportAnnotationUrl).toHaveBeenCalledWith(
      'https://example.test/labels.csv',
    )
    expect(options.setAnnotationImportUrl).toHaveBeenCalledWith(
      'https://example.test/labels.csv',
    )
  })

  it('leaves the address alone when the import fails', async () => {
    const options = input({ handleImportAnnotationUrl: vi.fn(async () => false) })
    const { result } = renderHook(() => useAnnotationsSectionModel(options))

    await act(async () => {
      await result.current.sets.onImportUrl('https://example.test/missing.csv')
    })

    expect(result.current.sets.isImportingUrl).toBe(false)
    expect(options.setAnnotationImportUrl).not.toHaveBeenCalled()
  })

  it('hides the set controls only when shapes are all an image can load', () => {
    const imageOnly = renderHook(() =>
      useAnnotationsSectionModel(
        input({ geometricAnnotationsEnabled: true, loadEnabled: false }),
      ),
    )
    const withTracks = renderHook(() =>
      useAnnotationsSectionModel(
        input({
          geometricAnnotationsEnabled: true,
          loadEnabled: false,
          cellMetadataTracks: [
            {
              id: 'metadata:confidence',
              label: 'confidence',
              values: [],
              cellCount: 0,
              min: 0,
              max: 1,
            },
          ],
        }),
      ),
    )

    expect(imageOnly.result.current.sets.available).toBe(false)
    expect(imageOnly.result.current.sets.canClear).toBe(false)
    expect(withTracks.result.current.sets.available).toBe(true)
    expect(withTracks.result.current.sets.canClear).toBe(true)
  })

  it('passes file imports to the async handlers', () => {
    const options = input()
    const { result } = renderHook(() => useAnnotationsSectionModel(options))
    const file = new File(['id,label'], 'labels.csv')

    result.current.sets.onImportFile(file)
    result.current.shapes.onImportFile(null)

    expect(options.handleImportAnnotations).toHaveBeenCalledWith(file)
    expect(options.handleImportGeometricAnnotations).toHaveBeenCalledWith(null)
  })
})
