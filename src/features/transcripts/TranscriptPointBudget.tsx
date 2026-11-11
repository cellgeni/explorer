import { useId, useState } from 'react'
import { Button, NumberField } from '../../components/ui'
import { classNames } from '../../components/ui/classNames'
import {
  MAX_TRANSCRIPT_EXACT_RENDER_LIMIT,
  MIN_TRANSCRIPT_EXACT_RENDER_LIMIT,
} from '../../data/transcriptOverlay'

interface TranscriptPointBudgetProps {
  // The transcripts an exact read would load in this view.
  readonly estimate: number
  readonly limit: number
  readonly onLimitChange: (limit: number) => void
}

// The exact point budget as a meter (UNIFIED_PLAN.md, 15.1-J): this view's
// transcripts against the budget, which Edit Max changes. Auto shows exact
// points while the meter is not full.
export function TranscriptPointBudget({
  estimate,
  limit,
  onLimitChange,
}: TranscriptPointBudgetProps) {
  const labelId = useId()
  const [editing, setEditing] = useState(false)
  const text = `${estimate.toLocaleString()} of ${limit.toLocaleString()} points`
  const share = Math.min(1, estimate / Math.max(1, limit))

  return (
    <div className="transcript-budget">
      <div className="transcript-budget-header">
        <span id={labelId}>Exact points</span>
        <Button
          variant="ghost"
          title="Change the most points exact detail loads"
          aria-expanded={editing}
          onClick={() => {
            setEditing((current) => !current)
          }}
        >
          Edit Max
        </Button>
      </div>
      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(estimate, limit)}
        aria-valuetext={text}
        className={classNames('transcript-budget-meter', estimate > limit && 'is-over')}
      >
        <span style={{ width: `${(share * 100).toFixed(1)}%` }} />
      </div>
      <p className="transcript-budget-text">{text}</p>
      {editing ? (
        <NumberField
          title="Transcript exact point budget"
          label="Exact budget"
          value={limit}
          min={MIN_TRANSCRIPT_EXACT_RENDER_LIMIT}
          max={MAX_TRANSCRIPT_EXACT_RENDER_LIMIT}
          step={1000}
          onChange={onLimitChange}
        />
      ) : null}
    </div>
  )
}
