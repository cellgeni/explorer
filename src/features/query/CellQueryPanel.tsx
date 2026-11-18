import { useId, useState } from 'react'
import {
  Button,
  Checkbox,
  CloseIcon,
  IconButton,
  NumberField,
  Select,
  type SelectOption,
} from '../../components/ui'
import type {
  CellQueryCategoryOperator,
  CellQueryCondition,
  CellQueryNumberOperator,
} from './cellQuery'
import {
  CATEGORY_OPERATOR_LABELS,
  formatCellQueryNumber,
  NUMBER_OPERATOR_LABELS,
  withNumberOperator,
  type CellQueryColumn,
} from './cellQueryModel'
import { CellQueryTable } from './CellQueryTable'
import type {
  CellQueryClassOption,
  CellQueryConditionView,
  CellQueryModel,
} from './useCellQueryModel'

// The Cell Query window's body (plan 23-B to 23-E): the conditions, notes
// and actions, then the table of matching cells.
export function CellQueryPanel({ query }: { readonly query: CellQueryModel }) {
  return (
    <>
      <CellQueryConditions query={query} />
      <CellQueryActions query={query} />
      <CellQueryTable table={query.table} noun={query.elementNoun} />
    </>
  )
}

// More classes than this, and the list can be searched.
const CLASS_SEARCH_THRESHOLD = 12
// Classes listed at once; a search finds the others.
const CLASS_LIST_LIMIT = 200

function columnSelectOptions(
  columns: readonly CellQueryColumn[],
  placeholder: string,
): readonly SelectOption<string>[] {
  return [
    { value: '', label: placeholder },
    ...columns.map((column) => ({
      value: column.id,
      label:
        column.classCount === undefined
          ? column.label
          : `${column.label} (${column.classCount.toLocaleString()})`,
      group: column.group,
    })),
  ]
}

function CellQueryConditions({ query }: { readonly query: CellQueryModel }) {
  return (
    <div className="cell-query-conditions" role="group" aria-label="Conditions">
      {query.conditions.length === 0 ? (
        <p className="cell-query-empty">
          Add a condition to find {query.elementNoun} by their classes or values.
        </p>
      ) : (
        <ol className="cell-query-condition-list">
          {query.conditions.map((view) => (
            <li key={`${view.index}:${view.condition.columnId}`}>
              <ConditionEditor
                view={view}
                noun={query.elementNoun}
                onChange={(condition) => {
                  query.onConditionChange(view.index, condition)
                }}
                onRemove={() => {
                  query.onRemoveCondition(view.index)
                }}
              />
            </li>
          ))}
        </ol>
      )}
      <Select
        title="Filter on a column: the cells' own values, a class set or a metadata track"
        label="Add condition"
        hideLabel
        className="cell-query-add"
        value=""
        options={columnSelectOptions(query.columnOptions, 'Add condition…')}
        disabled={query.columnOptions.length === 0}
        onChange={(columnId) => {
          if (columnId !== '') query.onAddCondition(columnId)
        }}
      />
    </div>
  )
}

function ConditionEditor({
  view,
  noun,
  onChange,
  onRemove,
}: {
  readonly view: CellQueryConditionView
  readonly noun: string
  readonly onChange: (condition: CellQueryCondition) => void
  readonly onRemove: () => void
}) {
  const { condition, column } = view
  const label = column?.label ?? condition.columnId

  return (
    <div className="cell-query-condition">
      <div className="cell-query-condition-head">
        <span className="cell-query-condition-column" title={label}>
          {label}
        </span>
        {condition.kind === 'category' ? (
          <Select<CellQueryCategoryOperator>
            title={`Keep ${noun} in a chosen class, or in none of them`}
            label={`${label}: comparison`}
            hideLabel
            value={condition.operator}
            options={(['in', 'not-in'] as const).map((value) => ({
              value,
              label: CATEGORY_OPERATOR_LABELS[value],
            }))}
            onChange={(operator) => {
              onChange({ ...condition, operator })
            }}
          />
        ) : (
          <Select<CellQueryNumberOperator>
            title={`Compare each of the ${noun}' values with one bound or two`}
            label={`${label}: comparison`}
            hideLabel
            value={condition.operator}
            options={(['between', 'at-least', 'at-most'] as const).map((value) => ({
              value,
              label: NUMBER_OPERATOR_LABELS[value],
            }))}
            onChange={(operator) => {
              onChange(withNumberOperator(condition, operator, column?.range))
            }}
          />
        )}
        <IconButton
          title={`Remove the condition on ${label}`}
          icon={<CloseIcon />}
          variant="ghost"
          onClick={onRemove}
        />
      </div>
      {view.status === 'loading' ? (
        <p className="cell-query-condition-note" role="status">
          Reading {label}…
        </p>
      ) : null}
      {view.message === null ? null : (
        <p className="cell-query-error" role="alert">
          {view.message}
        </p>
      )}
      {condition.kind === 'category' && view.status === 'ready' ? (
        <ClassPicker
          label={label}
          noun={noun}
          classes={view.classes}
          chosen={condition.classIds}
          onChange={(classIds) => {
            onChange({ ...condition, classIds })
          }}
        />
      ) : null}
      {condition.kind === 'number' ? (
        <NumberBounds
          label={label}
          condition={condition}
          column={column}
          onChange={onChange}
        />
      ) : null}
    </div>
  )
}

