import { act, render } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import { NO_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import type { Annotation } from '../../datasets/spatialDataset'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import type { RoiState } from '../roi/roiModel'
import type { AnnotationState } from './annotationModel'
import { useAnnotationWorkflow } from './useAnnotationWorkflow'

interface Snapshot {
  readonly annotationColors: Readonly<Record<string, string>>
  readonly annotationState: AnnotationState<StructuredLoadError>
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly debugMessages: readonly string[]
  readonly hiddenAnnotationIds: readonly string[]
  readonly observationColorMode: ObservationColorMode
  readonly roiName: string
  readonly selectedAnnotationGroupId: string
}

let api: ReturnType<typeof useAnnotationWorkflow>
let snapshot: Snapshot

const NO_DATASET_CELL_IDS: ReadonlySet<string> = new Set()

function Probe({
  datasetCellIds = NO_DATASET_CELL_IDS,
  initialAnnotationState = { status: 'idle' },
  initialColorMode = 'transcript-count',
  initialHiddenAnnotationIds = [],
  loadAnnotations,
  onReady,
  roiState = { status: 'idle' },
  selectedAnnotationGroupId = 'cluster-a',
}: {
  readonly datasetCellIds?: ReadonlySet<string>
  readonly initialAnnotationState?: AnnotationState<StructuredLoadError>
  readonly initialColorMode?: ObservationColorMode
  readonly initialHiddenAnnotationIds?: readonly string[]
  readonly loadAnnotations: Parameters<
    typeof useAnnotationWorkflow
  >[0]['loaders']['loadAnnotations']
  readonly onReady: (
    nextApi: ReturnType<typeof useAnnotationWorkflow>,
    nextSnapshot: Snapshot,
  ) => void
  readonly roiState?: RoiState<StructuredLoadError>
  readonly selectedAnnotationGroupId?: string
}) {
  const [annotationColors, setAnnotationColors] = React.useState<
    Readonly<Record<string, string>>
  >({})
  const [annotationState, setAnnotationState] =
    React.useState<AnnotationState<StructuredLoadError>>(initialAnnotationState)
  const [hiddenAnnotationIds, setHiddenAnnotationIds] = React.useState<readonly string[]>(
    initialHiddenAnnotationIds,
  )
  const [, setHiddenAnnotationSetIds] = React.useState<readonly string[]>([])
  const [cellMetadataTracks, setCellMetadataTracks] = React.useState<
    readonly ContinuousCellMetadataTrack[]
  >([])
  const [, setSelectedCellMetadataTrackId] = React.useState<string | null>(null)
  const [observationColorMode, setObservationColorMode] =
    React.useState<ObservationColorMode>(initialColorMode)
  const [roiName] = React.useState('Marker ROI')
  const [groupId, setSelectedAnnotationGroupId] = React.useState(
    selectedAnnotationGroupId,
  )
  const debugMessagesRef = React.useRef<string[]>([])
  const datasetAbortRef = React.useRef<AbortController | null>(new AbortController())
  const loadRequestIdRef = React.useRef(7)
  const roiIdRef = React.useRef(0)
  const loadState: DatasetLoadState<StructuredLoadError> = {
    status: 'ready',
    url: 'https://example.test/output',
    cellCount: 2,
  }

  const nextApi = useAnnotationWorkflow({
    callbacks: {
      appendDebugEvent: (message) => {
        debugMessagesRef.current.push(message)
      },
    },
    data: {
      annotationState,
      cellMetadataTracks,
      datasetCellIds,
      datasetUrl: 'https://example.test/output',
      loadState,
      roiName,
      roiState,
      selectedAnnotationGroupId: groupId,
    },
    loaders: { loadAnnotations },
    refs: {
      datasetAbortRef,
      loadRequestIdRef,
      roiIdRef,
    },
    setters: {
      setAnnotationColors,
      setAnnotationState,
      setCellMetadataTracks,
      setHiddenAnnotationIds,
      setHiddenAnnotationSetIds,
      setObservationColorMode,
      setSelectedAnnotationGroupId,
      setSelectedCellMetadataTrackId,
    },
  })

  React.useEffect(() => {
    onReady(nextApi, {
      annotationColors,
      annotationState,
      cellMetadataTracks,
      debugMessages: debugMessagesRef.current,
      hiddenAnnotationIds,
      observationColorMode,
      roiName,
      selectedAnnotationGroupId: groupId,
    })
  })

  return null
}

describe('useAnnotationWorkflow', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads annotation groups and activates annotation coloring', async () => {
    const annotations: readonly Annotation[] = [
      { id: 'a', label: 'Astrocytes', cellIds: [asCellId('aaaaaaaa-1')] },
    ]
    const loadAnnotations = vi.fn(async () => annotations)

    render(
      <Probe
        initialHiddenAnnotationIds={['a']}
        loadAnnotations={loadAnnotations}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleLoadAnnotations()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(loadAnnotations).toHaveBeenCalledWith(
      'https://example.test/output',
      expect.objectContaining({
        groupId: 'cluster-a',
        signal: expect.any(AbortSignal),
      }),
    )
    // The loaded set is recorded for share links (groups=).
    expect(snapshot.annotationState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      annotations,
      groupId: 'cluster-a',
    })
    expect(snapshot.observationColorMode).toBe('annotations')
    expect(snapshot.annotationColors.a).toBe('#1f77b4')
    expect(snapshot.hiddenAnnotationIds).toEqual([])
    expect(snapshot.debugMessages).toContain('Annotations loaded: 1 labels')
  })

  it('does not load annotations when no annotation group is selected', () => {
    const loadAnnotations = vi.fn(async () => [])

    render(
      <Probe
        loadAnnotations={loadAnnotations}
        selectedAnnotationGroupId={NO_ANNOTATION_GROUP_ID}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleLoadAnnotations()
    })

    expect(loadAnnotations).not.toHaveBeenCalled()
    expect(snapshot.annotationState).toEqual({ status: 'idle' })
  })

  it('removes annotations without leaving stale hidden visibility ids', () => {
    const removableAnnotations: readonly Annotation[] = [
      { id: 'a', label: 'Astrocytes', cellIds: [asCellId('aaaaaaaa-1')] },
      { id: 'b', label: 'Neurons', cellIds: [asCellId('bbbbbbbb-2')] },
    ]

    render(
      <Probe
        initialAnnotationState={{
          status: 'ready',
          url: 'https://example.test/output',
          annotations: removableAnnotations,
        }}
        initialHiddenAnnotationIds={['a', 'b']}
        loadAnnotations={vi.fn(async () => [])}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleRemoveAnnotation('a')
    })

    expect(
      snapshot.annotationState.status === 'ready'
        ? snapshot.annotationState.annotations.map((annotation) => annotation.id)
        : [],
    ).toEqual(['b'])
    expect(snapshot.hiddenAnnotationIds).toEqual(['b'])

    act(() => {
      api.handleClearAnnotations()
    })

    expect(snapshot.annotationState).toEqual({ status: 'idle' })
    expect(snapshot.hiddenAnnotationIds).toEqual([])
  })

  it('keeps a colour mode that does not show the annotations', () => {
    let api!: ReturnType<typeof useAnnotationWorkflow>
    let snapshot!: Snapshot

    render(
      <Probe
        initialAnnotationState={{
          status: 'ready',
          url: 'https://example.test/output',
          annotations: [{ id: 'a', label: 'A', cellIds: [] }],
        }}
        initialColorMode="gene-expression"
        loadAnnotations={vi.fn(async () => [])}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    // With SNAP25 selected, removing the last class leaves the genes on.
    act(() => {
      api.handleRemoveAnnotation('a')
    })
    expect(snapshot.observationColorMode).toBe('gene-expression')

    act(() => {
      api.handleClearAnnotations()
    })
    expect(snapshot.observationColorMode).toBe('gene-expression')
  })

  it('saves ready ROI cells as an annotation', () => {
    const selection = {
      kind: 'box' as const,
      bbox: {
        minX: micrometers(1),
        minY: micrometers(2),
        maxX: micrometers(3),
        maxY: micrometers(4),
      },
    }
    const roiState: RoiState<StructuredLoadError> = {
      status: 'ready',
      url: 'https://example.test/output',
      bbox: selection.bbox,
      selection,
      cells: [
        {
          id: asCellId('aaaaaaaa-1'),
          position: { x: micrometers(1), y: micrometers(2) },
        },
      ],
      hitCellLimit: false,
    }

    render(
      <Probe
        loadAnnotations={vi.fn(async () => [])}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
        roiState={roiState}
      />,
    )

    act(() => {
      api.handleSaveRoiAnnotation()
    })

    expect(snapshot.annotationState.status).toBe('ready')
    expect(
      snapshot.annotationState.status === 'ready'
        ? snapshot.annotationState.annotations[0]?.id
        : '',
    ).toBe('roi:1:marker-roi')
    expect(snapshot.observationColorMode).toBe('annotations')
    // The selection keeps its name (15.4-A).
    expect(snapshot.roiName).toBe('Marker ROI')
  })

  it('exports ready annotations as CSV', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)

    render(
      <Probe
        initialAnnotationState={{
          status: 'ready',
          url: 'https://example.test/output',
          annotations: [
            {
              id: 'roi:1:marker-roi',
              label: 'Marker ROI',
              cellIds: [asCellId('aaaaaaaa-1')],
            },
          ],
        }}
        loadAnnotations={vi.fn(async () => [])}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.handleExportAnnotations()
    })

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob))
    const blob = createObjectUrl.mock.calls[0]?.[0]

    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test')
    expect(snapshot.debugMessages).toContain('Exported annotations: 1 labels')

    if (blob instanceof Blob) {
      await expect(blob.text()).resolves.toBe(
        'annotation_id,label,cell_id\nroi:1:marker-roi,Marker ROI,aaaaaaaa-1',
      )
    }
  })

  it('imports custom annotations from a URL', async () => {
    const cellId = asCellId('aaaaaaaa-1')
    const fetcher = vi.fn(async () => new Response(`cell_id,label\n${cellId},Remote ROI`))
    vi.stubGlobal('fetch', fetcher)

    render(
      <Probe
        loadAnnotations={vi.fn(async () => [])}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      const imported = await api.handleImportAnnotationUrl(
        'https://github.com/cellgeni/example/blob/main/annotations/manual.csv?plain=1',
      )
      expect(imported).toBe(true)
    })

    expect(fetcher).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/cellgeni/example/main/annotations/manual.csv',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(snapshot.annotationState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      annotations: [
        {
          id: 'custom:manual-csv:remote-roi',
          label: 'Remote ROI',
          cellIds: [cellId],
        },
      ],
    })
    expect(snapshot.annotationColors['custom:manual-csv:remote-roi']).toBe('#1f77b4')
    expect(snapshot.observationColorMode).toBe('annotations')
    expect(snapshot.debugMessages).toContain('Imported URL annotations: 1 labels')
  })

  it('imports continuous CSV values as metadata tracks and activates metadata coloring', async () => {
    const cellId = asCellId('aaaaaaaa-1')
    const file = new File([`cell_id,confidence\n${cellId},0.82`], 'scores.csv', {
      type: 'text/csv',
    })

    render(
      <Probe
        loadAnnotations={vi.fn(async () => [])}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      await api.handleImportAnnotations(file)
    })

    expect(snapshot.annotationState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      annotations: [],
    })
    expect(snapshot.cellMetadataTracks).toEqual([
      {
        id: 'metadata:scores-csv:confidence',
        label: 'confidence',
        values: [{ cellId, value: 0.82 }],
        cellCount: 1,
        min: 0.82,
        max: 0.82,
      },
    ])
    expect(snapshot.observationColorMode).toBe('metadata')
    expect(snapshot.debugMessages).toContain(
      'Imported annotations: 0 labels, 1 metadata tracks',
    )
  })

  it('imports Visium barcodes and says how many cells are not on the map', async () => {
    const file = new File(
      [
        `cell_id,label
AAACAAGTATCTCCCA-1,Tumour
AAACACCAATAACTGC-1,Tumour
AAACAGAGCGACTCCT-1,Stroma`,
      ],
      'spots.csv',
      { type: 'text/csv' },
    )

    render(
      <Probe
        datasetCellIds={new Set(['AAACAAGTATCTCCCA-1', 'AAACACCAATAACTGC-1'])}
        loadAnnotations={vi.fn(async () => [])}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      await api.handleImportAnnotations(file)
    })

    expect(
      snapshot.annotationState.status === 'ready'
        ? snapshot.annotationState.annotations.map((annotation) => annotation.cellIds)
        : [],
    ).toEqual([['AAACAAGTATCTCCCA-1', 'AAACACCAATAACTGC-1'], ['AAACAGAGCGACTCCT-1']])
    expect(api.annotationImportNotice).toBe('1 of 3 imported cells are not on the map.')

    act(() => {
      api.handleClearAnnotations()
    })

    expect(api.annotationImportNotice).toBeNull()
  })

  it('fails an import when none of its cells are on the map', async () => {
    const file = new File([`cell_id,label\n0,T cell\n1,B cell`], 'instances.csv', {
      type: 'text/csv',
    })

    render(
      <Probe
        datasetCellIds={new Set(['aaaaaaaa-1'])}
        loadAnnotations={vi.fn(async () => [])}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      await api.handleImportAnnotations(file)
    })

    expect(snapshot.annotationState).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error: {
        source: 'Annotations',
        code: 'unknown',
        title: 'Imported cells not found',
        message: 'None of the 2 imported cells are on the map.',
        action: "Check that the file's cell IDs come from this dataset.",
      },
    })
    expect(api.annotationImportNotice).toBeNull()
    expect(snapshot.debugMessages).toContain('Annotation import failed')
  })

  it('keeps the classes a link hides once its set loads, if the set has them', async () => {
    const annotations: readonly Annotation[] = [
      { id: 'a', label: 'Astrocytes', cellIds: [asCellId('aaaaaaaa-1')] },
      { id: 'b', label: 'Neurons', cellIds: [asCellId('bbbbbbbb-2')] },
    ]

    render(
      <Probe
        loadAnnotations={vi.fn(async () => annotations)}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    act(() => {
      api.loadAnnotationGroup('cluster-a', { hiddenAnnotationIds: ['b', 'gone'] })
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(snapshot.annotationState.status).toBe('ready')
    expect(snapshot.hiddenAnnotationIds).toEqual(['b'])
  })

  it('keeps the imported classes a link hides', async () => {
    const cellId = asCellId('aaaaaaaa-1')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(`cell_id,label\n${cellId},Remote ROI\n${cellId},Other`),
      ),
    )

    render(
      <Probe
        initialHiddenAnnotationIds={['analysis:0:1']}
        loadAnnotations={vi.fn(async () => [])}
        onReady={(nextApi, nextSnapshot) => {
          api = nextApi
          snapshot = nextSnapshot
        }}
      />,
    )

    await act(async () => {
      await api.handleImportAnnotationUrl('https://example.test/manual.csv', {
        hiddenAnnotationIds: ['custom:manual-csv:remote-roi', 'custom:manual-csv:gone'],
      })
    })

    expect(snapshot.hiddenAnnotationIds).toEqual([
      'analysis:0:1',
      'custom:manual-csv:remote-roi',
    ])
  })
})
