import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ReloadAppButton } from '../features/errors/ReloadAppButton'
import { APP_UPDATED_ACTION, isStaleChunkError } from '../features/errors/staleChunk'

interface AppErrorBoundaryProps {
  readonly children: ReactNode
}

interface AppErrorBoundaryState {
  readonly error: Error | null
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application error', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children
    }

    const updated = isStaleChunkError(this.state.error)

    return (
      <main className="app-shell app-error-shell">
        <section
          className="app-error-boundary"
          role="alert"
          aria-label="Application error"
        >
          <h1>{updated ? 'The app was updated' : 'Application error'}</h1>
          <p>{this.state.error.message}</p>
          {updated ? (
            <>
              <p>{APP_UPDATED_ACTION}</p>
              <ReloadAppButton />
            </>
          ) : null}
          <button
            type="button"
            title="Retry application"
            onClick={() => {
              this.setState({ error: null })
            }}
          >
            Retry
          </button>
        </section>
      </main>
    )
  }
}
