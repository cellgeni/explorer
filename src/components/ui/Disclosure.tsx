import { useState, type ReactNode } from 'react'
import { classNames } from './classNames'
import { ChevronRightIcon } from './icons'

export interface DisclosureProps {
  readonly title: string
  readonly summary: ReactNode
  readonly children: ReactNode
  // Controlled when set; otherwise starts at defaultOpen.
  readonly open?: boolean | undefined
  readonly defaultOpen?: boolean | undefined
  readonly onOpenChange?: ((open: boolean) => void) | undefined
  readonly className?: string | undefined
}

// A section that opens and closes. Its content stays mounted while closed, so
// local state such as a search box survives.
export function Disclosure({
  title,
  summary,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
}: DisclosureProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isOpen = open ?? uncontrolledOpen

  return (
    <details
      className={classNames('ui-disclosure', className)}
      open={isOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open
        if (nextOpen === isOpen) return
        if (open === undefined) setUncontrolledOpen(nextOpen)
        onOpenChange?.(nextOpen)
      }}
    >
      <summary title={title}>
        <ChevronRightIcon />
        {summary}
      </summary>
      <div className="ui-disclosure-body">{children}</div>
    </details>
  )
}
