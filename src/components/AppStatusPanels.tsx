import {
  summarizeDatasetDiagnostics,
  type DatasetDiagnosticsReport,
} from '../data/datasetDiagnostics'

interface CellFeatureMatrixCompatibilityNoticeState {
  readonly status: string
  readonly hasCellMajorCsc?: boolean
}

interface StructuredLoadErrorSummary {
  readonly source: string
  readonly code: string
  readonly title: string
  readonly message: string
  readonly action: string
  readonly detail?: string
}

type DatasetDiagnosticsPanelState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly report: DatasetDiagnosticsReport
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: { readonly title: string }
    }

export interface LoadingTaskSummary {
  readonly id: string
  readonly label: string
  readonly detail?: string
}

interface ActivityLogEntry {
  readonly id: number
  readonly timestamp: number
  readonly message: string
}

export function DownloadIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 19h14" />
    </svg>
  )
}

export function CellFeatureMatrixCompatibilityNotice({
  state,
}: {
  readonly state: CellFeatureMatrixCompatibilityNoticeState
}) {
  if (state.status !== 'ready' || state.hasCellMajorCsc) {
    return null
  }

  return (
    <section
      className="cell-feature-matrix-notice"
      role="status"
      aria-label="Cell-feature matrix warning"
    >
      <h2>Matrix Warning</h2>
      <p>
        <code>cell_feature_matrix.zarr.zip</code> is not in CSC format. Selected-gene
        reads may use the older feature-major Zarr layout; ROI gene stats will fall back
        to <code>cell_feature_matrix.h5</code>.
      </p>
    </section>
  )
}

export function ErrorSummary({
  errors,
}: {
  readonly errors: readonly StructuredLoadErrorSummary[]
}) {
  if (errors.length === 0) {
    return null
  }

  return (
    <section className="error-summary" role="alert" aria-label="Load issues">
      <h2>Issues</h2>
      <ul>
        {errors.map((error) => (
          <li key={`${error.source}:${error.code}:${error.message}`}>
            <div className="error-summary-heading">
              <strong>{error.source}</strong>
              <span>{error.title}</span>
            </div>
            <p>{error.message}</p>
            <p>{error.action}</p>
            {error.detail === undefined ? null : <p>{error.detail}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function DatasetDiagnosticsPanel({
  state,
}: {
  readonly state: DatasetDiagnosticsPanelState
}) {
  if (state.status === 'idle') {
    return null
  }

  if (state.status === 'loading') {
    return (
      <section className="dataset-diagnostics-panel" aria-label="Dataset diagnostics">
        <h2>Diagnostics</h2>
        <p role="status">Running checks</p>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section className="dataset-diagnostics-panel" aria-label="Dataset diagnostics">
        <h2>Diagnostics</h2>
        <p>{state.error.title}</p>
      </section>
    )
  }

  return (
    <section className="dataset-diagnostics-panel" aria-label="Dataset diagnostics">
      <div className="dataset-diagnostics-heading">
        <h2>Diagnostics</h2>
        <span>{summarizeDatasetDiagnostics(state.report)}</span>
      </div>
      <ol>
        {state.report.checks.map((check) => (
          <li key={check.id} className={`diagnostic-check-${check.status}`}>
            <span>{check.label}</span>
            <strong>{check.status}</strong>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function LoadingIndicator({
  tasks,
}: {
  readonly tasks: readonly LoadingTaskSummary[]
}) {
  if (tasks.length === 0) {
    return null
  }

  const primaryTask = tasks[0]
  const secondaryTasks = tasks.slice(1)

  if (primaryTask === undefined) {
    return null
  }

  const visibleSecondaryTasks = secondaryTasks.slice(0, 3)
  const hiddenTaskCount = secondaryTasks.length - visibleSecondaryTasks.length

  return (
    <section
      className="loading-indicator"
      role="status"
      aria-label="Active loading tasks"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="loading-indicator-primary">
        <span className="loading-spinner" aria-hidden="true" />
        <span className="loading-task-label">{primaryTask.label}</span>
        {primaryTask.detail === undefined ? null : <small>{primaryTask.detail}</small>}
      </div>
      {visibleSecondaryTasks.length === 0 ? null : (
        <ol aria-label="Additional loading tasks">
          {visibleSecondaryTasks.map((task) => (
            <li key={task.id}>
              <span className="loading-task-bullet" aria-hidden="true" />
              <span className="loading-task-label">{task.label}</span>
              {task.detail === undefined ? null : <small>{task.detail}</small>}
            </li>
          ))}
          {hiddenTaskCount > 0 ? (
            <li>
              <span className="loading-task-bullet" aria-hidden="true" />
              <span className="loading-task-label">+{hiddenTaskCount} more</span>
            </li>
          ) : null}
        </ol>
      )}
    </section>
  )
}

export function ActivityLog({
  entries,
  onClear,
}: {
  readonly entries: readonly ActivityLogEntry[]
  readonly onClear: () => void
}) {
  return (
    <section className="activity-log" aria-label="Activity log">
      <div className="activity-log-heading">
        <h2>Log</h2>
        <button
          type="button"
          disabled={entries.length === 0}
          title="Clear activity log"
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <p>Idle</p>
      ) : (
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <time dateTime={new Date(entry.timestamp).toISOString()}>
                {formatDebugTimestamp(entry.timestamp)}
              </time>
              <span title={entry.message}>{entry.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function formatDebugTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
