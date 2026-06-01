export function ViewerCore() {
  return (
    <div className="viewport-frame" role="img" aria-label="Spatial viewer canvas area">
      <canvas className="morphology-canvas" aria-hidden="true" />
      <div className="viewport-grid" aria-hidden="true" />
      <div className="deck-layer-surface" aria-hidden="true">
        <div className="cell-field">
          <span className="cell-node cell-node-a" />
          <span className="cell-node cell-node-b" />
          <span className="cell-node cell-node-c" />
          <span className="cell-node cell-node-d" />
        </div>
      </div>
    </div>
  )
}
