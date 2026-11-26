import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { Annotation } from '../../data/annotation'
import type { ContinuousCellMetadataTrack } from '../../data/customAnnotations'
import type { GeneValuesSource } from '../../data/geneValues'
import { GeneRowReader } from '../../data/geneValuesByRow'
import { lazyIdLookup } from '../../data/lazyIdLookup'
import type { RoiSelection } from '../../data/roiSelection'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import type { PythonOverlay } from '../../rendering/pythonOverlay'
import type { GeometricAnnotationFeature } from '../annotations/geometricAnnotationModel'
import { plotSetOptions, type PlotDatasetSet } from '../plots/plotsPanelModel'
import { CellImageMeasurements } from '../query/cellImageMeasurements'
import type { CellColumnReader } from '../query/cellColumnReader'
import { cellQueryColumns, overviewCellColumns } from '../query/cellQueryModel'
import type { SavedSelection } from '../roi/selectionListModel'
import type { PythonViewInfo } from '../../workers/pythonMessages'
import type { PythonConsoleModel, PythonPickedPoint } from './pythonConsoleModel'
import {
  createPythonDataProvider,
  type PythonDataContext,
  type PythonGeneReader,
} from './pythonData'
import { PythonLayerStore } from './pythonLayerStore'
import { PythonSession, pythonSupported } from './pythonSession'

// The Python console's wiring in the app (plan 29): one session for the
// tab, answering Python from the open dataset as it stands when Python
// asks. Nothing starts until the window first opens.

export interface PythonConsoleInput {
  readonly available: boolean
  readonly datasetUrl: string | null
  readonly datasetName: string
  readonly cells: readonly OverviewCellDatum[]
  readonly elementNoun: string
  readonly annotations: readonly Annotation<string>[]
  readonly datasetSets: readonly PlotDatasetSet[]
  readonly metadataTracks: readonly ContinuousCellMetadataTrack[]
  // Shared with Cell Query, so both read a set or track once.
  readonly columnReader: CellColumnReader
  readonly geneNames: readonly string[]
  // The dataset's matrix by gene, or null where it has none.
  readonly openGeneSource: (url: string) => Promise<GeneValuesSource | null>
  readonly savedSelections: readonly SavedSelection[]
  readonly currentSelection: RoiSelection | null
  readonly features: readonly GeometricAnnotationFeature[]
  // The canvas's view as last reported, in µm with y down.
  readonly view: () => PythonViewInfo | null
  readonly selectedCellId: string | null
}

export interface PythonConsoleWiring {
  // Null where the dataset's cells cannot be read from Python.
  readonly model: PythonConsoleModel | null
  // Set while Pick point waits for a click on the canvas.
  readonly onPointPick:
    | ((point: { readonly x: number; readonly y: number }) => void)
    | undefined
  // The layers Python drew, for the canvas and the legend.
  readonly overlay: PythonOverlay
  // The legend's clear button.
  readonly clearLegendItem: (itemId: string) => void
}

const NO_IMAGE_MEASUREMENTS = new CellImageMeasurements().getSnapshot()
const NO_OVER_LIMIT: ReadonlyMap<string, string> = new Map()

// Made once per list of cells, on Python's first read.
const cellColumnsCache = new WeakMap<
  readonly OverviewCellDatum[],
  ReturnType<typeof overviewCellColumns>
>()
const placedIdsCache = new WeakMap<
  readonly OverviewCellDatum[],
  ReturnType<typeof lazyIdLookup<OverviewCellDatum, true>>
>()

function cachedCellColumns(cells: readonly OverviewCellDatum[]) {
  let columns = cellColumnsCache.get(cells)
  if (columns === undefined) {
    columns = overviewCellColumns(cells)
    cellColumnsCache.set(cells, columns)
  }
  return columns
}

function cachedPlacedIds(cells: readonly OverviewCellDatum[]) {
  let ids = placedIdsCache.get(cells)
  if (ids === undefined) {
    ids = lazyIdLookup(
      cells,
      (cell) => cell.id,
      () => true as const,
    )
    placedIdsCache.set(cells, ids)
  }
  return ids
}

interface HeldGenes {
  readonly url: string
  readonly cells: readonly OverviewCellDatum[]
  readonly reader: Promise<PythonGeneReader | null>
}

// The app's state as Python's next request finds it, and the gene reader
// for the open dataset, opened on the first read.
class PythonContextSource {
  #input: PythonConsoleInput
  #genes: HeldGenes | null = null
  readonly #layers: PythonLayerStore

  constructor(input: PythonConsoleInput, layers: PythonLayerStore) {
    this.#input = input
    this.#layers = layers
  }

  update(input: PythonConsoleInput): void {
    this.#input = input
  }

  context(): PythonDataContext {
    const { cells } = this.#input
    return pythonContext(
      this.#input,
      () => this.#geneReader(),
      (command) => {
        this.#layers.apply(command, cells.length)
      },
    )
  }

