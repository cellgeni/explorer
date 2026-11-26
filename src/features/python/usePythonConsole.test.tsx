import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import { EMPTY_PYTHON_OVERLAY } from '../../rendering/pythonOverlay'
import type {
  PythonWorkerRequest,
  PythonWorkerResponse,
} from '../../workers/pythonMessages'
import { CellColumnReader } from '../query/cellColumnReader'
import { usePythonConsole, type PythonConsoleInput } from './usePythonConsole'

// The console's wiring with the worker faked: a layer Python draws reaches
// the canvas once its input ends, and an input that draws nothing leaves
// the canvas's overlay as it was (plan 29, task G).

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<PythonWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly sent: PythonWorkerRequest[] = []

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: PythonWorkerRequest): void {
    this.sent.push(message)
  }

  terminate(): void {}

  emit(message: PythonWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<PythonWorkerResponse>)
  }

  lastRunId(): number {
    const run = this.sent.findLast((message) => message.type === 'run')
    if (run?.type !== 'run') throw new Error('No input was run.')
    return run.id
  }
}

function cells(count: number): OverviewCellDatum[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `cell-${String(index)}`,
    position: [index * 10, 0, 0],
    radiusPixels: 4,
    fillColor: [72, 68, 58, 200],
  }))
}

function input(change: Partial<PythonConsoleInput> = {}): PythonConsoleInput {
  return {
    available: true,
    datasetUrl: 'https://example.test/a.h5ad',
    datasetName: 'a.h5ad',
    cells: cells(3),
    elementNoun: 'cells',
    annotations: [],
    datasetSets: [],
    metadataTracks: [],
    columnReader: new CellColumnReader(),
    geneNames: [],
    openGeneSource: async () => null,
    savedSelections: [],
    currentSelection: null,
    features: [],
    view: () => null,
    selectedCellId: null,
    ...change,
  }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('usePythonConsole', () => {
  afterEach(() => {
    FakeWorker.instances = []
    vi.unstubAllGlobals()
  })

  it('draws an input’s layers once it ends, and nothing for an input that draws nothing', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('WebAssembly', { ...WebAssembly, Suspending: function Suspending() {} })
    const first = input()
    const { result, rerender } = renderHook(
      (props: PythonConsoleInput) => usePythonConsole(props),
      { initialProps: first },
    )
    const session = result.current.model?.session
    expect(session).toBeDefined()

    let outcome: Promise<unknown> = Promise.resolve()
    act(() => {
      outcome = session!.run('color(cells.x > 5, "green")')
    })
    const worker = FakeWorker.instances[0]!
    act(() => {
      worker.emit({ type: 'ready', pythonVersion: '3.14.2' })
    })
    await settle()
    const runId = worker.lastRunId()

    act(() => {
      worker.emit({
        type: 'request',
        id: 1,
        request: {
          kind: 'draw',
          command: {
            op: 'color',
            name: 'Result',
            rows: Uint32Array.of(1, 2),
            color: '#008000',
            cmap: null,
            values: null,
            vmin: null,
            vmax: null,
            reverse: false,
          },
        },
      })
    })
    await settle()
    // Drawn, but not shown until the input ends.
    expect(result.current.overlay).toBe(EMPTY_PYTHON_OVERLAY)
    expect(worker.sent).toContainEqual({ type: 'reply', id: 1, ok: true, value: null })

    act(() => {
      worker.emit({ type: 'done', id: runId, status: 'ok', display: null, error: null })
    })
    await act(async () => {
      await outcome
    })
    const drawn = result.current.overlay
    expect(drawn.cellCount).toBe(3)
    expect(drawn.layers.map((layer) => Array.from(layer.rows))).toEqual([[1, 2]])

    // An input that draws nothing leaves the overlay as it was.
    act(() => {
      outcome = session!.run('len(cells)')
    })
    await settle()
    act(() => {
      worker.emit({
        type: 'done',
        id: worker.lastRunId(),
        status: 'ok',
        display: '3',
        error: null,
      })
    })
    await act(async () => {
      await outcome
    })
    expect(result.current.overlay).toBe(drawn)

    // The legend clears a layer; another dataset drops them all.
    act(() => {
      result.current.clearLegendItem('color:Result')
    })
    expect(result.current.overlay).toBe(EMPTY_PYTHON_OVERLAY)
    rerender(input({ datasetUrl: 'https://example.test/b.h5ad', cells: cells(5) }))
    expect(result.current.overlay).toBe(EMPTY_PYTHON_OVERLAY)
  })
})
