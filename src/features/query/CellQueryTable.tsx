import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { CloseIcon, IconButton } from '../../components/ui'
import type {
  CellQueryRowValues,
  CellQueryTableColumn,
  CellQueryTableModel,
} from './useCellQueryModel'

// The matching cells (plan 23-C, 23-D5): rows of a fixed height, of which
// only those in view are drawn, under a sticky header whose buttons sort.
// Their values are read from the query worker a page at a time and kept
// here, so scrolling renders the table alone. A row's ID selects the cell;
// the arrow keys move between rows.

export const CELL_QUERY_ROW_HEIGHT = 28
const HEADER_HEIGHT = 30
const OVERSCAN_ROWS = 6
// The body's height before it is measured (and in jsdom, which has no
// layout).
const FALLBACK_VIEWPORT_HEIGHT = 240
const ID_COLUMN_WIDTH = 150
// Rows read from the worker at a time.
const PAGE_SIZE = 64
const VALUE_COLUMN_WIDTH = 120

export function CellQueryTable({
  table,
  noun,
}: {
  readonly table: CellQueryTableModel
  readonly noun: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const resultKeyRef = useRef(table.resultKey)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT)
  const [activeIndex, setActiveIndex] = useState(0)
  const [focusRequest, setFocusRequest] = useState<number | null>(null)
  const [pages, setPages] = useState<{
    readonly key: string
    readonly values: ReadonlyMap<number, CellQueryRowValues | 'error'>
  }>({ key: '', values: new Map() })
  const requestedRef = useRef<{ key: string; pages: Set<number> }>({
    key: '',
    pages: new Set(),
  })
  const { rowCount, readValues, valuesKey } = table

  // New rows start from the top.
  useLayoutEffect(() => {
    if (resultKeyRef.current === table.resultKey) return
    resultKeyRef.current = table.resultKey
    if (scrollRef.current !== null) scrollRef.current.scrollTop = 0
    setScrollTop(0)
    setActiveIndex(0)
  }, [table.resultKey])

  useEffect(() => {
    const element = scrollRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      const height = element.clientHeight - HEADER_HEIGHT
      if (height > 0) setViewportHeight(height)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  const bodyTop = Math.max(0, scrollTop)
  const start = Math.max(0, Math.floor(bodyTop / CELL_QUERY_ROW_HEIGHT) - OVERSCAN_ROWS)
  const end = Math.min(
    rowCount,
    Math.ceil((bodyTop + viewportHeight) / CELL_QUERY_ROW_HEIGHT) + OVERSCAN_ROWS,
  )

  // The pages of values the rows in view need, each read once per rows
  // and columns.
  useEffect(() => {
    if (requestedRef.current.key !== valuesKey) {
      requestedRef.current = { key: valuesKey, pages: new Set() }
    }
    const requested = requestedRef.current.pages
    const firstPage = Math.floor(start / PAGE_SIZE)
    const lastPage = Math.floor(Math.max(start, end - 1) / PAGE_SIZE)

    for (let page = firstPage; page <= lastPage; page += 1) {
      const pageStart = page * PAGE_SIZE
      if (pageStart >= rowCount || requested.has(page)) continue
      requested.add(page)

      const settle = (values: CellQueryRowValues | 'error') => {
        if (requestedRef.current.key !== valuesKey) return
        setPages((current) => ({
          key: valuesKey,
          values: new Map(current.key === valuesKey ? current.values : []).set(
            page,
            values,
          ),
        }))
      }
      readValues(pageStart, pageStart + PAGE_SIZE).then(settle, (error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return
        settle('error')
      })
    }
  }, [end, readValues, rowCount, start, valuesKey])

  function valuesAt(index: number): Readonly<Record<string, string>> | 'error' | null {
    if (pages.key !== valuesKey) return null
    const page = Math.floor(index / PAGE_SIZE)
    const values = pages.values.get(page)
    return values === undefined || values === 'error'
      ? (values ?? null)
      : (values[index - page * PAGE_SIZE] ?? null)
  }

  // Focus follows the arrow keys once the row is drawn.
  useEffect(() => {
    if (focusRequest === null) return
    const button = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-row-index="${focusRequest}"]`,
    )
    if (button !== null && button !== undefined) {
      // The rows scroll themselves; the page and window stay put.
      button.focus({ preventScroll: true })
      setFocusRequest(null)
    }
  }, [focusRequest, start, end])

  function moveTo(index: number) {
    const target = Math.max(0, Math.min(rowCount - 1, index))
    const element = scrollRef.current
    if (element !== null) {
      const top = target * CELL_QUERY_ROW_HEIGHT
      const bottom = top + CELL_QUERY_ROW_HEIGHT
      const height = element.clientHeight - HEADER_HEIGHT
      if (top < element.scrollTop) element.scrollTop = top
      else if (height > 0 && bottom > element.scrollTop + height) {
        element.scrollTop = bottom - height
      }
      setScrollTop(element.scrollTop)
    }
    setActiveIndex(target)
    setFocusRequest(target)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = Number((event.target as HTMLElement).dataset.rowIndex)
    if (!Number.isInteger(index)) return

    const page = Math.max(1, Math.floor(viewportHeight / CELL_QUERY_ROW_HEIGHT) - 1)
    const next =
      event.key === 'ArrowDown'
        ? index + 1
        : event.key === 'ArrowUp'
          ? index - 1
          : event.key === 'PageDown'
            ? index + page
            : event.key === 'PageUp'
              ? index - page
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? rowCount - 1
                  : null
    if (next === null) return
    event.preventDefault()
    moveTo(next)
  }

  const valueColumns = table.columns.filter((column) => column.kind !== 'id')
  const template = [
    `minmax(${ID_COLUMN_WIDTH}px, 1.4fr)`,
    ...valueColumns.map(() => `minmax(${VALUE_COLUMN_WIDTH}px, 1fr)`),
  ].join(' ')
  const gridStyle = {
    '--cell-query-columns': template,
    minWidth: `${ID_COLUMN_WIDTH + valueColumns.length * VALUE_COLUMN_WIDTH}px`,
  } as CSSProperties
  const focusIndex = Math.min(activeIndex, Math.max(0, rowCount - 1))
  const rows = Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
    const index = start + offset
    const cellId = table.cellIdAt(index)
    const values = valuesAt(index)
    const selected = cellId !== '' && cellId === table.selectedCellId

    return (
      <div
        key={index}
        role="row"
        aria-rowindex={index + 2}
        className={selected ? 'cell-query-row is-selected' : 'cell-query-row'}
        style={{ top: `${index * CELL_QUERY_ROW_HEIGHT}px` }}
      >
        <div role="cell" className="cell-query-cell">
          <button
            type="button"
            className="cell-query-id"
            data-row-index={index}
            tabIndex={index === focusIndex ? 0 : -1}
            aria-current={selected ? 'true' : undefined}
            title={`Select ${cellId} and move the view to it`}
            onFocus={() => {
              setActiveIndex(index)
            }}
            onClick={() => {
              setActiveIndex(index)
              table.onSelectRow(index)
            }}
          >
            {cellId}
          </button>
        </div>
        {valueColumns.map((column) => {
          if (values === 'error') {
            return (
              <div
                key={column.id}
                role="cell"
                className="cell-query-cell"
                title="This value could not be read"
              >
                —
              </div>
            )
          }
          const text = values?.[column.id]
          return (
            <div
              key={column.id}
              role="cell"
              className={
                column.kind === 'number' ? 'cell-query-cell is-number' : 'cell-query-cell'
              }
              title={text === undefined || text === '' ? undefined : text}
            >
              {text ?? '…'}
            </div>
          )
        })}
      </div>
    )
  })

  return (
    <div
      ref={scrollRef}
      className="cell-query-table"
      role="table"
      aria-label={`Matching ${noun}`}
      aria-rowcount={rowCount + 1}
      onScroll={(event) => {
        setScrollTop(event.currentTarget.scrollTop)
      }}
    >
      <div role="rowgroup" className="cell-query-head" style={gridStyle}>
        <div role="row" aria-rowindex={1} className="cell-query-header-row">
          {table.columns.map((column) => (
            <HeaderCell
              key={column.id}
              column={column}
              onSort={table.onSort}
              onRemove={table.onRemoveColumn}
            />
          ))}
        </div>
      </div>
      {rowCount === 0 ? (
        <p className="cell-query-empty">
          {table.resultKey === '' ? `Matching ${noun}…` : `No ${noun} match.`}
        </p>
      ) : (
        <div
          role="rowgroup"
          className="cell-query-body"
          style={{ ...gridStyle, height: `${rowCount * CELL_QUERY_ROW_HEIGHT}px` }}
          onKeyDown={handleKeyDown}
        >
          {rows}
        </div>
      )}
    </div>
  )
}

function HeaderCell({
  column,
  onSort,
  onRemove,
}: {
  readonly column: CellQueryTableColumn
  readonly onSort: (columnId: string) => void
  readonly onRemove: (columnId: string) => void
}) {
  const unit = column.unit === undefined ? '' : ` (${column.unit})`
  const next = column.sort === 'ascending' ? 'descending' : 'ascending'

  return (
    <div
      role="columnheader"
      aria-sort={column.sort ?? 'none'}
      className={
        column.kind === 'number' ? 'cell-query-header is-number' : 'cell-query-header'
      }
    >
      <button
        type="button"
        className="cell-query-sort"
        title={`Sort by ${column.label}, ${next}`}
        onClick={() => {
          onSort(column.id)
        }}
      >
        <span className="cell-query-header-label">
          {column.label}
          {unit}
        </span>
        {column.sort === null ? null : (
          <span aria-hidden="true">{column.sort === 'ascending' ? ' ▲' : ' ▼'}</span>
        )}
      </button>
      {column.removable ? (
        <IconButton
          title={`Remove the ${column.label} column`}
          icon={<CloseIcon />}
          variant="ghost"
          className="cell-query-remove-column"
          onClick={() => {
            onRemove(column.id)
          }}
        />
      ) : null}
    </div>
  )
}
