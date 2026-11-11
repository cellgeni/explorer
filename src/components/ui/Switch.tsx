import type { ReactNode } from 'react'
import { classNames } from './classNames'

export interface SwitchProps {
  readonly title: string
  readonly label: ReactNode
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
}

// An on/off setting that applies at once.
export function Switch({
  title,
  label,
  checked,
  onChange,
  disabled = false,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      className={classNames('ui-switch', className)}
      onClick={() => {
        onChange(!checked)
      }}
    >
      <span className="ui-switch-track" aria-hidden="true">
        <span className="ui-switch-thumb" />
      </span>
      <span className="ui-switch-label">{label}</span>
    </button>
  )
}
