import { Component, type ErrorInfo, type ReactNode } from 'react'

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

    return (
      <main className="app-shell app-error-shell">
        <section
          className="app-error-boundary"
          role="alert"
          aria-label="Application error"
        >
          <h1>Application error</h1>
          <p>{this.state.error.message}</p>
          <button
            type="button"
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
