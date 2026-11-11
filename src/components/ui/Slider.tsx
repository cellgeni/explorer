import { useId, type ReactNode } from 'react'
import { classNames } from './classNames'

export interface SliderProps {
  readonly title: string
  readonly label: ReactNode
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step?: number | undefined
  readonly onChange: (value: number) => void
  // Text for the current value, shown next to the label.
  readonly formatValue?: ((value: number) => string) | undefined
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

export function Slider({
  title,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue = String,
  disabled = false,
  className,
}: SliderProps) {
  const id = useId()

  return (
    <div className={classNames('ui-field', 'ui-slider', className)}>
      <div className="ui-field-row">
        <label htmlFor={id} className="ui-field-label">
          {label}
        </label>
        <output htmlFor={id} className="ui-field-value">
          {formatValue(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        title={title}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value))
        }}
      />
    </div>
  )
}
