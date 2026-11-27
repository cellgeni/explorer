import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { ReloadAppButton } from '../features/errors/ReloadAppButton'
import { APP_UPDATED_ACTION, isStaleChunkError } from '../features/errors/staleChunk'

// A part of the app loaded the first time it is shown (O21), such as Cell
// Query or Plots, so the start screen does not fetch it. While its chunk
// loads, a line says so. If the chunk is gone, as after a deploy replaced the
// app's files, the panel says the app was updated and offers Reload, as the
// rest of the app does (staleChunk.ts); an error of the panel's own offers
// Retry. `frame` wraps either, for a panel shown inside a drawer or the like.
export function LazyPanel({
  label,
  children,
  frame = unframed,
}: {
  // Names the panel: "Loading <label>…".
  readonly label: string
  readonly children: ReactNode
  readonly frame?: (content: ReactNode) => ReactNode
}) {
  return (
    <LazyPanelBoundary label={label} frame={frame}>
      <Suspense
        fallback={frame(
          <p className="lazy-panel-status" role="status">
            {`Loading ${label}…`}
          </p>,
        )}
      >
        {children}
      </Suspense>
    </LazyPanelBoundary>
  )
}

function unframed(content: ReactNode): ReactNode {
  return content
}

interface LazyPanelBoundaryProps {
  readonly label: string
  readonly frame: (content: ReactNode) => ReactNode
  readonly children: ReactNode
}

interface LazyPanelBoundaryState {
  readonly error: Error | null
}

class LazyPanelBoundary extends Component<
  LazyPanelBoundaryProps,
  LazyPanelBoundaryState
> {
  state: LazyPanelBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): LazyPanelBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.label} failed`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state

    if (error === null) {
      return this.props.children
    }

    return this.props.frame(
      <div className="lazy-panel-error" role="alert">
        {isStaleChunkError(error) ? (
          <>
            <p>{`${this.props.label} could not load. ${APP_UPDATED_ACTION}`}</p>
            <ReloadAppButton />
          </>
        ) : (
          <>
            <p>{`${this.props.label} failed: ${error.message}`}</p>
            <button
              type="button"
              className="secondary-action"
              title={`Show ${this.props.label} again`}
              onClick={() => {
                this.setState({ error: null })
              }}
            >
              Retry
            </button>
          </>
        )}
      </div>,
    )
  }
}
