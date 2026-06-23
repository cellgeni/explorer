import { act, render } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import { micrometers } from '../../data/coords'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
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
  readonly observationColorMode: ObservationColorMode
  readonly roiName: string
  readonly selectedAnnotationGroupId: string
}

let api: ReturnType<typeof useAnnotationWorkflow>
let snapshot: Snapshot

function Probe({
  initialAnnotationState = { status: 'idle' },
  loadAnnotations,
  onReady,
  roiState = { status: 'idle' },
  selectedAnnotationGroupId = 'cluster-a',
}: {
  readonly initialAnnotationState?: AnnotationState<StructuredLoadError>
  readonly loadAnnotations: Parameters<typeof useAnnotationWorkflow>[0]['loadAnnotations']
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
  const [, setHiddenAnnotationSetIds] = React.useState<readonly string[]>([])
  const [cellMetadataTracks, setCellMetadataTracks] = React.useState<
    readonly ContinuousCellMetadataTrack[]
  >([])
  const [, setSelectedCellMetadataTrackId] = React.useState<string | null>(null)
  const [observationColorMode, setObservationColorMode] =
    React.useState<ObservationColorMode>('transcript-count')
  const [roiName, setRoiName] = React.useState('Marker ROI')
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
    annotationState,
    appendDebugEvent: (message) => {
      debugMessagesRef.current.push(message)
    },
    cellMetadataTracks,
    datasetAbortRef,
    datasetUrl: 'https://example.test/output',
    loadAnnotations,
    loadRequestIdRef,
    loadState,
    roiIdRef,
    roiName,
    roiState,
    selectedAnnotationGroupId: groupId,
    setAnnotationColors,
    setHiddenAnnotationSetIds,
    setCellMetadataTracks,
    setAnnotationState,
    setObservationColorMode,
    setRoiName,
    setSelectedAnnotationGroupId,
    setSelectedCellMetadataTrackId,
  })

  React.useEffect(() => {
    onReady(nextApi, {
      annotationColors,
      annotationState,
      cellMetadataTracks,
      debugMessages: debugMessagesRef.current,
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
    expect(snapshot.annotationState).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      annotations,
    })
    expect(snapshot.observationColorMode).toBe('annotations')
    expect(snapshot.annotationColors.a).toBe('#1f77b4')
    expect(snapshot.debugMessages).toContain('Annotations loaded: 1 labels')
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
    expect(snapshot.roiName).toBe('ROI 2')
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
        min: 0.82,
        max: 0.82,
      },
    ])
    expect(snapshot.observationColorMode).toBe('metadata')
    expect(snapshot.debugMessages).toContain(
      'Imported annotations: 0 labels, 1 metadata tracks',
    )
  })
})
