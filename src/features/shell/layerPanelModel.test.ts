import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  testAnnotationsSectionModel,
  testCellsSectionModel,
  testImageSectionModel,
  testTranscriptsSectionModel,
} from '../../test/sectionModels'
import {
  cellsSummary,
  imageSummary,
  shapesSummary,
  transcriptsSummary,
  useLayerPanelModel,
  type LayerPanelModelInput,
} from './layerPanelModel'

function input(overrides: Partial<LayerPanelModelInput> = {}): LayerPanelModelInput {
  return {
    annotations: testAnnotationsSectionModel(),
    appendDebugEvent: vi.fn(),
    capabilities: { cells: true, geometricAnnotations: true, transcripts: true },
    cells: testCellsSectionModel(),
    elementNoun: 'cells',
    image: testImageSectionModel(),
    imageAvailable: true,
    layerVisibility: { image: true, cells: true, annotations: true },
    loadingAreas: new Set(),
    setLayerVisibility: vi.fn(),
    transcripts: testTranscriptsSectionModel(),
    ...overrides,
  }
}

describe('layer section summaries', () => {
  it('describes the image by channels, z plane and custom layers', () => {
    expect(imageSummary(testImageSectionModel(), false)).toBe('No image')
    expect(imageSummary(testImageSectionModel({ opacity: 0.8 }), true)).toBe('80%')
    expect(
      imageSummary(
        testImageSectionModel({
          channelSettings: [
            {
              id: 'a',
              enabled: true,
              color: [0, 0, 255],
              contrastMin: 0,
              contrastMax: 1,
            },
            {
              id: 'b',
              enabled: false,
              color: [0, 255, 0],
              contrastMin: 0,
              contrastMax: 1,
            },
          ],
          zStack: { sizeZ: 15, zPlane: 7, micrometersPerPlane: 3, openPlane: vi.fn() },
          customLayers: { layers: [{ id: 'x' } as never] },
        }),
        true,
      ),
    ).toBe('1 of 2 channels · z 8 of 15 · +1 layer')
  })

  it('says what colours the cells', () => {
    const annotations = testAnnotationsSectionModel({
      sets: {
        selectedGroupId: 'analysis:0',
        groupOptions: [{ id: 'analysis:0', label: 'graphclust' } as never],
      },
    })

    expect(cellsSummary(testCellsSectionModel(), annotations)).toBe('Transcript count')
    expect(
      cellsSummary(
        testCellsSectionModel({
          colour: { mode: 'gene-expression' },
          genes: { selected: ['SNAP25'] },
        }),
        annotations,
      ),
    ).toBe('SNAP25')
    expect(
      cellsSummary(
        testCellsSectionModel({
          colour: { mode: 'gene-expression' },
          genes: { selected: ['A', 'B', 'C', 'D'] },
        }),
        annotations,
      ),
    ).toBe('4 genes')
    expect(
      cellsSummary(
        testCellsSectionModel({ colour: { mode: 'annotations' } }),
        annotations,
      ),
    ).toBe('graphclust')
    expect(
      cellsSummary(
        testCellsSectionModel({
          colour: {
            mode: 'metadata',
            metadataTracks: [
              {
                id: 'metadata:confidence',
                label: 'confidence',
                values: [],
                cellCount: 0,
                min: 0,
                max: 1,
              },
            ],
          },
        }),
        annotations,
      ),
    ).toBe('confidence')
  })

  it('names the transcript genes and whether points or density show', () => {
    expect(transcriptsSummary(testTranscriptsSectionModel())).toBe('Off')
    expect(
      transcriptsSummary(
        testTranscriptsSectionModel({
          show: true,
          features: { filterMode: 'selected', selected: ['SNAP25'] },
          layerState: {
            status: 'aggregate',
            message: '',
            source: 'native-zarr',
            mode: 'density',
            bins: [],
            featureNames: ['SNAP25'],
            visibleTranscriptEstimate: 0,
          },
        }),
      ),
    ).toBe('SNAP25 · density')
    expect(
      transcriptsSummary(
        testTranscriptsSectionModel({
          show: true,
          layerState: {
            status: 'ready',
            url: 'https://example.test/output',
            points: [],
            groups: [],
            visibleTranscriptEstimate: 0,
            hitPointLimit: false,
          } as never,
        }),
      ),
    ).toBe('All features · points')
  })

  it('counts shapes', () => {
    expect(shapesSummary(testAnnotationsSectionModel().shapes)).toBe('No shapes')
    expect(
      shapesSummary(
        testAnnotationsSectionModel({ shapes: { shapes: [{ id: 'a' } as never] } })
          .shapes,
      ),
    ).toBe('1 shape')
  })
})

describe('useLayerPanelModel', () => {
  it('lists the sections the platform has, titled for its elements', () => {
    const xenium = renderHook(() => useLayerPanelModel(input()))
    const visiumHd = renderHook(() =>
      useLayerPanelModel(
        input({
          elementNoun: 'bins',
          capabilities: { cells: true, geometricAnnotations: true, transcripts: false },
        }),
      ),
    )
    const image = renderHook(() =>
      useLayerPanelModel(
        input({
          capabilities: { cells: false, geometricAnnotations: true, transcripts: false },
        }),
      ),
    )

    expect(xenium.result.current.sections.map((section) => section.title)).toEqual([
      'Image',
      'Cells',
      'Transcripts',
      'Annotations',
    ])
    expect(visiumHd.result.current.sections.map((section) => section.title)).toEqual([
      'Image',
      'Bins',
      'Annotations',
    ])
    expect(image.result.current.sections.map((section) => section.id)).toEqual([
      'image',
      'annotations',
    ])
  })

  it('hides and shows layers, and logs it', () => {
    const options = input()
    const { result } = renderHook(() => useLayerPanelModel(options))
    const cells = result.current.sections.find((section) => section.id === 'cells')

    cells?.onVisibleChange(false)

    const update = vi.mocked(options.setLayerVisibility).mock.calls[0]?.[0]
    expect(typeof update === 'function' && update(options.layerVisibility)).toEqual({
      image: true,
      cells: false,
      annotations: true,
    })
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Cells hidden', {
      coalesceKey: 'layer-visible:cells',
    })
  })

  it('ties the transcripts checkbox to Show transcripts', () => {
    const transcripts = testTranscriptsSectionModel({ show: true, loadEnabled: false })
    const { result } = renderHook(() =>
      useLayerPanelModel(input({ transcripts, loadingAreas: new Set(['transcripts']) })),
    )
    const header = result.current.sections.find((section) => section.id === 'transcripts')

    header?.onVisibleChange(false)

    expect(header).toMatchObject({
      visible: true,
      visibilityDisabled: true,
      loading: true,
    })
    expect(transcripts.onShowChange).toHaveBeenCalledWith(false)
  })
})
