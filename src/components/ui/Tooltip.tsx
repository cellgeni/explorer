import {
  cloneElement,
  useEffect,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { classNames } from './classNames'

const SHOW_DELAY_MS = 400

export interface TooltipProps {
  // The tooltip text. It also describes the child (aria-describedby).
  readonly title: string
  // One element. A native control here needs no title of its own: the audit
  // in nativeTitleAudit.test.ts counts this tooltip instead, and a native
  // title would show a second tooltip.
  readonly children: ReactElement<{ 'aria-describedby'?: string | undefined }>
  readonly placement?: 'top' | 'bottom' | undefined
  // Extra content after the text, such as a Kbd.
  readonly detail?: ReactNode
}

// A styled tooltip, shown after a short hover or at once on keyboard focus,
// and hidden by Escape.
export function Tooltip({ title, children, placement = 'top', detail }: TooltipProps) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  const [hovering, setHovering] = useState(false)

  useEffect(() => {
    if (!hovering) return
    const timer = window.setTimeout(() => {
      setVisible(true)
    }, SHOW_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [hovering])

  function hide() {
    setHovering(false)
    setVisible(false)
  }

  return (
    <span
      className="ui-tooltip-anchor"
      onPointerEnter={() => {
        setHovering(true)
      }}
      onPointerLeave={hide}
      onFocus={() => {
        setVisible(true)
      }}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide()
      }}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        role="tooltip"
        id={id}
        className={classNames('ui-tooltip', `ui-tooltip--${placement}`)}
        hidden={!visible}
      >
        {title}
        {detail}
      </span>
    </span>
  )
}
