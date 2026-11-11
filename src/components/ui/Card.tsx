import { useId, type ReactNode } from 'react'
import { IconButton } from './Button'
import { classNames } from './classNames'
import { CloseIcon } from './icons'

export interface CardProps {
  // The heading, which also names the card's region.
  readonly title: string
  readonly children: ReactNode
  readonly subtitle?: ReactNode
  // Buttons shown in the header, before the close button.
  readonly actions?: ReactNode
  readonly onClose?: (() => void) | undefined
  // Defaults to "Close <title>".
  readonly closeTitle?: string | undefined
  readonly className?: string | undefined
}

// A floating result card, such as Selection or Cell (UNIFIED_PLAN.md, 15.2-D).
export function Card({
  title,
  children,
  subtitle,
  actions,
  onClose,
  closeTitle,
  className,
}: CardProps) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className={classNames('ui-card', className)}>
      <header className="ui-card-header">
        <div className="ui-card-heading">
          <h2 id={headingId}>{title}</h2>
          {subtitle !== undefined ? <p>{subtitle}</p> : null}
        </div>
        {actions}
        {onClose !== undefined ? (
          <IconButton
            title={closeTitle ?? `Close ${title}`}
            icon={<CloseIcon />}
            onClick={onClose}
          />
        ) : null}
      </header>
      <div className="ui-card-body">{children}</div>
    </section>
  )
}
