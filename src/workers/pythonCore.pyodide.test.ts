// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { loadPyodide, type PyodideAPI } from 'pyodide'
import { beforeAll, describe, expect, it } from 'vitest'
import { pyodidePackageWheel } from '../../scripts/pyodideRuntime'
import { micrometers } from '../data/coords'
import { lazyIdLookup } from '../data/lazyIdLookup'
import type { OverviewCellDatum } from '../rendering/deckLayerTypes'
import { CellImageMeasurements } from '../features/query/cellImageMeasurements'
import { CellColumnReader } from '../features/query/cellColumnReader'
import {
  overviewCellColumns,
  type CellQueryColumn,
} from '../features/query/cellQueryModel'
import {
  answerPythonRequest,
  type PythonDataContext,
} from '../features/python/pythonData'
import { pythonDataError } from '../features/python/pythonSession'
import { PythonLayerStore } from '../features/python/pythonLayerStore'
import { composePythonOverlay } from '../rendering/pythonOverlay'
import { createPythonCore, type PythonCore } from './pythonCore'
import {
  parsePythonDataRequest,
  type PythonDrawCommand,
  type PythonWorkerResponse,
} from './pythonMessages'

// The console's worker with the real Pyodide and NumPy (plan 29-D): the
// runner, the explorer package and the protocol, with the main thread's
// provider answering. Python's reads block with run_sync, which needs
// WebAssembly JSPI; Node has it from 25, and 24 with
// --experimental-wasm-jspi.

const jspi = typeof (WebAssembly as { Suspending?: unknown }).Suspending === 'function'
const root = path.resolve(import.meta.dirname, '../..')
const pythonDir = path.join(root, 'src', 'python')

function pythonSources(): Record<string, string> {
  const sources: Record<string, string> = {
    'explorer_runtime.py': readFileSync(
      path.join(pythonDir, 'runtime', 'explorer_runtime.py'),
      'utf8',
    ),
  }
  for (const file of readdirSync(path.join(pythonDir, 'explorer'))) {
    if (file.endsWith('.py')) {
      sources[`explorer/${file}`] = readFileSync(
        path.join(pythonDir, 'explorer', file),
        'utf8',
      )
    }
  }
  return sources
}

// A 3 × 3 grid of cells 100 µm apart, and gene CD3E rising along x.
const CELLS: readonly OverviewCellDatum[] = Array.from({ length: 9 }, (_, index) => ({
  id: `cell-${index.toString()}`,
  position: [(index % 3) * 100, -Math.floor(index / 3) * 100, 0],
  radiusPixels: 2,
  fillColor: [0, 0, 0, 255],
  cellArea: 40 + index * 5,
}))
const AREA: CellQueryColumn = {
  id: 'cell:area',
  label: 'Cell area',
  kind: 'number',
  group: 'Cell',
  source: { kind: 'cell', field: 'cellArea' },
}

function testContext(draws: PythonDrawCommand[]): PythonDataContext {
  const url = 'https://example.test/grid.h5ad'
  const reader = new CellColumnReader({
    loadSetAnnotations: async () => [],
    loadMetadataTrackValues: async () => [],
    appendDebugEvent: () => undefined,
  })
  reader.sync(url, { setGroupIds: [], trackIds: [] }, false)
  return {
    datasetUrl: url,
    datasetName: 'grid.h5ad',
    cells: CELLS,
    elementNoun: 'cells',
    columns: [AREA],
    columnReader: reader,
    columnContext: {
      datasetUrl: url,
      cells: CELLS,
      placedCellIds: lazyIdLookup(
        CELLS,
        (cell) => cell.id,
        () => true,
      ),
      cellColumns: overviewCellColumns(CELLS),
      annotations: [],
      savedSelections: [],
      metadataTracks: [],
      imageSnapshot: new CellImageMeasurements().getSnapshot(),
      imageOverLimit: new Map(),
    },
    geneNames: ['CD3E', 'Y'],
    genes: async () => ({
      read: async (gene) =>
        Float32Array.from(CELLS, (cell) =>
          gene === 'CD3E' ? (cell.position[0] ?? 0) / 4 : 120,
        ),
      layers: async () => ['counts'],
    }),
    savedSelections: [
      {
        id: 'r1',
        name: 'ROI 1',
        color: '#fff',
        visible: true,
        selection: {
          kind: 'box',
          bbox: {
            minX: micrometers(-10),
            minY: micrometers(-10),
            maxX: micrometers(150),
            maxY: micrometers(150),
          },
        },
      },
    ],
    currentSelection: null,
    features: [],
    view: { center: [100, 100], bounds: [0, 0, 200, 200] },
    selectedCellId: 'cell-4',
    draw: (command) => {
      draws.push(command)
    },
  }
}

