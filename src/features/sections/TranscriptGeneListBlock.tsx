import type { CSSProperties } from 'react'
import { Button } from '../../components/ui'
import type { TranscriptGeneLegendModel } from '../transcripts/useTranscriptGeneLegend'

// The genes coloured on the canvas (plan 15.4-C): each with its
// swatch (editable), an eye and its count of points in view, as in 10x
// Explorer. The canvas legend shows the same list.
export function TranscriptGeneList({
  geneLegend: model,
}: {
  readonly geneLegend: TranscriptGeneLegendModel
}) {
  if (!model.active) {
    return model.note === null ? null : (
      <p className="transcript-gene-note">{model.note}</p>
    )
  }

  if (model.items.length === 0) return null

  return (
    <section className="transcript-gene-panel" aria-label="Transcript genes">
      <ul
        className="annotation-list transcript-gene-list"
        aria-label="Transcript gene colours"
      >
        {model.items.map((item) => (
          <li key={item.gene} className={item.visible ? undefined : 'is-hidden'}>
            <label
              className="annotation-color-picker"
              style={{ '--annotation-color': item.color } as CSSProperties}
            >
              <input
                className="annotation-color-input"
                type="color"
                aria-label={`${item.gene} transcript color`}
                value={item.color}
                title={`${item.gene} transcript color`}
                onChange={(event) => {
                  model.onColorChange(item.gene, event.currentTarget.value)
                }}
              />
              <span className="annotation-color-swatch" aria-hidden="true" />
            </label>
            <label className="annotation-visibility-toggle">
              <input
                type="checkbox"
                checked={item.visible}
                aria-label={`${item.gene} transcripts visible`}
                title={`${item.visible ? 'Hide' : 'Show'} ${item.gene} transcripts`}
                onChange={(event) => {
                  model.onVisibilityChange(item.gene, event.currentTarget.checked)
                }}
              />
            </label>
            <span>{item.gene}</span>
            <small title="Points loaded in view">{item.count.toLocaleString()}</small>
          </li>
        ))}
      </ul>
      {model.moreCount > 0 || model.hiddenCount > 0 ? (
        <div className="transcript-gene-footer">
          {model.moreCount > 0 ? (
            <small>
              +{model.moreCount.toLocaleString()} more{' '}
              {model.moreCount === 1 ? 'gene' : 'genes'} in view
            </small>
          ) : (
            <span />
          )}
          {model.hiddenCount > 0 ? (
            <Button
              title="Show every hidden gene's transcripts"
              variant="ghost"
              onClick={model.onShowAll}
            >
              Show All
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
