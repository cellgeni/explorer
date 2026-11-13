import { InfoIcon } from './icons'
import { Tooltip } from './Tooltip'

export interface InfoTipProps {
  // The term explained, such as "Combine genes"; the button is "About {title}".
  readonly title: string
  // The explanation: a sentence or two of plain text.
  readonly children: string
}

// A small ⓘ beside a control's label that explains a term (plan 15.3-B). The
// explanation shows on hover, on keyboard focus and on a tap, and describes
// the button for screen readers.
export function InfoTip({ title, children }: InfoTipProps) {
  return (
    <Tooltip title={children} align="start" wide>
      <button type="button" className="ui-info-tip" aria-label={`About ${title}`}>
        <InfoIcon />
      </button>
    </Tooltip>
  )
}
