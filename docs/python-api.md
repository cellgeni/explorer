# Python API

The [Python panel](ui-reference.md#python-panel) runs Python in the browser
(Pyodide, Python 3.14) with NumPy. It gives the open dataset's cells as NumPy
arrays, so you can choose cells with your own code. See
[plan 29](plan/phases/29-python-terminal.md) for the design.

The console needs WebAssembly JSPI, which Chrome and Edge have. The first
start downloads about 9 MB; later starts come from the browser's cache and
take about a second.

## What Is In Scope

When the console starts it runs:

```python
import numpy as np
from explorer import cells, rois, view, color, highlight, show, others, clear
from explorer import ReadTooLarge, ReadRefused, DataError
```

NumPy is the only package; `pandas` and `micropip` are not available.

- **Coordinates** are µm with y pointing down, as the canvas's ruler and the
  Cell card show them.
- **Rows** are the cells on the canvas, in the app's order: every array has
  `len(cells)` entries. In a collection, they are the open section's cells.
- **A mask** is a NumPy `bool` array with one entry per cell. Masks combine
  with `&`, `|` and `~`. Every call that takes a mask also takes row indices.
- **Arrays are read-only** and kept until the dataset or its cells change.
  `arr.copy()` gives a copy you can change.

## Data

| Expression                      | Gives                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `len(cells)`                    | The number of cells                                                                                         |
| `cells.id`                      | Cell IDs, as a NumPy array of strings                                                                       |
| `cells.x`, `cells.y`            | Centroids in µm (`float64`)                                                                                 |
| `cells.area`                    | Cell area in µm², where the platform gives it; NaN elsewhere                                                |
| `cells.transcripts`             | Transcript count, where the platform gives it; NaN elsewhere                                                |
| `cells.nuclei`                  | Nucleus count, where the platform gives it; NaN elsewhere                                                   |
| `cells.columns`                 | Every column by name, kind and group, as Cell Query lists them                                              |
| `cells["n_genes"]`              | A number column or metadata track: `float64`, NaN for no value                                              |
| `cells["leiden"]`               | A set of classes, as `Classes`: `.codes` (`int32`, −1 for none), `.labels`, `.counts()`                     |
| `cells["leiden"] == "3"`        | A mask: cells in the class, counting cells listed in more than one class                                    |
| `cells["leiden"].isin([…])`     | A mask: cells in any of the classes                                                                         |
| `cells.gene("CD3E")`            | The gene's value in every cell (`float32`): 0 where none is stored, NaN for a cell the matrix does not list |
| `cells.gene("CD3E", layer="…")` | An H5AD layer (`layers/<name>`), or `"raw"` for `raw/X`, instead of `X`                                     |
| `cells.gene_names`              | The genes the matrix lists                                                                                  |
| `cells.selected`                | The row of the cell the Cell card shows, or `None`                                                          |
| `rois`                          | Shapes by name: saved selections (`ROI 1`, …), the selection being drawn, then imported GeoJSON features    |
| `rois["ROI 1"].polygon`         | Vertices as an `(n, 2)` array in µm; a box as its four corners; a MultiPolygon as a list                    |
| `rois["ROI 1"].contains(cells)` | A mask: centroids inside the shape, as the canvas's own test decides                                        |
| `rois.current`                  | The selection drawn but not saved, or `None`                                                                |
| `view.center`, `view.bounds`    | The canvas's view in µm: `(x, y)` and `(min_x, min_y, max_x, max_y)`                                        |

`cells["…"]` takes a column's name as `cells.columns` lists it. A name that is
not there raises `KeyError` with the closest names. Repeated shape names get
` (2)`, ` (3)` and so on.

`Pick Point` in the panel writes the next point you click on the canvas into
the input, such as `(5210.4, 3180.9)`.

### What the matrix holds

`cells.gene` reads the matrix the app reads: counts on Xenium, Atera and
MERSCOPE, and `X` in an H5AD file or a SpatialData table, which is often
normalised. There, `layer="counts"` (or whichever layers the file has) reads
the counts. Other platforms have one matrix and raise an error naming it.

Gene reads keep the Plots panel's budget. Up to 32 MiB of matrix a read goes
ahead. Up to 256 MiB it raises `ReadTooLarge`, with the size and the call to
make: `cells.gene("CD3E", allow_large=True)`. Above that it raises
`ReadRefused`. A CSR matrix costs the same for any gene; once one gene of it
is read, others are quick.

## Drawing

Drawing calls make layers on the canvas. The canvas draws an input's layers
once, when the input ends, and an input that draws nothing does not redraw
it.

| Call                                     | Effect                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `color(mask, "green")`                   | The cells in `mask` turn green                                                  |
| `color(mask, "green", by=values)`        | A ramp from pale to full green over `values`; `vmin`, `vmax` and `reverse=True` |
| `color(mask, by=values, cmap="viridis")` | A colour map: `viridis`, `magma`, `inferno`, `plasma`, `cividis` or `turbo`     |
| `highlight(mask, color="white")`         | A ring around each cell in `mask`                                               |
| `show(mask)`, `show(None)`               | Only the cells in `mask` are drawn; `show(None)` draws every cell again         |
| `others("fade")`, `others("hide")`       | Cells in no colour layer are faded or not drawn                                 |
| `clear()`, `clear("name")`               | Removes every layer, or one                                                     |

Each takes `name=`; without one the layer is called `Result`, so running an
input again replaces its result. A colour layer and a highlight can share a
name; `clear("name")` removes both. Colours are CSS names or hex.

- **Colour layers draw over the colour mode**, gene expression included. A
  cell takes the colour of the last layer that holds it; a redrawn layer goes
  on top. Their outlines take the same colour.
- **Ramps** run from `vmin` to `vmax`, by default the range of `values` over
  the masked cells; values outside are drawn at the ends. A single-hue ramp
  starts pale. NaN is drawn as the ramp's low end, the pale colour of a
  single-hue ramp, whatever `reverse` says.
- **Other cells** fade while any colour layer is drawn, as hidden classes
  do. `others("hide")` leaves them out instead. With no colour layer,
  `others()` changes nothing.
- **Hidden cells**, by `show` or `others("hide")`, are not drawn, hovered or
  picked, and nor are their outlines; their highlights are left out.
- **Layers live in the app**, not in Python: `Stop` and a restart keep them.
  A new dataset, or new cells for it, clears them. `clear()` starts over:
  it removes every layer and the `show` mask, and sets `others("fade")`.
- **The legend** lists the layers under _Python_, first, each with its swatch
  or ramp, its count and a button to clear it, and the cells `show` keeps
  with a button to show every cell. Screenshots include them.

## Examples

Cells with gene CD3E over 20 within 250 µm of a point, shaded by distance:

```python
x0, y0 = (5210.4, 3180.9)                  # from Pick Point
d = np.hypot(cells.x - x0, cells.y - y0)   # µm
near = (cells.gene("CD3E") > 20) & (d <= 250)
near                                       # mask: 1,234 of 1,414,155 cells
color(near, "green", by=d, reverse=True)
```

Cells in ROI 1 with area over 50 µm², and cells in ROI 2 with gene Y over 99:

```python
a = rois["ROI 1"].contains(cells) & (cells.area > 50)
b = rois["ROI 2"].contains(cells) & (cells.gene("Y", layer="counts") > 99)
color(a | b, "orange", name="ROI picks")
others("hide")
```

Counting cells per class inside a shape:

```python
inside = rois["Tumour"].contains(cells)
clusters = cells["graphclust"]
{label: int((clusters == label)[inside].sum()) for label in clusters.labels}
```

## Stop

`Stop` ends the input running. On GitHub Pages it starts a new Python, and
your variables and imports are lost. Where the page is cross-origin isolated
(the development and preview servers), it raises `KeyboardInterrupt` and
keeps them.
