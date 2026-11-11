import {
  TranscriptBudget,
  TranscriptColourControls,
  TranscriptDetails,
  TranscriptDisplayControls,
  TranscriptFeatureControls,
  TranscriptFilterControls,
  TranscriptPointStyleControls,
} from '../sections/TranscriptsSectionBlocks'
import type { TranscriptsSectionModel } from '../sections/transcriptsSectionModel'

interface TranscriptHudPanelProps {
  readonly active: boolean
  readonly transcripts: TranscriptsSectionModel
}

// The Transcripts tab: the Transcripts section's blocks.
export function TranscriptHudPanel({ active, transcripts }: TranscriptHudPanelProps) {
  return (
    <div
      id="hud-panel-transcripts"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-transcripts"
      hidden={!active}
    >
      <section
        className="analysis-section transcript-section"
        aria-labelledby="transcript-heading"
      >
        <div className="section-heading-row">
          <h2 id="transcript-heading">Transcripts</h2>
          <span
            className={transcripts.isLoading ? 'status-chip is-loading' : 'status-chip'}
            aria-live="polite"
          >
            {transcripts.headerCopy}
          </span>
        </div>

        <TranscriptDisplayControls transcripts={transcripts} />
        <TranscriptBudget transcripts={transcripts} />
        <TranscriptFeatureControls features={transcripts.features} />
        <TranscriptColourControls transcripts={transcripts} />
        <TranscriptFilterControls transcripts={transcripts} />
        <TranscriptPointStyleControls transcripts={transcripts} />
        <TranscriptDetails transcripts={transcripts} />
      </section>
    </div>
  )
}
