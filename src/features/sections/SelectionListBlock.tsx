import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { IconButton, PencilIcon, TargetIcon } from '../../components/ui'
import { roiSelectionArea } from '../../data/roiSelection'
import { formatSquareMicrometers } from '../../data/units'
import {
  selectionDisplayName,
  selectionKindLabel,
  type SavedSelection,
} from '../roi/selectionListModel'
import type { SelectionListModel } from './annotationsSectionModel'

// Saved selections in the Annotations section (plan 15.4-A):
// colour, visibility, name, Go To, rename and delete. Choosing a name shows
// that selection in the Selection card and reruns its queries.
export function SelectionListPanel({
  selections: model,
}: {
  readonly selections: SelectionListModel
}) {
  const { selections } = model
  const sectionRef = useRef<HTMLElement>(null)
  // The row deleted, until it has gone.
  const deletedRef = useRef<{ readonly id: string; readonly index: number } | null>(null)

  // Delete takes its own row away: focus moves to the next row's Delete, or
  // the last one's, or the heading once the list is empty.
  useLayoutEffect(() => {
    const deleted = deletedRef.current
    if (deleted === null || selections.some((selection) => selection.id === deleted.id)) {
      return
    }
    deletedRef.current = null
    const buttons =
      sectionRef.current?.querySelectorAll<HTMLElement>('.annotation-remove') ?? []
    const next = buttons[Math.min(deleted.index, buttons.length - 1)]
    ;(next ?? sectionRef.current?.querySelector<HTMLElement>('h4'))?.focus()
  }, [selections])

  if (!model.available) return null

  return (
    <section
      ref={sectionRef}
      className="annotation-size-panel"
      aria-labelledby="selection-list-heading"
    >
      <div className="annotation-size-heading">
        <h4 id="selection-list-heading" tabIndex={-1}>
          Selections
        </h4>
        <small>
          {selections.length === 0
            ? 'None'
            : `${selections.length.toLocaleString()} saved`}
        </small>
      </div>
      {selections.length === 0 ? (
        <p className="selection-list-empty">
          Draw with Box selection or Lasso selection to add one.
        </p>
      ) : (
        <ul className="annotation-list selection-list" aria-label="Selections">
          {selections.map((selection, index) => (
            <SelectionRow
              key={selection.id}
              selection={selection}
              active={selection.id === model.activeId}
              model={model}
              onDelete={() => {
                deletedRef.current = { id: selection.id, index }
                model.onDelete(selection.id)
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function SelectionRow({
  selection,
  active,
  model,
  onDelete,
}: {
  readonly selection: SavedSelection
  readonly active: boolean
  readonly model: SelectionListModel
  readonly onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const rowRef = useRef<HTMLLIElement>(null)
  // Enter or Esc closed the rename field, which had focus.
  const refocusRef = useRef(false)

  useLayoutEffect(() => {
    if (renaming || !refocusRef.current) return
    refocusRef.current = false
    rowRef.current?.querySelector<HTMLElement>('.selection-list-rename-button')?.focus()
  }, [renaming])
  const name = selectionDisplayName(selection)
  const className = [
    active ? 'is-active' : null,
    selection.visible || active ? null : 'is-hidden',
  ]
    .filter((part) => part !== null)
    .join(' ')

  return (
    <li ref={rowRef} className={className === '' ? undefined : className}>
      <label
        className="annotation-color-picker"
        style={{ '--annotation-color': selection.color } as CSSProperties}
      >
        <input
          className="annotation-color-input"
          type="color"
          aria-label={`${name} color`}
          value={selection.color}
          title={`${name} color`}
          onChange={(event) => {
            model.onColorChange(selection.id, event.currentTarget.value)
          }}
        />
        <span className="annotation-color-swatch" aria-hidden="true" />
      </label>
      <label className="annotation-visibility-toggle">
        <input
          type="checkbox"
          checked={selection.visible}
          aria-label={`${name} visible`}
          title={`${name} visible`}
          onChange={(event) => {
            model.onVisibilityChange(selection.id, event.currentTarget.checked)
          }}
        />
      </label>
      {renaming ? (
        <RenameField
          name={selection.name}
          label={`Rename ${name}`}
          onDone={(next, byKey) => {
            refocusRef.current = byKey
            setRenaming(false)
            if (next !== null && next.trim() !== '') {
              model.onRename(selection.id, next.trim())
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="selection-list-name"
          aria-pressed={active}
          disabled={!model.canActivate}
          title={active ? `${name} is in the Selection card` : `Show ${name}`}
          onClick={() => {
            model.onActivate(selection.id)
          }}
        >
          {name}
        </button>
      )}
      <small title={`${selectionKindLabel(selection.selection)} selection`}>
        {formatSquareMicrometers(roiSelectionArea(selection.selection))}
      </small>
      <IconButton
        title={`Go to ${name}`}
        icon={<TargetIcon />}
        className="selection-list-action"
        onClick={() => {
          model.onGoTo(selection.id)
        }}
      />
      <IconButton
        title={`Rename ${name}`}
        icon={<PencilIcon />}
        className="selection-list-action selection-list-rename-button"
        disabled={renaming}
        onClick={() => {
          setRenaming(true)
        }}
      />
      <button
        type="button"
        className="annotation-remove"
        aria-label={`Delete ${name}`}
        title={`Delete ${name}`}
        onClick={onDelete}
      >
        x
      </button>
    </li>
  )
}

// Enter or leaving the field keeps the name; Esc puts the old one back.
function RenameField({
  name,
  label,
  onDone,
}: {
  readonly name: string
  readonly label: string
  // `byKey`: Enter or Esc, so focus goes back to the row.
  readonly onDone: (name: string | null, byKey: boolean) => void
}) {
  const [value, setValue] = useState(name)
  // The field may blur as it closes; only the first ending counts.
  const doneRef = useRef(false)

  function finish(next: string | null, byKey: boolean) {
    if (doneRef.current) return
    doneRef.current = true
    onDone(next, byKey)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(value, true)
    } else if (event.key === 'Escape') {
      // Esc here is the field's, not the tool's.
      event.preventDefault()
      event.stopPropagation()
      finish(null, true)
    }
  }

  return (
    <input
      className="selection-list-rename"
      type="text"
      autoComplete="off"
      spellCheck={false}
      // Rename was asked for, so the field takes focus.
      autoFocus
      aria-label={label}
      title={label}
      value={value}
      onChange={(event) => {
        setValue(event.currentTarget.value)
      }}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        finish(value, false)
      }}
    />
  )
}
