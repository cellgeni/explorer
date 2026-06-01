import type { FormEvent } from 'react'
import { useId, useState } from 'react'

const DEMO_DATASET_URL =
  'https://mp33.cog.sanger.ac.uk/public/xenium/output-XETG00155__0033412__Sob23-BRA-0-FFPE-2-s30__20240829__110328'

const scaffoldLayers = ['cells', 'boundaries', 'image'] as const

export function App() {
  const datasetInputId = useId()
  const [queuedDatasetUrl, setQueuedDatasetUrl] = useState(DEMO_DATASET_URL)

  function handleDatasetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const datasetUrl = formData.get('datasetUrl')

    if (typeof datasetUrl === 'string' && datasetUrl.trim().length > 0) {
      setQueuedDatasetUrl(datasetUrl.trim())
    }
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#viewer-heading">
        Skip To Spatial View
      </a>
      <aside className="control-rail" aria-label="Dataset controls">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">CellGeni</p>
            <h1>Xenium Explorer</h1>
          </div>
        </div>

        <form className="dataset-form" onSubmit={handleDatasetSubmit}>
          <label htmlFor={datasetInputId}>Dataset URL</label>
          <input
            id={datasetInputId}
            name="datasetUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            defaultValue={DEMO_DATASET_URL}
            placeholder="https://bucket.example/output…"
          />
          <button type="submit">Load Dataset</button>
        </form>

        <section className="layer-section" aria-labelledby="layer-heading">
          <h2 id="layer-heading">Layer Stack</h2>
          <ul>
            {scaffoldLayers.map((layerName) => (
              <li key={layerName}>
                <span className={`layer-dot layer-dot-${layerName}`} aria-hidden="true" />
                <span>{layerName}</span>
              </li>
            ))}
          </ul>
        </section>
      </aside>

      <section className="viewer-region" aria-labelledby="viewer-heading">
        <header className="viewer-toolbar">
          <div>
            <p className="eyebrow">Phase 1</p>
            <h2 id="viewer-heading">Spatial View</h2>
          </div>
          <p className="dataset-status" aria-live="polite">
            Queued dataset: <span translate="no">{queuedDatasetUrl}</span>
          </p>
        </header>

        <div
          className="viewport-frame"
          role="img"
          aria-label="Spatial viewer canvas area"
        >
          <div className="viewport-grid" aria-hidden="true" />
          <div className="cell-field" aria-hidden="true">
            <span className="cell-node cell-node-a" />
            <span className="cell-node cell-node-b" />
            <span className="cell-node cell-node-c" />
            <span className="cell-node cell-node-d" />
          </div>
        </div>
      </section>
    </main>
  )
}
