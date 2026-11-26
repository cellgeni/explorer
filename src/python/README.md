# The `explorer` Python package

The app's Python console runs Python in Pyodide (NumPy is the only package). This
package gives the console the open dataset's cells as NumPy arrays and calls that
draw on the canvas:

```python
from explorer import cells, rois, view, color, highlight, show, others, clear

near = (cells.gene("CD3E") > 20) & (rois["ROI 1"].contains(cells))
color(near, "green", by=cells.area)
```

Coordinates are µm with y pointing down; arrays have one row per cell, in the
app's order. Arrays are cached until the dataset changes and are read-only
(`arr.copy()` gives a writable copy).

The package is pure Python and talks to the app only through a `Bridge`
(`explorer/_bridge.py`), which the app's worker passes to `explorer.connect()`. It
calls `explorer.invalidate()` whenever the dataset changes.

## Layout

- `explorer/__init__.py` — the public names.
- `explorer/_bridge.py` — the `Bridge` protocol, the errors it raises and the cache.
- `explorer/_cells.py` — `cells` and category columns (`Classes`).
- `explorer/_rois.py`, `explorer/_view.py` — `rois` and `view`.
- `explorer/_draw.py`, `explorer/_colors.py` — the drawing calls and the colours they take.
- `explorer/console.py` — the console's helpers: `is_complete`, `display`,
  `format_exception`, `complete`, `token_start`.
- `tests/` — pytest tests against `tests/fake_bridge.py`, an in-memory bridge.
  `tests/fixtures/contains.json` is shared with
  `src/data/roiSelectionContains.fixture.test.ts`, so the fake selects the cells the
  app does.

## Tests

With [uv](https://docs.astral.sh/uv/), from the repository root:

```sh
uv run --project src/python pytest src/python/tests
```
