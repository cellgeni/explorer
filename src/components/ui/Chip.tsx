import type { ReactNode } from 'react'
import { classNames } from './classNames'
import { CloseIcon } from './icons'

type ChipRemoval =
  | { readonly onRemove?: undefined; readonly removeTitle?: undefined }
  // removeTitle names what goes, such as "Remove SNAP25".
  | { readonly onRemove: () => void; readonly removeTitle: string }

export type ChipProps = ChipRemoval & {
  readonly title: string
  readonly children: ReactNode
  readonly selected?: boolean | undefined
  // Makes the chip a toggle button.
  readonly onClick?: (() => void) | undefined
  readonly className?: string | undefined
}

// A compact label, such as a selected gene, with an optional × button.
export function Chip({
  title,
  children,
  selected = false,
  onClick,
  onRemove,
  removeTitle,
  className,
}: ChipProps) {
  return (
    <span
      className={classNames('ui-chip', selected && 'is-selected', className)}
      data-removable={onRemove !== undefined || undefined}
    >
      {onClick !== undefined ? (
        <button
          type="button"
          className="ui-chip-label"
          title={title}
          aria-pressed={selected}
          onClick={onClick}
        >
          {children}
        </button>
      ) : (
        <span className="ui-chip-label" title={title}>
          {children}
        </span>
      )}
      {onRemove !== undefined ? (
        <button
          type="button"
          className="ui-chip-remove"
          title={removeTitle}
          aria-label={removeTitle}
          onClick={onRemove}
        >
          <CloseIcon />
        </button>
      ) : null}
    </span>
  )
}
