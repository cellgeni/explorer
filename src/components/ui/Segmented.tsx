import type { ReactNode } from 'react'
import { classNames } from './classNames'

export interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: ReactNode
  readonly title: string
  readonly disabled?: boolean | undefined
}

export interface SegmentedProps<T extends string> {
  readonly title: string
  // The group's accessible name.
  readonly label: string
  readonly value: T
  readonly options: readonly SegmentedOption<T>[]
  readonly onChange: (value: T) => void
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

// A row of buttons of which one is pressed, like the existing unit switches.
export function Segmented<T extends string>({
  title,
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      title={title}
      className={classNames('ui-segmented', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={option.value === value}
          disabled={disabled || option.disabled === true}
          onClick={() => {
            if (option.value !== value) onChange(option.value)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