function ClassPicker({
  label,
  noun,
  classes,
  chosen,
  onChange,
}: {
  readonly label: string
  readonly noun: string
  readonly classes: readonly CellQueryClassOption[]
  readonly chosen: readonly string[]
  readonly onChange: (classIds: readonly string[]) => void
}) {
  const [search, setSearch] = useState('')
  const chosenSet = new Set(chosen)
  const term = search.trim().toLowerCase()
  const matching =
    term === ''
      ? classes
      : classes.filter((option) => option.label.toLowerCase().includes(term))
  const listed = matching.slice(0, CLASS_LIST_LIMIT)

  if (classes.length === 0) {
    return <p className="cell-query-condition-note">The set has no classes.</p>
  }

  return (
    <div className="cell-query-classes">
      {classes.length > CLASS_SEARCH_THRESHOLD ? (
        <input
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={search}
          placeholder={`Search ${classes.length.toLocaleString()} classes`}
          aria-label={`Search ${label} classes`}
          title={`Show the ${label} classes whose name contains this text (Escape clears)`}
          onChange={(event) => {
            setSearch(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && search !== '') {
              event.stopPropagation()
              setSearch('')
            }
          }}
        />
      ) : null}
      <ul className="cell-query-class-list" aria-label={`${label} classes`}>
        {listed.map((option) => (
          <li key={option.id}>
            <Checkbox
              title={
                option.count === null
                  ? option.label
                  : `${option.label}: ${option.count.toLocaleString()} ${noun}`
              }
              label={
                <>
                  <span className="cell-query-class-label">{option.label}</span>
                  {option.count === null ? null : (
                    <small>{option.count.toLocaleString()}</small>
                  )}
                </>
              }
              checked={chosenSet.has(option.id)}
              onChange={(checked) => {
                onChange(
                  checked
                    ? [...chosen, option.id]
                    : chosen.filter((classId) => classId !== option.id),
                )
              }}
            />
          </li>
        ))}
      </ul>
      <small className="cell-query-condition-note" role="status">
        {matching.length > listed.length
          ? `${listed.length.toLocaleString()} of ${matching.length.toLocaleString()} classes shown; search for the others. `
          : term !== '' && matching.length === 0
            ? 'No classes match. '
            : ''}
        {`${chosen.length.toLocaleString()} of ${classes.length.toLocaleString()} chosen`}
      </small>
    </div>
  )
}

function NumberBounds({
  label,
  condition,
  column,
  onChange,
}: {
  readonly label: string
  readonly condition: Extract<CellQueryCondition, { kind: 'number' }>
  readonly column: CellQueryColumn | null
  readonly onChange: (condition: CellQueryCondition) => void
}) {
  const rangeId = useId()
  const range = column?.range
  const unit = column?.unit

  return (
    <div
      className="cell-query-bounds"
      role="group"
      aria-label={`${label} bounds`}
      aria-describedby={range === undefined ? undefined : rangeId}
    >
      {condition.operator === 'at-most' ? null : (
        <NumberField
          title={`The lowest ${label} kept`}
          label="From"
          value={condition.min}
          unit={unit}
          onChange={(min) => {
            onChange({ ...condition, min })
          }}
        />
      )}
      {condition.operator === 'at-least' ? null : (
        <NumberField
          title={`The highest ${label} kept`}
          label="To"
          value={condition.max}
          unit={unit}
          onChange={(max) => {
            onChange({ ...condition, max })
          }}
        />
      )}
      {range === undefined ? null : (
        <small id={rangeId} className="cell-query-condition-note">
          {`Range ${formatCellQueryNumber(range.min)} to ${formatCellQueryNumber(range.max)}`}
        </small>
      )}
    </div>
  )
}

function CellQueryActions({ query }: { readonly query: CellQueryModel }) {
  const nameId = useId()

  return (
    <div className="cell-query-footer">
      {query.notes.length === 0 ? null : (
        <ul className="plots-notes">
          {query.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {query.errors.map((error) => (
        <p key={error} className="cell-query-error" role="alert">
          {error}
        </p>
      ))}
      <div className="cell-query-actions">
        <div className="cell-query-name">
          <label htmlFor={nameId} className="visually-hidden">
            Class name
          </label>
          <input
            id={nameId}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={query.saveName}
            placeholder={query.saveNamePlaceholder}
            title="The name of the class Save As Class adds"
            onChange={(event) => {
              query.onSaveNameChange(event.currentTarget.value)
            }}
          />
        </div>
        <Button
          title={`Add the matching ${query.elementNoun} as a class and colour them on the canvas`}
          disabled={!query.canSave}
          onClick={query.onSaveClass}
        >
          Save As Class
        </Button>
        <Button
          title={`Download the table's columns for every matching ${query.elementNoun.replace(/s$/, '')} as CSV`}
          disabled={query.table.rowCount === 0 || query.exporting}
          onClick={query.onExportCsv}
        >
          {query.exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
        <Select
          title="Show another column in the table"
          label="Add column"
          hideLabel
          className="cell-query-add-column"
          value=""
          options={columnSelectOptions(query.table.addColumnOptions, 'Add column…')}
          disabled={query.table.addColumnOptions.length === 0}
          onChange={(columnId) => {
            if (columnId !== '') query.table.onAddColumn(columnId)
          }}
        />
      </div>
    </div>
  )
}
