"""The bridge to the app: its protocol, the errors it raises, and the array cache."""

from collections.abc import Callable
from typing import Any, Protocol

import numpy as np


class ExplorerError(Exception):
    """Base class of the errors the app reports."""


class ReadTooLarge(ExplorerError):
    """A read the app would not start without allow_large=True."""

    def __init__(self, message: str, bytes: int) -> None:
        super().__init__(message)
        self.bytes = bytes


class ReadRefused(ExplorerError):
    """A read the app will not do at all, even with allow_large=True."""

    def __init__(self, message: str, bytes: int) -> None:
        super().__init__(message)
        self.bytes = bytes


class DataError(ExplorerError):
    """The app could not read or find the data asked for."""


class Bridge(Protocol):
    """What the app gives Python. Every method is synchronous."""

    def dataset(self) -> dict[str, Any]:
        """{"name", "count", "noun", "columns": [{"id", "label", "kind", "group"}],
        "has_genes", "layers"}."""
        ...

    def positions(self) -> tuple[np.ndarray, np.ndarray]:
        """x and y in µm (y down), float64, one per cell."""
        ...

    def cell_ids(self) -> list[str]: ...

    def number_column(self, column_id: str) -> np.ndarray:
        """float64, NaN where a cell has no value."""
        ...

    def category_column(self, column_id: str) -> dict[str, Any]:
        """{"codes", "labels", "extra_rows", "extra_codes"}."""
        ...

    def gene_names(self) -> list[str]: ...

    def gene(self, name: str, layer: str | None, allow_large: bool) -> np.ndarray:
        """float32, one per cell."""
        ...

    def selected(self) -> int | None: ...

    def rois(self) -> list[dict[str, Any]]:
        """[{"key", "name", "kind", "polygons", "box"}]."""
        ...

    def contains(self, key: str) -> np.ndarray:
        """bool, one per cell: inside the ROI with this key."""
        ...

    def view(self) -> dict[str, Any]:
        """{"center": (x, y), "bounds": (min_x, min_y, max_x, max_y)}."""
        ...

    def draw(self, command: dict[str, Any]) -> None: ...


class _State:
    bridge: Bridge | None = None
    cache: dict[tuple[str, ...], Any] = {}


def connect(bridge: Bridge) -> None:
    """Use this bridge from now on, and forget every cached array."""
    _State.bridge = bridge
    invalidate()


def invalidate() -> None:
    """Forget every cached array (the dataset changed)."""
    _State.cache = {}


def get_bridge() -> Bridge:
    """The connected bridge."""
    if _State.bridge is None:
        raise ExplorerError("No dataset is open.")
    return _State.bridge


def cached[T](key: tuple[str, ...], read: Callable[[], T]) -> T:
    """The cached value for key, reading it the first time."""
    cache = _State.cache
    if key not in cache:
        cache[key] = read()
    return cache[key]


def frozen(array: np.ndarray) -> np.ndarray:
    """Mark array read-only, for the cache."""
    array.flags.writeable = False
    return array


def read_only(array: np.ndarray) -> np.ndarray:
    """A read-only view of a cached array; its base cannot be made writable."""
    view = array.view()
    view.flags.writeable = False
    return view
