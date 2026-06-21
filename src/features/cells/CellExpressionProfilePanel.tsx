import { CellGeneExpressionList } from './CellGeneExpressionList'
import type { CellLoadErrorSummary } from './cellDetailModel'
import type { CellExpressionProfileState } from './cellExpressionProfileModel'

interface CellExpressionProfilePanelProps<
  ErrorType extends CellLoadErrorSummary = CellLoadErrorSummary,
> {
  readonly state: CellExpressionProfileState<ErrorType>
  readonly onLoad: () => void
  readonly disabled?: boolean | undefined
}

export function CellExpressionProfilePanel<
  ErrorType extends CellLoadErrorSummary = CellLoadErrorSummary,
>({ state, onLoad, disabled = false }: CellExpressionProfilePanelProps<ErrorType>) {
  const isLoading = state.status === 'loading'

  return (
    <div className="cell-expression-panel">
      <div className="cell-expression-heading">
        <span>Expression profile</span>
        <small>{expressionProfileStatusCopy(state)}</small>
      </div>
      <button
        type="button"
        className="secondary-action cell-expression-load-action"
        disabled={disabled || isLoading}
        title="Load selected cell expression profile"
        onClick={onLoad}
      >
        {isLoading
          ? 'Loading...'
          : state.status === 'ready'
            ? 'Refresh Profile'
            : 'Load Profile'}
      </button>
      {state.status === 'idle' ? (
        <p className="cell-expression-status">Not loaded</p>
      ) : state.status === 'loading' ? (
        <p className="cell-expression-status" aria-live="polite">
          Loading expression profile
        </p>
      ) : state.status === 'unavailable' ? (
        <p className="cell-expression-status">{state.reason}</p>
      ) : state.status === 'error' ? (
        <p className="cell-expression-status is-error" aria-live="polite">
          {state.error.title}: {state.error.message}
        </p>
      ) : (
        <>
          {state.sourceLabel === undefined ? null : (
            <p className="cell-z-caption">{state.sourceLabel}</p>
          )}
          <CellGeneExpressionList
            expression={state.expression}
            ariaLabel="Selected expression profile"
          />
        </>
      )}
    </div>
  )
}

function expressionProfileStatusCopy(state: CellExpressionProfileState): string {
  switch (state.status) {
    case 'idle':
      return 'On demand'
    case 'loading':
      return 'Loading'
    case 'unavailable':
      return 'Unavailable'
    case 'error':
      return 'Error'
    case 'ready':
      return `${state.expression.totalCount.toLocaleString()} counts`
  }
}
