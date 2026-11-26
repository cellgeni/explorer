"""The open dataset's cells as NumPy arrays, and calls that draw on the app's canvas.

    from explorer import cells, rois, view, color, highlight, show, others, clear

Coordinates are µm with y pointing down. Arrays have one row per cell in the
app's order (len(cells) rows), are cached until the dataset changes, and are
read-only: arr.copy() gives a writable copy.

The app calls connect(bridge) once and invalidate() whenever the dataset changes.
"""

from . import console as console
from ._bridge import Bridge as Bridge
from ._bridge import DataError, ExplorerError, ReadRefused, ReadTooLarge
from ._bridge import connect as connect
from ._bridge import invalidate as invalidate
from ._cells import Cells as Cells
from ._cells import Classes as Classes
from ._cells import Column as Column
from ._cells import Columns as Columns
from ._draw import clear, color, highlight, others, show
from ._rois import Roi as Roi
from ._rois import Rois as Rois
from ._view import View as View

cells = Cells()
rois = Rois()
view = View()

# What `from explorer import *` gives the console. The names imported `as`
# themselves above are public too, for the app's worker and type hints.
__all__ = [
    "DataError",
    "ExplorerError",
    "ReadRefused",
    "ReadTooLarge",
    "cells",
    "clear",
    "color",
    "highlight",
    "others",
    "rois",
    "show",
    "view",
]
