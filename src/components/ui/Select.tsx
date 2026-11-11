import { useId, type ReactNode } from 'react'
import { classNames } from './classNames'
import { ChevronDownIcon } from './icons'

export interface SelectOption<T extends string> {
  readonly value: T
  readonly label: string
  readonly disabled?: boolean | undefined
}

export interface SelectProps<T extends string> {
  readonly title: string
  readonly label: ReactNode
  readonly value: T
  readonly options: readonly SelectOption<T>[]
  readonly onChange: (value: T) => void
  readonly disabled?: boolean | undefined
  // Keeps the label for screen readers only.
  readonly hideLabel?: boolean | undefined
  readonly className?: string | undefined
}

// A labelled native select, styled to match the other fields.
export function Select<T extends string>({
  title,
  label,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
  className,
}: SelectProps<T>) {
  const id = useId()

  return (
    <div className={classNames('ui-field', className)}>
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : 'ui-field-label'}>
        {label}
      </label>
      <span className="ui-select">
        <select
          id={id}
          title={title}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const next = options.find(
              (option) => option.value === event.currentTarget.value,
            )
            if (next !== undefined) onChange(next.value)
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon />
      </span>
    </div>
  )
}