  #geneReader(): Promise<PythonGeneReader | null> {
    const { datasetUrl, cells } = this.#input
    if (datasetUrl === null) return Promise.resolve(null)
    const held = this.#genes
    if (held !== null && held.url === datasetUrl && held.cells === cells) {
      return held.reader
    }
    const reader = this.#input
      .openGeneSource(datasetUrl)
      .then((source) => {
        if (source === null) return null
        const rows = new GeneRowReader(
          source,
          cells.map((cell) => cell.id),
        )
        return {
          read: (
            gene: string,
            options: { readonly layer?: string; readonly allowLarge?: boolean },
          ) => rows.read(gene, options),
          layers: () => rows.layers(),
        }
      })
      .catch((error: unknown) => {
        // Tried again on the next read.
        if (this.#genes?.reader === reader) this.#genes = null
        throw error
      })
    this.#genes = { url: datasetUrl, cells, reader }
    return reader
  }
}

export function usePythonConsole(input: PythonConsoleInput): PythonConsoleWiring {
  const [layers] = useState(() => new PythonLayerStore())
  const overlay = useSyncExternalStore(layers.subscribe, layers.getSnapshot)
  const [source] = useState(() => new PythonContextSource(input, layers))
  useEffect(() => {
    source.update(input)
  })

  const [session] = useState(
    () =>
      new PythonSession({
        createWorker: () =>
          new Worker(new URL('../../workers/python.worker.ts', import.meta.url), {
            type: 'module',
          }),
        indexUrl: new URL(
          `${import.meta.env.BASE_URL}pyodide/`,
          globalThis.location?.href ?? 'http://localhost/',
        ).href,
        data: createPythonDataProvider(() => source.context()),
        supported: pythonSupported(),
        crossOriginIsolated: globalThis.crossOriginIsolated === true,
        onRunEnd: () => {
          layers.flush()
        },
      }),
  )
  useEffect(
    () => () => {
      session.dispose()
    },
    [session],
  )

  // Another dataset, or other cells: Python's cached columns go, and so do
  // the layers drawn on the old rows.
  const shownRows = useRef({ url: input.datasetUrl, cells: input.cells })
  useEffect(() => {
    const shown = shownRows.current
    if (shown.url === input.datasetUrl && shown.cells === input.cells) return
    shownRows.current = { url: input.datasetUrl, cells: input.cells }
    session.datasetChanged()
    layers.reset()
  }, [input.cells, input.datasetUrl, layers, session])

  const [picking, setPicking] = useState(false)
  const [pickedPoint, setPickedPoint] = useState<PythonPickedPoint | null>(null)
  const onPointPick = useCallback((point: { readonly x: number; readonly y: number }) => {
    setPicking(false)
    setPickedPoint((current) => ({ id: (current?.id ?? 0) + 1, x: point.x, y: point.y }))
  }, [])

  const model = useMemo<PythonConsoleModel | null>(
    () =>
      input.available
        ? { session, picking, onPickingChange: setPicking, pickedPoint }
        : null,
    [input.available, pickedPoint, picking, session],
  )

  const clearLegendItem = useCallback(
    (itemId: string) => {
      layers.clearItem(itemId)
    },
    [layers],
  )

  return {
    model,
    onPointPick: picking && input.available ? onPointPick : undefined,
    overlay,
    clearLegendItem,
  }
}

function pythonContext(
  input: PythonConsoleInput,
  genes: () => Promise<PythonGeneReader | null>,
  draw: PythonDataContext['draw'],
): PythonDataContext {
  const { cells, datasetUrl } = input
  const cellColumns = cachedCellColumns(cells)
  // The saved selections are shapes (rois) in Python, not a column.
  const columns = cellQueryColumns({
    cellColumns,
    setOptions: plotSetOptions({
      annotations: input.annotations,
      savedSelectionCount: 0,
      datasetSets: input.datasetSets,
      datasetSet: null,
    }),
    tracks: input.metadataTracks,
  }).filter(
    (column) => column.source.kind !== 'set' || column.source.setKind !== 'selections',
  )

  return {
    datasetUrl,
    datasetName: input.datasetName,
    cells,
    elementNoun: input.elementNoun,
    columns,
    columnReader: input.columnReader,
    columnContext: {
      datasetUrl,
      cells,
      placedCellIds: cachedPlacedIds(cells),
      cellColumns,
      annotations: input.annotations,
      savedSelections: [],
      metadataTracks: input.metadataTracks,
      imageSnapshot: NO_IMAGE_MEASUREMENTS,
      imageOverLimit: NO_OVER_LIMIT,
    },
    geneNames: input.geneNames,
    genes,
    savedSelections: input.savedSelections,
    currentSelection: input.currentSelection,
    features: input.features,
    view: input.view(),
    selectedCellId: input.selectedCellId,
    draw,
  }
}
