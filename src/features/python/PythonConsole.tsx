import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { Button } from '../../components/ui'
import { addPythonHistory, readPythonHistory, stepPythonHistory } from './pythonHistory'
import { createPythonPrompt, type PythonPrompt } from './pythonPrompt'
import { formatPickedPoint, type PythonConsoleModel } from './pythonConsoleModel'
import {
  clampPromptHeight,
  MIN_PROMPT_HEIGHT,
  PROMPT_HEIGHT_STEP,
  readPromptHeight,
  writePromptHeight,
} from './pythonPromptHeight'
import type { PythonLogEntry } from './pythonSession'

// The Python console (plan 29-D11): the output above, the prompt below, and
// Run, Stop, Pick point and Clear. Loaded with the window, with CodeMirror.

interface HistoryState {
  entries: readonly string[]
  cursor: { index: number; draft: string }
}

// The history, read from storage when first needed.
function historyOf(ref: { current: HistoryState | null }): HistoryState {
  if (ref.current === null) {
    const entries = readPythonHistory()
    ref.current = { entries, cursor: { index: entries.length, draft: '' } }
  }
  return ref.current
}

function rememberInput(ref: { current: HistoryState | null }, code: string): void {
  const history = historyOf(ref)
  history.entries = addPythonHistory(history.entries, code)
  history.cursor = { index: history.entries.length, draft: '' }
}

function promptLines(text: string): string {
  return text
    .split('\n')
    .map((line, index) => `${index === 0 ? '>>> ' : '... '}${line}`)
    .join('\n')
}

