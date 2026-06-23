import { CellGeneExpressionList } from './CellGeneExpressionList'
import { CELL_GENE_EXPRESSION_LIMIT, type CellLoadErrorSummary } from './cellDetailModel'
import type {
  CellExpressionProfileSelectionKind,
  CellExpressionProfileState,
} from './cellExpressionProfileModel'

interface CellExpressionProfilePanelProps<
  ErrorType extends CellLoadErrorSummary = CellLoadErrorSummary,
> {
  readonly state: CellExpressionProfileState<ErrorType>
  readonly onLoad: () => void
  readonly disabled?: boolean | undefined
  readonly selectionKind?: CellExpressionProfileSelectionKind | undefined
}

export function CellExpressionProfilePanel<
  ErrorType extends CellLoadErrorSummary = CellLoadErrorSummary,
>({
  state,
  onLoad,
  disabled = false,
  selectionKind = 'cell',
}: CellExpressionProfilePanelProps<ErrorType>) {
  const isLoading = state.status === 'loading'
  const copy = expressionProfileCopy(selectionKind)

  return (
    <div className="cell-expression-panel">
      <div className="cell-expression-heading">
        <span>{copy.heading}</span>
        <small>{expressionProfileStatusCopy(state)}</small>
      </div>
      <button
        type="button"
        className="secondary-action cell-expression-load-action"
        disabled={disabled || isLoading}
        title={copy.actionTitle}
        onClick={onLoad}
      >
        {isLoading
          ? 'Loading...'
          : state.status === 'ready'
            ? copy.refreshLabel
            : copy.loadLabel}
      </button>
      {state.status === 'idle' ? (
        <p className="cell-expression-status">{copy.idleMessage}</p>
      ) : state.status === 'loading' ? (
        <p className="cell-expression-status" aria-live="polite">
          {copy.loadingMessage}
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
          <p className="cell-z-caption">{copy.listCaption}</p>
          <CellGeneExpressionList
            expression={state.expression}
            ariaLabel={copy.listAriaLabel}
            filterLabel={copy.filterLabel}
            hitLimitCopy={copy.hitLimitCopy}
            searchPlaceholder={copy.searchPlaceholder}
          />
        </>
      )}
    </div>
  )
}

function expressionProfileCopy(selectionKind: CellExpressionProfileSelectionKind) {
  const geneLimitCopy = CELL_GENE_EXPRESSION_LIMIT.toLocaleString()

  if (selectionKind === 'bin') {
    return {
      heading: 'Bin GEX profile',
      actionTitle: 'Load selected bin gene expression profile',
      loadLabel: 'Load Bin GEX',
      refreshLabel: 'Refresh Bin GEX',
      idleMessage: 'No bin GEX loaded',
      loadingMessage: 'Loading bin GEX profile',
      listCaption: 'Top genes in selected bin',
      listAriaLabel: 'Top selected bin genes',
      filterLabel: 'Bin gene filter',
      searchPlaceholder: 'Search bin genes',
      hitLimitCopy: `Showing first ${geneLimitCopy} bin genes`,
    }
  }

  return {
    heading: 'Cell GEX profile',
    actionTitle: 'Load selected cell gene expression profile',
    loadLabel: 'Load Cell GEX',
    refreshLabel: 'Refresh Cell GEX',
    idleMessage: 'No cell GEX loaded',
    loadingMessage: 'Loading cell GEX profile',
    listCaption: 'Top genes in selected cell',
    listAriaLabel: 'Top selected cell genes',
    filterLabel: 'Cell gene filter',
    searchPlaceholder: 'Search cell genes',
    hitLimitCopy: `Showing first ${geneLimitCopy} cell genes`,
  }
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
