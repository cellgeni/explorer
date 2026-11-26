"""Calls that draw on the app's canvas. Each validates, then sends one command."""

from typing import Any

import numpy as np

from ._bridge import get_bridge
from ._cells import Classes, size
from ._colors import parse_cmap, parse_color
from ._text import count_noun

DEFAULT_NAME = "Result"
OTHERS_MODES = ("fade", "hide")


def rows_of(mask: Any) -> np.ndarray:
    """A mask (bool per cell, or row numbers) as sorted unique uint32 rows."""
    if isinstance(mask, Classes):
        raise TypeError(
            "A category column is not a mask; compare it with a class first, "
            'as cells["Cell type"] == "T cell".'
        )
    if mask is None or isinstance(mask, bool | np.bool_):
        raise TypeError(
            "A mask is a True/False array with one value per cell, or a list of rows; "
            f"got {mask!r}."
        )
    count, noun = size()
    array = np.asarray(mask)
    if array.dtype == np.bool_:
        return _rows_of_bools(array, count, noun)
    if array.size == 0:
        return np.zeros(0, dtype=np.uint32)
    if array.dtype.kind not in "iu":
        raise TypeError(
            "A mask is a True/False array with one value per cell, or whole row numbers; "
            f"got an array of {array.dtype}."
        )
    array = array.reshape(-1) if array.ndim == 0 else array
    if array.ndim != 1:
        raise ValueError(f"A mask is one-dimensional; this one has shape {array.shape}.")
    low, high = int(array.min()), int(array.max())
    if low < 0 or high >= count:
        bad = low if low < 0 else high
        raise ValueError(
            f"Row {bad:,} is out of range: the dataset has {count_noun(count, noun)} "
            f"(rows 0 to {count - 1:,})."
        )
    return np.unique(array).astype(np.uint32)


def _rows_of_bools(array: np.ndarray, count: int, noun: str) -> np.ndarray:
    if array.ndim != 1:
        raise ValueError(f"A mask is one-dimensional; this one has shape {array.shape}.")
    if len(array) != count:
        raise ValueError(
            f"This mask has {len(array):,} entries but the dataset has "
            f"{count_noun(count, noun)} — was it made for another dataset?"
        )
    return np.flatnonzero(array).astype(np.uint32)


def _layer_name(name: Any) -> str:
    if name is None:
        return DEFAULT_NAME
    if not isinstance(name, str):
        raise TypeError(f"name is text; got {type(name).__name__}.")
    if not name.strip():
        raise ValueError("name cannot be blank.")
    return name


def _values(by: Any, rows: np.ndarray) -> np.ndarray:
    """by (one number per cell) at rows, as float64."""
    if isinstance(by, Classes):
        raise TypeError("by= takes numbers, not a category column; use one color() per class.")
    values = np.asarray(by)
    if values.dtype.kind not in "biuf":
        raise TypeError(f"by= takes one number per cell; got an array of {values.dtype}.")
    count, noun = size()
    if values.shape != (count,):
        raise ValueError(
            f"by= has {values.size:,} values but the dataset has {count_noun(count, noun)}."
        )
    return values[rows].astype(np.float64)


def _limit(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float | np.integer | np.floating):
        raise TypeError(f"{label} is a number; got {type(value).__name__}.")
    if not np.isfinite(value):
        raise ValueError(f"{label} must be finite; got {value}.")
    return float(value)


def _range(values: np.ndarray, vmin: Any, vmax: Any) -> tuple[float, float]:
    """vmin and vmax, defaulting to the finite range of values (0 to 1 if none)."""
    finite = values[np.isfinite(values)]
    low, high = (float(finite.min()), float(finite.max())) if finite.size else (0.0, 1.0)
    low = low if vmin is None else _limit(vmin, "vmin")
    high = high if vmax is None else _limit(vmax, "vmax")
    if vmin is not None and vmax is not None and low > high:
        raise ValueError(f"vmin ({low:g}) is above vmax ({high:g}); use reverse=True to flip.")
    return low, high


def color(
    mask: Any,
    color: str | None = None,
    *,
    by: Any = None,
    vmin: float | None = None,
    vmax: float | None = None,
    reverse: bool = False,
    cmap: str | None = None,
    name: str | None = None,
) -> None:
    """Colour the masked cells.

    color("red") alone paints one colour; with by= (one number per cell) it
    shades from pale to that colour. cmap= with by= uses a colour map
    (viridis, magma, inferno, plasma, cividis, turbo). vmin and vmax default
    to the range of by over the masked cells.
    """
    rows = rows_of(mask)
    if color is not None and cmap is not None:
        raise ValueError("Give color or cmap, not both.")
    if color is None and cmap is None:
        raise ValueError('Give a color (as "orange") or, with by=, a cmap (as "viridis").')
    if cmap is not None and by is None:
        raise ValueError("cmap needs by= (one number per cell) to colour by.")
    hex_color = None if color is None else parse_color(color)
    map_name = None if cmap is None else parse_cmap(cmap)
    command: dict[str, Any] = {
        "op": "color",
        "name": _layer_name(name),
        "rows": rows,
        "color": hex_color,
        "cmap": map_name,
        "values": None,
        "vmin": None,
        "vmax": None,
        "reverse": False,
    }
    if by is None:
        if vmin is not None or vmax is not None or reverse:
            raise ValueError("vmin, vmax and reverse need by= (one number per cell).")
    else:
        values = _values(by, rows)
        low, high = _range(values, vmin, vmax)
        command.update(values=values.astype(np.float32), vmin=low, vmax=high, reverse=bool(reverse))
    get_bridge().draw(command)


def highlight(mask: Any, color: str = "white", *, name: str | None = None) -> None:
    """Outline the masked cells."""
    rows = rows_of(mask)
    command = {
        "op": "highlight",
        "name": _layer_name(name),
        "rows": rows,
        "color": parse_color(color),
    }
    get_bridge().draw(command)


def show(mask: Any = None) -> None:
    """Show only the masked cells; show(None) shows every cell again."""
    rows = None if mask is None else rows_of(mask)
    get_bridge().draw({"op": "show", "rows": rows})


def others(mode: str) -> None:
    """What happens to cells no layer colours: "fade" or "hide"."""
    if mode not in OTHERS_MODES:
        raise ValueError(f'others() takes "fade" or "hide"; got {mode!r}.')
    get_bridge().draw({"op": "others", "mode": mode})


def clear(name: str | None = None) -> None:
    """Remove the layer with this name, or every layer when no name is given."""
    if name is not None and not isinstance(name, str):
        raise TypeError(f"name is text; got {type(name).__name__}.")
    get_bridge().draw({"op": "clear", "name": name})
