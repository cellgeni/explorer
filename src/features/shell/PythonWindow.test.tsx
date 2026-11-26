import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  testAnnotationsSectionModel,
  testCellQueryModel,
  testCellsSectionModel,
  testDatasetInfoModel,
  testDatasetLibraryModel,
  testEmbeddingModel,
  testImageSectionModel,
  testPlotsModel,
  testTopBarModel,
  testTranscriptsSectionModel,
  testViewSettingsModel,
} from '../../test/sectionModels'
import type {
  PythonWorkerRequest,
  PythonWorkerResponse,
} from '../../workers/pythonMessages'
import type { CardStackModel } from '../cards/cardModels'
import type { PythonConsoleModel } from '../python/pythonConsoleModel'
import {
  PYTHON_UNSUPPORTED_MESSAGE,
  PythonSession,
  type PythonWorkerLike,
} from '../python/pythonSession'
import { DEFAULT_SHELL_PANELS, type ShellPanelState } from './shellLinkModel'
import { ShellLayout } from './ShellLayout'

const NO_CARDS: CardStackModel = {
  selection: null,
  cell: null,
  transcript: null,
  magicLens: null,
}

class FakeWorker implements PythonWorkerLike {
  onmessage: ((event: MessageEvent<PythonWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly sent: PythonWorkerRequest[] = []

  postMessage(message: PythonWorkerRequest): void {
    this.sent.push(message)
  }

  terminate(): void {}

  emit(message: PythonWorkerResponse): void {
    act(() => {
      this.onmessage?.({ data: message } as MessageEvent<PythonWorkerResponse>)
    })
  }
}

function stubWideScreen() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function setup(options: { supported?: boolean } = {}) {
  const workers: FakeWorker[] = []
  const session = new PythonSession({
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    indexUrl: '/pyodide/',
    data: { answer: async () => ({ value: null }) },
    supported: options.supported ?? true,
  })
  const onPickingChange = vi.fn()

  function Harness({ initial }: { readonly initial: ShellPanelState }) {
    const [panels, setPanels] = useState(initial)
    const python: PythonConsoleModel = {
      session,
      picking: false,
      onPickingChange,
      pickedPoint: null,
    }
    return (
      <ShellLayout
        topBar={testTopBarModel()}
        info={testDatasetInfoModel()}
        library={testDatasetLibraryModel()}
        settings={testViewSettingsModel()}
        layerPanel={{ sections: [] }}
        image={testImageSectionModel()}
        cells={testCellsSectionModel()}
        transcripts={testTranscriptsSectionModel()}
        annotations={testAnnotationsSectionModel()}
        cards={NO_CARDS}
        embedding={testEmbeddingModel()}
        plots={testPlotsModel()}
        query={testCellQueryModel()}
        python={python}
        panels={panels}
        onPanelsChange={setPanels}
      >
        <div>canvas</div>
      </ShellLayout>
    )
  }
  return { session, workers, onPickingChange, Harness }
}

function pythonWindow(): HTMLElement {
  return screen.getByRole('region', { name: 'Python' })
}

// CodeMirror measures text; jsdom has no layout.
function stubTextLayout() {
  const empty = {
    getClientRects: () => [] as unknown as DOMRectList,
    getBoundingClientRect: () => new DOMRect(),
  }
  Object.assign(Range.prototype, empty)
}

// Types into the prompt as CodeMirror's input would.
function typeInto(input: HTMLElement, text: string) {
  const view = EditorView.findFromDOM(input)
  if (view === null) throw new Error('No editor')
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  })
}

describe('the Python window (plan 29-D11)', () => {
  beforeAll(() => {
    stubTextLayout()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens from the top bar left of Cell Query, and starts Python', async () => {
    stubWideScreen()
    const { Harness, workers } = setup()
    render(<Harness initial={{ ...DEFAULT_SHELL_PANELS, queryOpen: true }} />)
    expect(workers).toHaveLength(0)

    const toggles = screen.getByRole('group', { name: 'Panels' })
    fireEvent.click(within(toggles).getByRole('button', { name: 'Python' }))

    expect(pythonWindow()).toBeVisible()
    // Past the 520 px Cell Query window, with gaps.
    expect(pythonWindow().style.getPropertyValue('--floating-right')).toBe('540px')
    expect(pythonWindow().style.width).toBe('560px')
    await waitFor(() => {
      expect(workers).toHaveLength(1)
    })
    expect(
      await within(pythonWindow()).findByText(/The first start downloads about 9 MB/),
    ).toBeVisible()
  })

  it('runs an input, logs it above its output, and clears the prompt', async () => {
    stubWideScreen()
    const { Harness, workers } = setup()
    render(<Harness initial={{ ...DEFAULT_SHELL_PANELS, pythonOpen: true }} />)
    const input = await within(pythonWindow()).findByRole('textbox', {
      name: 'Python input',
    })
    const worker = workers[0]!
    worker.emit({ type: 'ready', pythonVersion: '3.14.2' })
    expect(within(pythonWindow()).getByText('Python 3.14.2')).toBeVisible()

    typeInto(input, 'len(cells)')
    fireEvent.click(within(pythonWindow()).getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(worker.sent.some((message) => message.type === 'run')).toBe(true)
    })
    const run = worker.sent.find((message) => message.type === 'run')
    if (run?.type !== 'run') throw new Error('No run sent')
    expect(run.code).toBe('len(cells)')

    worker.emit({ type: 'started', id: run.id })
    worker.emit({
      type: 'done',
      id: run.id,
      status: 'ok',
      display: '1414155',
      error: null,
    })

    const log = within(pythonWindow()).getByRole('log', { name: 'Python output' })
    await waitFor(() => {
      expect(log).toHaveTextContent('>>> len(cells)')
    })
    expect(log).toHaveTextContent('1414155')
    await waitFor(() => {
      expect(EditorView.findFromDOM(input)?.state.doc.toString()).toBe('')
    })
  })

  it('says the console needs Chrome or Edge where JSPI is missing', async () => {
    stubWideScreen()
    const { Harness, workers } = setup({ supported: false })
    render(<Harness initial={{ ...DEFAULT_SHELL_PANELS, pythonOpen: true }} />)
    expect(
      await within(pythonWindow()).findByText(PYTHON_UNSUPPORTED_MESSAGE),
    ).toBeVisible()
    expect(within(pythonWindow()).getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(workers).toHaveLength(0)
  })

  it('arms Pick Point', async () => {
    stubWideScreen()
    const { Harness, onPickingChange } = setup()
    render(<Harness initial={{ ...DEFAULT_SHELL_PANELS, pythonOpen: true }} />)
    fireEvent.click(
      await within(pythonWindow()).findByRole('button', { name: 'Pick Point' }),
    )
    expect(onPickingChange).toHaveBeenCalledWith(true)
  })
})
