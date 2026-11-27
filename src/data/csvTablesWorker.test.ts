import { describe, expect, it } from 'vitest'
import { csvTablesHandler } from '../workers/csvTablesCore'
import type {
  CsvTablesWorkerRequest,
  CsvTablesWorkerResponse,
} from '../workers/csvTablesMessages'
import { parseAnalysisEmbeddingCsv } from './analysisEmbeddings'
import { csvTablesWorkerReaders, type CsvTablesWorkerLike } from './csvTablesWorker'
import { parseCustomAnnotationImport } from './customAnnotations'

// Since O18 an embedding's projection and an imported annotation file are
// parsed in a worker, which sends columns back. What the page makes of them
// must be what the main thread's parse gives.

const PROJECTION = [
  'Barcode,UMAP-1,UMAP-2',
  'cell-a,1.5,-2',
  // No coordinates: left out.
  'cell-b,,3',
  '"cell,c",0.25,1e3',
  '',
].join('\n')

const ANNOTATIONS = [
  'cell_id,cluster,score',
  'cell-a,T cell,0.5',
  'cell-b,B cell,',
  'cell-c,T cell,-1.25',
  "cell-d,'=B cell,7",
].join('\n')

describe('csvTablesWorkerReaders (O18)', () => {
  it('parses a projection in the worker into the same points', async () => {
    const worker = new FakeWorker()
    const columns = await csvTablesWorkerReaders(() => worker).embeddingColumns(
      PROJECTION,
      'umap',
    )

    expect(worker.requests).toEqual([
      { type: 'embedding', csv: PROJECTION, kind: 'umap' },
    ])
    expect(columns.ids).toEqual(['cell-a', 'cell,c'])
    expect(Array.from(columns.x)).toEqual([1.5, 0.25])
    expect(Array.from(columns.y)).toEqual([-2, 1000])
    expect(columns.missingColumns).toEqual([])
    expect(
      columns.ids.map((id, index) => ({ id, x: columns.x[index], y: columns.y[index] })),
    ).toEqual(parseAnalysisEmbeddingCsv(PROJECTION, 'umap'))
    expect(worker.transferred).toHaveLength(2)
    expect(worker.terminated).toBe(true)
  })

  it('names the columns a projection lacks', async () => {
    const columns = await csvTablesWorkerReaders(() => new FakeWorker()).embeddingColumns(
      'a,b,c\nx,1,2\n',
      'umap',
    )

    expect(columns.missingColumns).toEqual(['cell id', 'UMAP x', 'UMAP y'])
    expect(columns.ids).toEqual(['x'])
  })

  it('parses an annotation file in the worker into the same import', async () => {
    const worker = new FakeWorker()
    const parsed = await csvTablesWorkerReaders(() => worker).annotationImport(
      ANNOTATIONS,
      'labels.csv',
      'labels.csv 2',
    )

    expect(parsed).toEqual(
      parseCustomAnnotationImport(ANNOTATIONS, 'labels.csv', 'labels.csv 2'),
    )
    expect(parsed.metadataTracks[0]?.values).toEqual([
      { cellId: 'cell-a', value: 0.5 },
      { cellId: 'cell-c', value: -1.25 },
      { cellId: 'cell-d', value: 7 },
    ])
    // The track's values came back as a transferred number column.
    expect(worker.transferred).toHaveLength(1)
  })

  it("rejects with the parse's error name", async () => {
    await expect(
      csvTablesWorkerReaders(() => new FakeWorker()).annotationImport(
        '{"not": "annotations"',
        'labels.json',
        'labels.json',
      ),
    ).rejects.toMatchObject({ name: 'AnnotationFileFormatError' })
  })

  it('parses on this thread when the worker fails to run', async () => {
    const worker = new FakeWorker({ fail: true })
    const columns = await csvTablesWorkerReaders(() => worker).embeddingColumns(
      PROJECTION,
      'umap',
    )

    expect(columns.ids).toEqual(['cell-a', 'cell,c'])
    expect(worker.terminated).toBe(true)
  })

  it('terminates the worker on abort', async () => {
    const worker = new FakeWorker({ silent: true })
    const controller = new AbortController()
    const read = csvTablesWorkerReaders(() => worker).embeddingColumns(
      PROJECTION,
      'umap',
      controller.signal,
    )

    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })
})

// Runs the worker's handler across a structured clone, as a real worker
// would. `fail` raises an error event instead; `silent` never answers.
class FakeWorker implements CsvTablesWorkerLike {
  onmessage: ((event: MessageEvent<CsvTablesWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: CsvTablesWorkerRequest[] = []
  readonly transferred: Transferable[] = []
  terminated = false
  private readonly handle = csvTablesHandler((response, transfer) => {
    this.transferred.push(...transfer)
    const data = structuredClone(response, { transfer })
    queueMicrotask(() => {
      if (!this.terminated) {
        this.onmessage?.({ data } as MessageEvent<CsvTablesWorkerResponse>)
      }
    })
  })

  constructor(private readonly options: { fail?: boolean; silent?: boolean } = {}) {}

  postMessage(message: CsvTablesWorkerRequest): void {
    const data = structuredClone(message)
    this.requests.push(data)

    if (this.options.silent === true) {
      return
    }

    if (this.options.fail === true) {
      queueMicrotask(() => {
        this.onerror?.({
          message: 'worker failed',
          preventDefault: () => undefined,
        } as ErrorEvent)
      })
      return
    }

    this.handle(data)
  }

  terminate(): void {
    this.terminated = true
  }
}
