import { useEffect, useRef, type ReactNode } from 'react'
import { classNames } from './classNames'

export interface CheckboxProps {
  readonly title: string
  readonly label: ReactNode
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  // Shown as a dash, for a group whose members are partly checked.
  readonly indeterminate?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

export function Checkbox({
  title,
  label,
  checked,
  onChange,
  indeterminate = false,
  disabled = false,
  className,
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current !== null) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <label className={classNames('ui-checkbox', className)}>
      <input
        ref={inputRef}
        type="checkbox"
        title={title}
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.checked)
        }}
      />
      <span>{label}</span>
    </label>
  )
}
