"""The app's ROIs (selections, features and the current selection), read fresh each time."""

from collections.abc import Iterator, Mapping
from typing import Any

import numpy as np

from ._bridge import get_bridge
from ._cells import Cells, as_column
from ._text import NotFound, suggest


def _vertex_count(polygon: np.ndarray) -> int:
    """Vertices, not counting a closing vertex that repeats the first."""
    if len(polygon) > 1 and np.array_equal(polygon[0], polygon[-1]):
        return len(polygon) - 1
    return len(polygon)


class Roi:
    """One ROI: its name, kind and polygon, and which cells it contains."""

    def __init__(self, entry: dict[str, Any], name: str) -> None:
        self._entry = entry
        self._polygons = [
            np.array(polygon, dtype=np.float64).reshape(-1, 2) for polygon in entry["polygons"]
        ]
        self.name = name

    @property
    def kind(self) -> str:
        """The kind: "selection", "feature" or "current"."""
        return str(self._entry["kind"])

    @property
    def key(self) -> str:
        """The app's key for this ROI."""
        return str(self._entry["key"])

    @property
    def box(self) -> bool:
        """True for a box (its polygon is the four corners)."""
        return bool(self._entry.get("box", False))

    @property
    def polygon(self) -> np.ndarray | list[np.ndarray]:
        """The (n, 2) vertices in µm, or a list of them when there are several polygons."""
        polygons = [polygon.copy() for polygon in self._polygons]
        return polygons[0] if len(polygons) == 1 else polygons

    def contains(self, cells: Cells) -> np.ndarray:
        """A mask of the cells inside this ROI; pass `cells`."""
        if not isinstance(cells, Cells):
            raise TypeError(
                f"contains() takes cells, as rois[...].contains(cells); got {type(cells).__name__}."
            )
        return as_column(get_bridge().contains(self.key), np.bool_, f'ROI "{self.name}" mask')

    def __repr__(self) -> str:
        return f'<ROI "{self.name}": {self._describe()}>'

    def _describe(self) -> str:
        prefix = "current " if self.kind == "current" else ""
        if self.kind == "feature":
            shape = "feature"
        elif self.box:
            shape = prefix + "box"
        else:
            shape = prefix + "lasso"
        if self.box and len(self._polygons) == 1:
            corners = self._polygons[0]
            width, height = np.ptp(corners, axis=0) if len(corners) else (0.0, 0.0)
            return f"{shape}, {width:,.1f} × {height:,.1f} µm"
        vertices = sum(_vertex_count(polygon) for polygon in self._polygons)
        if len(self._polygons) > 1:
            return f"{shape}, {len(self._polygons)} polygons, {vertices:,} vertices"
        return f"{shape}, {vertices:,} vertices"


def _named(entries: list[dict[str, Any]]) -> dict[str, Roi]:
    """ROIs by name, in the app's order; repeated names get " (2)", " (3)"."""
    named: dict[str, Roi] = {}
    for entry in entries:
        base = str(entry["name"])
        name, copy = base, 1
        while name in named:
            copy += 1
            name = f"{base} ({copy})"
        named[name] = Roi(entry, name)
    return named


class Rois(Mapping[str, Roi]):
    """The app's ROIs by name. Read fresh on each use, since shapes change."""

    def _all(self) -> dict[str, Roi]:
        return _named(list(get_bridge().rois()))

    def __getitem__(self, name: str) -> Roi:
        named = self._all()
        if name in named:
            return named[name]
        if not named:
            raise NotFound(f'No ROI "{name}": the app has no ROIs yet.')
        raise NotFound(
            f'No ROI "{name}".' + suggest(str(name), named) + " Print rois for the names."
        )

    def __contains__(self, name: object) -> bool:
        return name in self._all()

    def __iter__(self) -> Iterator[str]:
        return iter(list(self._all()))

    def __len__(self) -> int:
        return len(get_bridge().rois())

    @property
    def current(self) -> Roi | None:
        """The app's current selection, or None."""
        for roi in self._all().values():
            if roi.kind == "current":
                return roi
        return None

    def __repr__(self) -> str:
        names = list(self._all())
        if not names:
            return "<rois: none yet>"
        return "<rois: " + ", ".join(f'"{name}"' for name in names) + ">"