interface Harness {
  readonly core: PythonCore
  readonly messages: PythonWorkerResponse[]
  readonly draws: PythonDrawCommand[]
  readonly run: (code: string) => Promise<PythonWorkerResponse & { type: 'done' }>
}

async function startHarness(): Promise<Harness> {
  const wheel = await pythonDirWheel()
  const messages: PythonWorkerResponse[] = []
  const draws: PythonDrawCommand[] = []
  const waiters: ((message: PythonWorkerResponse) => void)[] = []
  let nextId = 1
  const context = testContext(draws)
  let core: PythonCore | null = null

  const post = (message: PythonWorkerResponse) => {
    messages.push(message)
    if (message.type === 'request') {
      const request = parsePythonDataRequest(message.request)
      const answer =
        request === null
          ? Promise.reject(new Error('Unknown request'))
          : answerPythonRequest(request, () => context)
      answer.then(
        (reply) => {
          core?.handle({ type: 'reply', id: message.id, ok: true, value: reply.value })
        },
        (error: unknown) => {
          core?.handle({
            type: 'reply',
            id: message.id,
            ok: false,
            error: pythonDataError(error),
          })
        },
      )
    }
    for (const waiter of waiters.splice(0)) waiter(message)
  }
  const next = (match: (message: PythonWorkerResponse) => boolean) =>
    new Promise<PythonWorkerResponse>((resolve) => {
      const found = messages.find(match)
      if (found !== undefined) {
        resolve(found)
        return
      }
      const wait = (message: PythonWorkerResponse) => {
        if (match(message)) resolve(message)
        else waiters.push(wait)
      }
      waiters.push(wait)
    })

  core = createPythonCore({
    post,
    loadPyodide: (options) =>
      loadPyodide({
        ...options,
        packageCacheDir: path.dirname(wheel),
      }) as Promise<PyodideAPI>,
    sources: pythonSources(),
  })
  core.handle({
    type: 'start',
    indexUrl: `${path.join(root, 'node_modules', 'pyodide')}/`,
    interruptBuffer: null,
  })
  const started = await next(
    (message) => message.type === 'ready' || message.type === 'failed',
  )
  if (started.type === 'failed') throw new Error(started.message)

  return {
    core,
    messages,
    draws,
    run: async (code) => {
      const id = nextId
      nextId += 1
      core?.handle({ type: 'run', id, code })
      return (await next(
        (message) => message.type === 'done' && message.id === id,
      )) as PythonWorkerResponse & { type: 'done' }
    },
  }
}

async function pythonDirWheel(): Promise<string> {
  return (await pyodidePackageWheel('numpy')).path
}

