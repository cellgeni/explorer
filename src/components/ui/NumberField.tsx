import { useId, useState, type ReactNode } from 'react'
import { classNames } from './classNames'

export interface NumberFieldProps {
  readonly title: string
  readonly label: ReactNode
  readonly value: number
  readonly min?: number | undefined
  readonly max?: number | undefined
  readonly step?: number | undefined
  // Shown after the field, such as "µm".
  readonly unit?: string | undefined
  // Called on Enter or blur with a finite number clamped to min and max.
  readonly onChange: (value: number) => void
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

// A number input that commits on Enter or blur, so typing "1" on the way to
// "100" does not apply 1. Escape puts the last committed value back.
export function NumberField({
  title,
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled = false,
  className,
}: NumberFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)

  function commit() {
    if (draft === null) return
    const parsed = Number(draft)
    setDraft(null)
    if (draft.trim() === '' || !Number.isFinite(parsed)) return
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed))
    if (clamped !== value) onChange(clamped)
  }

  return (
    <div className={classNames('ui-field', 'ui-number-field', className)}>
      <label htmlFor={id} className="ui-field-label">
        {label}
      </label>
      <span className="ui-number-field-input">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          title={title}
          value={draft ?? String(value)}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.currentTarget.value)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') setDraft(null)
          }}
        />
        {unit !== undefined ? <span className="ui-field-unit">{unit}</span> : null}
      </span>
    </div>
  )
}
