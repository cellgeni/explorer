import { lazy, Suspense, useSyncExternalStore } from 'react'
import type { PythonConsoleModel } from '../python/pythonConsoleModel'
import { FloatingWindow, type FloatingWindowSize } from './FloatingWindow'
import { PYTHON_WINDOW_MIN_SIZE, PYTHON_WINDOW_SIZE } from './floatingWindowModel'

// The console and CodeMirror load with the window, not with the app.
const PythonConsole = lazy(async () => {
  const module = await import('../python/PythonConsole')
  return { default: module.PythonConsole }
})

// The Python console (plan 29-D11), opened from the top bar's Python toggle,
// to the left of the other open windows.
export function PythonWindow({
  python,
  open,
  onClose,
  fullWidth = false,
  rightOffset,
  onSizeChange,
  front = false,
  onActivate,
}: {
  readonly python: PythonConsoleModel
  readonly open: boolean
  readonly onClose: () => void
  readonly fullWidth?: boolean | undefined
  readonly rightOffset?: number | undefined
  readonly onSizeChange?: ((size: FloatingWindowSize) => void) | undefined
  readonly front?: boolean | undefined
  readonly onActivate?: (() => void) | undefined
}) {
  const { session } = python
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )
  return (
    <FloatingWindow
      title="Python"
      status={pythonWindowStatus(snapshot)}
      loading={snapshot.status === 'loading' || snapshot.status === 'running'}
      closeTitle="Close the Python console"
      controlName="python console"
      className="shell-python"
      bodyClassName="shell-python-body"
      defaultSize={PYTHON_WINDOW_SIZE}
      minSize={PYTHON_WINDOW_MIN_SIZE}
      open={open}
      onClose={onClose}
      fullWidth={fullWidth}
      rightOffset={rightOffset}
      onSizeChange={onSizeChange}
      front={front}
      onActivate={onActivate}
    >
      {/* Kept mounted once opened, as the prompt holds the input being
          written; the window hides it while closed. */}
      <Suspense fallback={<p className="python-log-hint">Loading the console…</p>}>
        <PythonConsole model={python} />
      </Suspense>
    </FloatingWindow>
  )
}

function pythonWindowStatus(
  snapshot: ReturnType<PythonConsoleModel['session']['getSnapshot']>,
) {
  switch (snapshot.status) {
    case 'idle':
      return 'Python'
    case 'unsupported':
      return 'Needs Chrome or Edge'
    case 'loading':
      return snapshot.progress ?? 'Starting Python'
    case 'running':
      return 'Running'
    case 'failed':
      return 'Python could not start'
    case 'ready':
      return snapshot.pythonVersion === null
        ? 'Python'
        : `Python ${snapshot.pythonVersion}`
  }
}
