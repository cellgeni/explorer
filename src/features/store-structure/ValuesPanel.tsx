import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from '../../components/ui'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  AUTO_READ_VALUES_BYTES,
  formatBytes,
  formatCount,
  formatShape,
} from './storeStructureModel'

// The first values of an HDF5 dataset or a Zarr array: a block from its
// origin, its elements in row-major order.
export interface ValuePreview {
  // The block's shape; [] for a scalar.
  readonly shape: readonly number[]
  readonly values: readonly unknown[]
}

type ValuesState<Preview> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly preview: Preview }
  | { readonly status: 'error'; readonly error: StructuredLoadError }

// A node's first values: read at once when cheap, else on request. The
// details remount for each node, and this with them.
export function ValuesPanel<Preview extends ValuePreview>({
  unavailable,
  bound,
  noun,
  source,
  read,
  renderValues,
}: {
  // Why the values cannot be shown, or null when they can.
  readonly unavailable: string | null
  // About the most the read takes, or null when that is not known.
  readonly bound: number | null
  // What the node is ('dataset', 'array') and what it is in ('file', 'store').
  readonly noun: string
  readonly source: string
  readonly read: (signal: AbortSignal) => Promise<Preview>
  readonly renderValues: (preview: Preview, labelledBy: string) => ReactNode
}) {
  const headingId = useId()
  const autoRead =
    unavailable === null && bound !== null && bound <= AUTO_READ_VALUES_BYTES
  const [state, setState] = useState<ValuesState<Preview>>(() =>
    autoRead ? { status: 'loading' } : { status: 'idle' },
  )
  // Each Read Values or Retry starts a read; 0 is none yet.
  const [attempt, setAttempt] = useState(autoRead ? 1 : 0)
  const panelRef = useRef<HTMLDivElement>(null)
  // Read Values or Retry was pressed: focus follows what replaces them.
  const requestedRef = useRef(false)
  const readValues = useEffectEvent(read)

  useEffect(() => {
    if (attempt === 0) return
    const controller = new AbortController()

    readValues(controller.signal).then(
      (preview) => {
        if (!controller.signal.aborted) setState({ status: 'ready', preview })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          error: createStructuredLoadError('Store structure', error),
        })
      },
    )
    return () => {
      controller.abort()
    }
  }, [attempt])

  const start = () => {
    requestedRef.current = true
    setState({ status: 'loading' })
    setAttempt((count) => count + 1)
  }

  // Read Values and Retry give way to "Reading…", and that to the values or
  // Retry, so keyboard focus moves to each rather than falling to the page.
  useLayoutEffect(() => {
    if (!requestedRef.current) return
    const panel = panelRef.current
    if (state.status === 'loading') {
      panel?.querySelector<HTMLElement>('[role="status"]')?.focus()
      return
    }

    requestedRef.current = false
    panel?.querySelector<HTMLElement>(state.status === 'error' ? 'button' : 'h4')?.focus()
  }, [state.status])

  return (
    <div ref={panelRef} className="store-structure-values">
      <h4 id={headingId} tabIndex={-1}>
        Values
      </h4>
      {unavailable !== null ? (
        <p className="store-structure-empty">{unavailable}</p>
      ) : state.status === 'idle' ? (
        <div className="store-structure-values-ask">
          <p className="store-structure-rows-note">
            Reading the first values may read up to{' '}
            {bound === null ? 'an unknown amount' : `about ${formatBytes(bound)}`} of the{' '}
            {source}.
          </p>
          <Button title={`Read the first values of this ${noun}`} onClick={start}>
            Read Values
          </Button>
        </div>
      ) : state.status === 'loading' ? (
        <p role="status" tabIndex={-1}>
          Reading the first values…
        </p>
      ) : state.status === 'error' ? (
        <div className="store-structure-error" role="alert">
          <strong>{state.error.title}</strong>
          <p>{state.error.message}</p>
          <Button title="Read the first values again" onClick={start}>
            Retry
          </Button>
        </div>
      ) : (
        renderValues(state.preview, headingId)
      )}
    </div>
  )
}

// A column of a 1-D array of records, whose elements are arrays of their
// members' values.
export interface ValuesColumn {
  readonly name: string
  readonly type: string
}

// The first values as a table: a row per index along the first dimension, a
// column per index along the second, or per member of a record.
export function ValuesTable({
  shape,
  preview,
  labelledBy,
  noun,
  columns = null,
  format,
}: {
  // The whole node's shape.
  readonly shape: readonly number[]
  readonly preview: ValuePreview
  readonly labelledBy: string
  readonly noun: string
  readonly columns?: readonly ValuesColumn[] | null
  // A value as text; `column` is the member's index for records.
  readonly format: (value: unknown, column: number | null) => string
}) {
  const block = preview.shape

  if (block.length === 0) {
    return <pre className="store-structure-value">{format(preview.values[0], null)}</pre>
  }

  if (preview.values.length === 0) {
    return <p className="store-structure-empty">The {noun} holds no values.</p>
  }

  const rows = block[0] ?? 0
  const width = block.length === 1 ? 1 : (block[1] ?? 1)
  const members = block.length === 1 ? columns : null
  const shown = block.reduce((product, size) => product * size, 1)
  const total = shape.reduce((product, size) => product * size, 1)
  const fixed =
    shape.length > 3
      ? ` at index 0 of dimensions 3 to ${shape.length}`
      : shape.length === 3
        ? ' at index 0 of dimension 3'
        : ''

  return (
    <>
      <p className="store-structure-rows-note">
        {shown === total
          ? `All ${formatCount(total, 'value')}.`
          : `The first ${formatShape(block.slice(0, 2))}${fixed}, of ${formatShape(shape)}.`}
      </p>
      <div className="store-structure-rows">
        <table
          className="store-structure-table store-structure-rows-table"
          aria-labelledby={labelledBy}
        >
          <thead>
            <tr>
              <th scope="col">Index</th>
              {members !== null
                ? members.map((member) => (
                    <th key={member.name} scope="col">
                      {member.name}
                      <span className="store-structure-rows-type">{member.type}</span>
                    </th>
                  ))
                : block.length === 1
                  ? [
                      <th key="value" scope="col">
                        Value
                      </th>,
                    ]
                  : Array.from({ length: width }, (_, column) => (
                      <th key={column} scope="col">
                        {column.toLocaleString()}
                      </th>
                    ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, row) => (
              <tr key={row}>
                <th scope="row">{row.toLocaleString()}</th>
                {members !== null
                  ? members.map((member, index) => {
                      const record = preview.values[row]
                      const value = Array.isArray(record) ? record[index] : undefined
                      return <ValueCell key={member.name} text={format(value, index)} />
                    })
                  : Array.from({ length: width }, (_, column) => (
                      <ValueCell
                        key={column}
                        text={format(preview.values[row * width + column], null)}
                      />
                    ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ValueCell({ text }: { readonly text: string }) {
  return <td title={text}>{text}</td>
}