describe.skipIf(!jspi)('the Python worker with Pyodide', () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness()
  }, 120_000)

  it('runs inputs, prints values and keeps variables', async () => {
    expect(await harness.run('x = 2 + 3')).toMatchObject({ status: 'ok', display: null })
    expect(await harness.run('x * 10')).toMatchObject({ status: 'ok', display: '50' })
    expect(await harness.run('for i in range(2):')).toMatchObject({
      status: 'incomplete',
    })
    await harness.run('print("hello")')
    expect(harness.messages).toContainEqual({
      type: 'output',
      stream: 'stdout',
      text: 'hello',
    })
  })

  it('reads the dataset through the app, blocking on each reply', async () => {
    expect(await harness.run('len(cells)')).toMatchObject({ display: '9' })
    expect(await harness.run('cells.y[3:6].tolist()')).toMatchObject({
      display: '[100.0, 100.0, 100.0]',
    })
    expect(await harness.run('float(cells.area.sum())')).toMatchObject({
      display: '540.0',
    })
    expect(await harness.run('cells.selected')).toMatchObject({ display: '4' })
    expect(await harness.run('cells.gene("CD3E") > 20')).toMatchObject({
      display: 'mask: 6 of 9 cells',
    })
  })

  it('runs the plan’s two requests, sending their layers to the app', async () => {
    const first = await harness.run(
      [
        'x0, y0 = (0.0, 0.0)',
        'd = np.hypot(cells.x - x0, cells.y - y0)',
        'near = (cells.gene("CD3E") > 20) & (d <= 250)',
        'color(near, "green", by=d, reverse=True)',
      ].join('\n'),
    )
    expect(first).toMatchObject({ status: 'ok', error: null })
    const second = await harness.run(
      [
        'a = rois["ROI 1"].contains(cells) & (cells.area > 50)',
        'b = rois["ROI 1"].contains(cells) & (cells.gene("Y") > 99)',
        'color(a | b, "orange", name="ROI picks")',
        'others("hide")',
      ].join('\n'),
    )
    expect(second).toMatchObject({ status: 'ok', error: null })

    const [green, orange, hide] = harness.draws
    expect(green).toMatchObject({
      op: 'color',
      name: 'Result',
      color: '#008000',
      reverse: true,
    })
    // Cells 1, 2, 4, 5, 7: x over 80 µm and within 250 µm of the origin.
    expect(green?.op === 'color' && Array.from(green.rows)).toEqual([1, 2, 4, 5, 7])
    expect(orange?.op === 'color' && Array.from(orange.rows)).toEqual([0, 1, 3, 4])
    expect(hide).toEqual({ op: 'others', mode: 'hide' })

    // As the canvas draws them: the ROI picks over the ramp, the rest hidden.
    const store = new PythonLayerStore()
    for (const draw of harness.draws) store.apply(draw, 9)
    store.flush()
    const composed = composePythonOverlay(store.getSnapshot(), 9)
    const drawnRows = [...Array(9).keys()].filter((row) => composed.hidden?.[row] === 0)
    expect(drawnRows).toEqual([0, 1, 2, 3, 4, 5, 7])
    // Orange (#ffa500) wins where both layers hold a cell.
    expect(Array.from(composed.colors?.slice(4, 8) ?? [])).toEqual([255, 165, 0, 255])
    expect(Array.from(composed.colors?.slice(8, 11) ?? [])).not.toEqual([255, 165, 0])
  })

  it('shows errors as Python raises them, with the app’s message', async () => {
    const result = await harness.run('cells.gene("CD3E", layer="spliced")')
    expect(result.status).toBe('error')
    expect(result.error).toContain('ValueError')
    expect(result.error).toContain('counts')
    const unknown = await harness.run('cells["nope"]')
    expect(unknown.error).toContain('KeyError')
  })

  it('completes names, columns and genes', async () => {
    harness.core.handle({ type: 'complete', id: 99, code: 'cells.ge', cursor: 8 })
    harness.core.handle({ type: 'complete', id: 100, code: 'cells["Ce', cursor: 9 })
    const replies = await new Promise<PythonWorkerResponse[]>((resolve) => {
      const check = () => {
        const found = harness.messages.filter(
          (message) =>
            message.type === 'completions' && (message.id === 99 || message.id === 100),
        )
        if (found.length === 2) resolve(found)
        else setTimeout(check, 10)
      }
      check()
    })
    expect(replies).toContainEqual(
      expect.objectContaining({
        id: 99,
        start: 0,
        items: expect.arrayContaining(['cells.gene(']),
      }),
    )
    expect(replies).toContainEqual(
      expect.objectContaining({ id: 100, start: 7, items: ['Cell area'] }),
    )
  })
})
