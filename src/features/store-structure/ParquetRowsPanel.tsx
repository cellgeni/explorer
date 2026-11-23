import { Button } from '../../components/ui'
import {
  PARQUET_PREVIEW_COLUMNS,
  PARQUET_PREVIEW_ROWS,
  previewRowGroup,
  type ParquetRowPreview,
} from '../../data/parquetRows'
import type { ParquetStructure } from '../../data/parquetStructure'
import {
  PREVIEW_TITLE_LIMIT,
  formatPreviewValue,
  isWkbColumn,
  parquetTypeLabel,
  previewReadBound,
} from './parquetStructureModel'
import { formatBytes, formatCount } from './storeStructureModel'
import type { ParquetMoreColumnsState, ParquetRowsState } from './useParquetRows'

export function ParquetRowsPanel({
  structure,
  state,
  onRead,
  onReadMore,
}: {
  readonly structure: ParquetStructure
  readonly state: ParquetRowsState
  readonly onRead: () => void
  readonly onReadMore: () => void
}) {
  const group = previewRowGroup(structure.metadata)
  const bound = previewReadBound(structure)

  if (group === null || bound === null) {
    return (
      <div className="store-structure-rows-panel">
        <p className="store-structure-empty">The file holds no rows.</p>
      </div>
    )
  }

  switch (state.status) {
    case 'idle':
      return (
        <div className="store-structure-rows-panel">
          <p className="store-structure-rows-note">
            The first {Math.min(PARQUET_PREVIEW_ROWS, group.rows).toLocaleString()} rows
            come from row group {group.index}. Only the first pages of each column are
            read, but a writer that stores each column chunk as one page makes that the
            whole row group: up to {formatBytes(bound)}.
          </p>
          <Button title="Read the first rows of the file" onClick={onRead}>
            Read Rows
          </Button>
        </div>
      )
    case 'loading':
      return (
        <div className="store-structure-rows-panel">
          <p role="status">Reading the first rows…</p>
        </div>
      )
    case 'error':
      return (
        <div className="store-structure-rows-panel">
          <div className="store-structure-error" role="alert">
            <strong>{state.error.title}</strong>
            <p>{state.error.message}</p>
            <p>{state.error.action}</p>
            <Button title="Read the first rows again" onClick={onRead}>
              Retry
            </Button>
          </div>
        </div>
      )
    case 'ready':
      return (
        <RowTable
          structure={structure}
          preview={state.preview}
          rowStart={group.rowStart}
          more={state.more}
          onReadMore={onReadMore}
        />
      )
  }
}

function RowTable({
  structure,
  preview,
  rowStart,
  more,
  onReadMore,
}: {
  readonly structure: ParquetStructure
  readonly preview: ParquetRowPreview
  readonly rowStart: number
  readonly more: ParquetMoreColumnsState
  readonly onReadMore: () => void
}) {
  const columnCount = structure.root.children.length
  const nextColumns = Math.min(
    PARQUET_PREVIEW_COLUMNS,
    columnCount - preview.columns.length,
  )
  const columns = preview.columns.map((column) => {
    const node = structure.root.children.find((child) => child.name === column.name)
    return {
      ...column,
      type: node === undefined ? '' : parquetTypeLabel(node.element),
      wkb: isWkbColumn(structure, column.name),
    }
  })
  const rows = Array.from({ length: preview.rowCount }, (_, index) => index)

  return (
    <div className="store-structure-rows-panel">
      <p className="store-structure-rows-note">
        First {formatCount(preview.rowCount, 'row')} of{' '}
        {structure.rowCount.toLocaleString()}, from row group {preview.rowGroup}; read{' '}
        {formatBytes(preview.bytesRead)}.
        {nextColumns > 0
          ? ` Columns 1 to ${preview.columns.length.toLocaleString()} of ${columnCount.toLocaleString()}.`
          : null}
      </p>
      {nextColumns > 0 ? (
        <div className="store-structure-rows-more">
          {more.status === 'loading' ? (
            <p role="status">Reading the next columns…</p>
          ) : (
            <Button
              title={`Read the next ${formatCount(nextColumns, 'column')} of the first rows`}
              onClick={onReadMore}
            >
              {more.status === 'error'
                ? 'Retry'
                : `Read ${nextColumns.toLocaleString()} More Columns`}
            </Button>
          )}
          {more.status === 'error' ? (
            <p role="alert">
              {more.error.title}: {more.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="store-structure-rows">
        <table
          className="store-structure-table store-structure-rows-table"
          aria-label="First rows"
        >
          <thead>
            <tr>
              <th scope="col">Row</th>
              {columns.map((column) => (
                <th key={column.name} scope="col">
                  {column.name}
                  <span className="store-structure-rows-type">{column.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th scope="row">{(rowStart + row).toLocaleString()}</th>
                {columns.map((column) => {
                  const value = column.values[row]
                  const text = formatPreviewValue(value, { wkb: column.wkb })
                  return text === null ? (
                    <td key={column.name} className="is-null">
                      null
                    </td>
                  ) : (
                    <td
                      key={column.name}
                      title={
                        formatPreviewValue(value, {
                          wkb: column.wkb,
                          limit: PREVIEW_TITLE_LIMIT,
                        }) ?? text
                      }
                    >
                      {text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
