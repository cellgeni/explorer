import { downloadBlob } from '../app-shell/appRuntimeModel'
import { isAbortError } from '../../utils/abort'
import { ScreenshotImageError } from './screenshotImage'
import {
  drawScreenshot,
  type DrawScreenshotOptions,
  type ScreenshotFileInfo,
  type ScreenshotOptions,
  type ScreenshotProgress,
  type ScreenshotSnapshot,
} from './screenshotRun'

// Runs screenshots (plan 27, task G), one at a time. App makes one runner
// and hands it to ViewerCore, which connects the snapshot of its view, and to
// the top bar's popover, which starts, cancels and retries it. The snapshot
// and the PNG stay in the runner's fields, out of React props.

export type ScreenshotRunState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly progress: ScreenshotProgress | null }
  | {
      readonly status: 'error'
      readonly message: string
      // A tile that could not be read: Retry reads it again.
      readonly retryable: boolean
    }
  | { readonly status: 'saved'; readonly fileName: string }

export type ScreenshotSource = () => ScreenshotSnapshot | null

const IDLE: ScreenshotRunState = { status: 'idle' }
// The view has kept still this long before its snapshot is taken (27,
// step 1), as the render cap waits before it draws the settled view.
export const SCREENSHOT_SETTLE_MS = 200

interface ScreenshotRequest {
  readonly options: ScreenshotOptions
  readonly file: ScreenshotFileInfo
}

export interface ScreenshotRunnerOptions {
  readonly draw?: typeof drawScreenshot
  readonly drawOptions?: Omit<DrawScreenshotOptions, 'signal' | 'onProgress'>
  readonly save?: (fileName: string, blob: Blob) => void
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
}

export class ScreenshotRunner {
  private source: ScreenshotSource | null = null
  private state: ScreenshotRunState = IDLE
  private readonly listeners = new Set<() => void>()
  private controller: AbortController | null = null
  private lastRequest: ScreenshotRequest | null = null

  constructor(private readonly runnerOptions: ScreenshotRunnerOptions = {}) {}

  // ViewerCore's view; the returned function disconnects it.
  connect(source: ScreenshotSource): () => void {
    this.source = source
    this.notify()
    return () => {
      if (this.source !== source) return
      this.source = null
      this.cancel()
      this.notify()
    }
  }

  get connected(): boolean {
    return this.source !== null
  }

  // The view as it is now, for the popover's size line and notes.
  preview(): ScreenshotSnapshot | null {
    return this.source?.() ?? null
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly getState = (): ScreenshotRunState => this.state

  start(options: ScreenshotOptions, file: ScreenshotFileInfo): void {
    if (this.state.status === 'running') return
    this.lastRequest = { options, file }
    void this.run({ options, file })
  }

  // Starts the last screenshot again, with new tile caches.
  retry(): void {
    if (this.lastRequest === null || this.state.status === 'running') return
    void this.run(this.lastRequest)
  }

  cancel(): void {
    if (this.controller === null) return
    this.controller.abort()
    this.controller = null
    this.setState(IDLE)
  }

  // Clears a message once it has been read.
  dismiss(): void {
    if (this.state.status === 'error' || this.state.status === 'saved') {
      this.setState(IDLE)
    }
  }

  private async run(request: ScreenshotRequest): Promise<void> {
    const controller = new AbortController()
    this.controller = controller
    this.setState({ status: 'running', progress: null })
    const current = () => this.controller === controller

    try {
      const snapshot = await this.settledSnapshot(controller.signal)
      const blob = await (this.runnerOptions.draw ?? drawScreenshot)(
        snapshot,
        request.options,
        request.file,
        {
          ...this.runnerOptions.drawOptions,
          signal: controller.signal,
          onProgress: (progress) => {
            if (current()) this.setState({ status: 'running', progress })
          },
        },
      )
      if (!current()) return
      ;(this.runnerOptions.save ?? downloadBlob)(request.file.fileName, blob)
      this.controller = null
      this.setState({ status: 'saved', fileName: request.file.fileName })
    } catch (error) {
      if (!current()) return
      this.controller = null
      if (isAbortError(error)) {
        this.setState(IDLE)
        return
      }
      this.setState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        retryable: error instanceof ScreenshotImageError,
      })
    }
  }

  // The view once it has kept still for SCREENSHOT_SETTLE_MS.
  private async settledSnapshot(signal: AbortSignal): Promise<ScreenshotSnapshot> {
    const now = this.runnerOptions.now ?? (() => performance.now())
    const sleep = this.runnerOptions.sleep ?? sleepMs

    for (;;) {
      signal.throwIfAborted()
      const snapshot = this.source?.() ?? null
      if (snapshot === null) throw new Error('There is no view to save.')
      const wait = SCREENSHOT_SETTLE_MS - (now() - snapshot.viewChangedAt)
      if (wait <= 0) return snapshot
      await sleep(wait)
    }
  }

  private setState(state: ScreenshotRunState): void {
    this.state = state
    this.notify()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// "Reading image tiles", "Drawing cells" or "Writing the PNG", for the
// loading list, which shows how far it has got beside it.
export function screenshotStageText(progress: ScreenshotProgress | null): string {
  if (progress === null) return 'Starting'
  return progress.stage === 'image'
    ? 'Reading image tiles'
    : progress.stage === 'cells'
      ? 'Drawing cells'
      : 'Writing the PNG'
}

// The stage and how far it has got, for the popover.
export function screenshotProgressText(progress: ScreenshotProgress | null): string {
  if (progress === null) return 'Starting'
  return `${screenshotStageText(progress)} · ${Math.floor((progress.done / Math.max(1, progress.total)) * 100).toString()}%`
}
