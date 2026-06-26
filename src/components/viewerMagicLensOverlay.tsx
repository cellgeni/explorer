import type { CSSProperties } from 'react'
import type { ViewerMagicLensStatus, ViewerMagicLensSummary } from './viewerCoreTypes'
import type { MagicLensOverlayModel } from './viewerMagicLensModel'

export function MagicLensOverlay({
  model,
  status,
  summary,
}: {
  readonly model: MagicLensOverlayModel
  readonly status: ViewerMagicLensStatus
  readonly summary: ViewerMagicLensSummary | null
}) {
  const topGenes = summary?.topGenes.slice(0, 8) ?? []
  const maxCount = Math.max(...topGenes.map((gene) => gene.count), 1)

  return (
    <div className="viewer-magic-lens" aria-hidden="true">
      <span className="viewer-magic-lens-circle" style={model.circleStyle} />
      {status === 'idle' && summary === null ? null : (
        <div className="viewer-magic-lens-hud" style={model.hudStyle}>
          <p>
            {summary === null
              ? 'Scanning lens'
              : `${summary.cellCount.toLocaleString()} ${magicLensElementShortLabel(summary)} - ${summary.transcriptCount.toLocaleString()} ${magicLensPrimaryMetricShortLabel(summary)}`}
          </p>
          {status === 'loading' ? <small>Loading expression…</small> : null}
          {topGenes.length === 0 && status !== 'loading' ? (
            <small>No detected genes</small>
          ) : null}
          {topGenes.length === 0 ? null : (
            <ol>
              {topGenes.map((gene) => (
                <li
                  key={gene.gene}
                  className={gene.selected ? 'is-selected' : undefined}
                  style={
                    {
                      '--viewer-magic-lens-gene-width': `${Math.max(
                        4,
                        (gene.count / maxCount) * 100,
                      )}%`,
                    } as CSSProperties
                  }
                >
                  <span>{gene.gene}</span>
                  <strong>{gene.count.toLocaleString()}</strong>
                  <i />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

function magicLensElementShortLabel(summary: ViewerMagicLensSummary): string {
  return summary.kind === 'expression' ? 'bins' : 'cells'
}

function magicLensPrimaryMetricShortLabel(summary: ViewerMagicLensSummary): string {
  return summary.kind === 'expression' ? 'UMI' : 'tx'
}
