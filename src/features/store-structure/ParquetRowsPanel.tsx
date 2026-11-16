import { Button } from '../../components/ui'
import {
  PARQUET_PREVIEW_ROWS,
  previewRowGroup,
  type ParquetRowPreview,
} from '../../data/parquetRows'
import type { ParquetStructure } from '../../data/parquetStructure'
import {
  formatPreviewValue,
  isWkbColumn,
  parquetTypeLabel,
  previewReadBound,
} from './parquetStructureModel'
import { formatBytes, formatCount } from './storeStructureModel'
import type { ParquetRowsState } from './useParquetRows'

export function ParquetRowsPanel({
  structure,
  state,
  onRead,
}: {
  readonly structure: ParquetStructure
  readonly state: ParquetRowsState
  readonly onRead: () => void
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
        />
      )
  }
}

function RowTable({
  structure,
  preview,
  rowStart,
}: {
  readonly structure: ParquetStructure
  readonly preview: ParquetRowPreview
  readonly rowStart: number
}) {
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
      </p>
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
                  const text = formatPreviewValue(column.values[row], { wkb: column.wkb })
                  return text === null ? (
                    <td key={column.name} className="is-null">
                      null
                    </td>
                  ) : (
                    <td key={column.name} title={text}>
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