export function PythonConsole({ model }: { readonly model: PythonConsoleModel }) {
  const { session, picking, onPickingChange, pickedPoint } = model
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )
  const promptHost = useRef<HTMLDivElement>(null)
  const prompt = useRef<PythonPrompt | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HistoryState | null>(null)
  const [promptReady, setPromptReady] = useState(false)
  const consoleRef = useRef<HTMLDivElement>(null)
  // Null: the input grows with its text, up to 40% of the window.
  const [promptHeight, setPromptHeight] = useState<number | null>(() =>
    readPromptHeight(),
  )
  // The console's height, for the separator's range.
  const [consoleHeight, setConsoleHeight] = useState(0)
  useEffect(() => {
    const element = consoleRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      setConsoleHeight(Math.round(entry?.contentRect.height ?? 0))
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])
  const drag = useRef<{ readonly startY: number; readonly startHeight: number } | null>(
    null,
  )

  const resizePrompt = (height: number | null) => {
    const available = consoleRef.current?.getBoundingClientRect().height ?? 0
    const next = height === null ? null : clampPromptHeight(height, available)
    setPromptHeight(next)
    writePromptHeight(next)
  }
  const currentPromptHeight = () =>
    promptHost.current?.getBoundingClientRect().height ?? promptHeight ?? 0

  const onSplitterPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { startY: event.clientY, startHeight: currentPromptHeight() }
  }
  const onSplitterPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (start === null) return
    // Up makes the input taller.
    resizePrompt(start.startHeight - (event.clientY - start.startY))
  }
  const onSplitterPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }
  const onSplitterKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowUp'
        ? PROMPT_HEIGHT_STEP
        : event.key === 'ArrowDown'
          ? -PROMPT_HEIGHT_STEP
          : null
    if (step !== null) {
      event.preventDefault()
      resizePrompt(currentPromptHeight() + step)
    } else if (event.key === 'Home' || event.key === 'Enter') {
      event.preventDefault()
      resizePrompt(null)
    }
  }

  // Python starts the first time the window opens.
  useEffect(() => {
    session.start()
  }, [session])

  useEffect(() => {
    const host = promptHost.current
    if (host === null) return
    const created = createPythonPrompt(
      host,
      {
        onSubmit: async (code) => {
          const outcome = await session.run(code)
          if (outcome === 'incomplete') return 'incomplete'
          rememberInput(historyRef, code)
          return 'done'
        },
        onHistory: (direction, text) => {
          const current = historyOf(historyRef)
          const step = stepPythonHistory(current.entries, current.cursor, text, direction)
          if (step === null) return null
          current.cursor = { ...step.cursor }
          return step.text
        },
        complete: (code, cursor) => session.complete(code, cursor),
      },
      'Python input',
    )
    prompt.current = created
    setPromptReady(true)
    return () => {
      created.destroy()
      prompt.current = null
    }
  }, [session])

  // A point picked on the canvas goes in at the cursor.
  const insertedPoint = useRef<number | null>(pickedPoint?.id ?? null)
  useEffect(() => {
    if (pickedPoint === null || insertedPoint.current === pickedPoint.id) return
    insertedPoint.current = pickedPoint.id
    prompt.current?.insertAtCursor(formatPickedPoint(pickedPoint))
  }, [pickedPoint, promptReady])

  // The newest output stays in view.
  useEffect(() => {
    const log = logRef.current
    if (log !== null) log.scrollTop = log.scrollHeight
  }, [snapshot.log])

  const unavailable = snapshot.status === 'unsupported' || snapshot.status === 'failed'
  const running = snapshot.status === 'running'
  const loading = snapshot.status === 'loading'

  const run = () => {
    const code = prompt.current?.text() ?? ''
    if (code.trim() === '') return
    void session.run(code).then((outcome) => {
      if (outcome === 'incomplete') return
      rememberInput(historyRef, code)
      prompt.current?.setText('')
    })
    prompt.current?.focus()
  }

  return (
    <div className="python-console" ref={consoleRef}>
      <div
        ref={logRef}
        className="python-log"
        role="log"
        aria-live="polite"
        aria-label="Python output"
        tabIndex={0}
      >
        {snapshot.log.length === 0 && !unavailable ? (
          <p className="python-log-hint">
            {loading
              ? `${snapshot.progress ?? 'Starting Python'}… The first start downloads about 9 MB.`
              : 'cells, rois and view hold the open dataset; color, highlight and show draw on the canvas. NumPy is np.'}
          </p>
        ) : null}
        {snapshot.log.map((entry) => (
          <PythonLogLine key={entry.id} entry={entry} />
        ))}
        {unavailable ? (
          <p className="python-log-message" role="alert">
            {snapshot.message}
          </p>
        ) : null}
      </div>
      {/* Drags the input taller or shorter, for functions and loops. */}
      <div
        className="python-splitter"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Input height"
        aria-valuemin={MIN_PROMPT_HEIGHT}
        aria-valuemax={clampPromptHeight(Number.MAX_SAFE_INTEGER, consoleHeight)}
        aria-valuenow={promptHeight ?? MIN_PROMPT_HEIGHT}
        aria-valuetext={
          promptHeight === null ? 'Fits the input' : `${promptHeight} pixels`
        }
        title="Drag, or press Up and Down, to resize the input; double-click or Home to fit it"
        tabIndex={0}
        hidden={unavailable}
        onPointerDown={onSplitterPointerDown}
        onPointerMove={onSplitterPointerMove}
        onPointerUp={onSplitterPointerUp}
        onPointerCancel={onSplitterPointerUp}
        onDoubleClick={() => {
          resizePrompt(null)
        }}
        onKeyDown={onSplitterKeyDown}
      />
      <div
        className="python-prompt"
        ref={promptHost}
        hidden={unavailable}
        style={
          promptHeight === null
            ? undefined
            : { height: `${promptHeight}px`, maxHeight: 'none' }
        }
      />
      <div className="python-actions">
        <Button
          title="Run the input (Enter); Shift+Enter adds a line"
          variant="primary"
          disabled={unavailable}
          onClick={run}
        >
          Run
        </Button>
        <Button
          title="Stop the input running. Without cross-origin isolation Python restarts and its variables are lost."
          disabled={!running && !loading}
          onClick={() => {
            session.stop()
          }}
        >
          Stop
        </Button>
        <Button
          title={
            picking
              ? 'Cancel picking a point'
              : 'Click the canvas to write that point (µm) at the cursor'
          }
          aria-pressed={picking}
          disabled={unavailable}
          onClick={() => {
            onPickingChange(!picking)
          }}
        >
          Pick Point
        </Button>
        <Button
          title="Clear the output; variables stay"
          variant="ghost"
          disabled={snapshot.log.length === 0}
          onClick={() => {
            session.clearLog()
            prompt.current?.focus()
          }}
        >
          Clear
        </Button>
        {snapshot.status === 'failed' ? (
          <Button
            title="Start Python again"
            onClick={() => {
              session.start()
            }}
          >
            Try Again
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function PythonLogLine({ entry }: { readonly entry: PythonLogEntry }) {
  return (
    <pre className={`python-log-entry python-log-${entry.kind}`}>
      {entry.kind === 'input' ? promptLines(entry.text) : entry.text}
    </pre>
  )
}
