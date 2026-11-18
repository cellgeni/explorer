import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { CloseIcon, IconButton } from '../../components/ui'
import { MorphologyTileStore } from '../../rendering/morphologyTileStore'
import { CellPicture } from './CellPicture'
import {
  CELL_PICTURE_ROW_HEIGHT,
  CELL_PICTURE_SETTLE_MS,
  CELL_PICTURE_SIZE,
  CELL_PICTURE_TILE_REQUESTS,
  type CellPictureOutline,
} from './cellPictureModel'
import type {
  CellQueryRowValues,
  CellQueryTableColumn,
  CellQueryTableModel,
} from './useCellQueryModel'

// The matching cells (plan 23-C, 23-D5): rows of a fixed height, of which
// only those in view are drawn, under a sticky header whose buttons sort.
// Their values are read from the query worker a page at a time and kept
// here, so scrolling renders the table alone. A row's ID selects the cell;
// the arrow keys move between rows. With Picture on, each row starts with a
// picture of the cell (23-G), read once the rows stop moving.

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
const PICTURE_COLUMN_WIDTH = CELL_PICTURE_SIZE + 8

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
  const { rowCount, readValues, valuesKey, pictures, cellAt } = table
  const rowHeight = pictures === null ? CELL_QUERY_ROW_HEIGHT : CELL_PICTURE_ROW_HEIGHT
  const tileStore = usePictureTileStore(pictures?.key ?? null)
  // Rows stop moving this long after the last scroll (23-D12).
  const [settledTop, setSettledTop] = useState(0)
  const settled = settledTop === scrollTop
  const [outlines, setOutlines] = useState<{
    readonly key: string
    readonly outlines: ReadonlyMap<string, CellPictureOutline | null>
  }>({ key: '', outlines: new Map() })

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

  useEffect(() => {
    if (settledTop === scrollTop) return
    const timer = window.setTimeout(() => {
      setSettledTop(scrollTop)
    }, CELL_PICTURE_SETTLE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [scrollTop, settledTop])

  const bodyTop = Math.max(0, scrollTop)
  const firstInView = Math.floor(bodyTop / rowHeight)
  const lastInView = Math.min(
    rowCount - 1,
    Math.ceil((bodyTop + viewportHeight) / rowHeight) - 1,
  )
  const start = Math.max(0, firstInView - OVERSCAN_ROWS)
  const end = Math.min(rowCount, lastInView + 1 + OVERSCAN_ROWS)

  // The outlines of the rows in view, once they stop moving (23-H).
  useEffect(() => {
    if (pictures === null || !settled || lastInView < firstInView) return
    const controller = new AbortController()
    const { key } = pictures

    pictures
      .readOutlines(firstInView, lastInView + 1, controller.signal, (cellId, outline) => {
        setOutlines((current) => {
          if (current.key === key && current.outlines.get(cellId) === outline) {
            return current
          }
          return {
            key,
            outlines: new Map(current.key === key ? current.outlines : []).set(
              cellId,
              outline,
            ),
          }
        })
      })
      .catch(() => {
        // An aborted page, or a failed read: those pictures keep a ring.
      })
    return () => {
      controller.abort()
    }
  }, [firstInView, lastInView, pictures, settled])

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
      const top = target * rowHeight
      const bottom = top + rowHeight
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

    const page = Math.max(1, Math.floor(viewportHeight / rowHeight) - 1)
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
  const pictureWidth = pictures === null ? 0 : PICTURE_COLUMN_WIDTH
  const template = [
    ...(pictures === null ? [] : [`${PICTURE_COLUMN_WIDTH}px`]),
    `minmax(${ID_COLUMN_WIDTH}px, 1.4fr)`,
    ...valueColumns.map(() => `minmax(${VALUE_COLUMN_WIDTH}px, 1fr)`),
  ].join(' ')
  const gridStyle = {
    '--cell-query-columns': template,
    minWidth: `${pictureWidth + ID_COLUMN_WIDTH + valueColumns.length * VALUE_COLUMN_WIDTH}px`,
  } as CSSProperties
  const pictureOutlines =
    pictures !== null && outlines.key === pictures.key ? outlines.outlines : null
  const focusIndex = Math.min(activeIndex, Math.max(0, rowCount - 1))
  const rows = Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
    const index = start + offset
    const cellId = table.cellIdAt(index)
    const values = valuesAt(index)
    const selected = cellId !== '' && cellId === table.selectedCellId
    const cell = pictures === null ? null : cellAt(index)

    return (
      <div
        key={index}
        role="row"
        aria-rowindex={index + 2}
        className={selected ? 'cell-query-row is-selected' : 'cell-query-row'}
        style={{ top: `${index * rowHeight}px`, height: `${rowHeight}px` }}
      >
        {pictures === null ? null : (
          <div role="cell" className="cell-query-cell cell-query-picture-cell">
            {cell === null || index < firstInView || index > lastInView ? null : (
              <CellPicture
                key={cell.id}
                cell={cell}
                field={pictures.field}
                image={pictures.image}
                tileStore={tileStore}
                priority={index}
                settled={settled}
                outline={pictureOutlines?.get(cell.id)}
              />
            )}
          </div>
        )}
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
          {pictures === null ? null : (
            <div role="columnheader" className="cell-query-header is-picture">
              <span className="cell-query-header-label">Picture</span>
            </div>
          )}
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
          style={{ ...gridStyle, height: `${rowCount * rowHeight}px` }}
          onKeyDown={handleKeyDown}
        >
          {rows}
        </div>
      )}
    </div>
  )
}

// One tile store for every picture of a dataset (23-D11), emptied when the
// table unmounts or the dataset changes.
function usePictureTileStore(key: string | null): MorphologyTileStore {
  const [held, setHeld] = useState(() => ({ key, store: pictureTileStore() }))
  if (held.key !== key) setHeld({ key, store: pictureTileStore() })

  useEffect(
    () => () => {
      held.store.dispose()
    },
    [held.store],
  )
  return held.store
}

function pictureTileStore(): MorphologyTileStore {
  return new MorphologyTileStore({
    maxConcurrentRequests: CELL_PICTURE_TILE_REQUESTS,
    prefetch: false,
  })
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
