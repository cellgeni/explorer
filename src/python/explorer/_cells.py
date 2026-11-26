"""The open dataset's cells as NumPy arrays, one row per cell in the app's order."""

from collections.abc import Iterable
from typing import Any, NamedTuple

import numpy as np

from ._bridge import DataError, cached, frozen, get_bridge, read_only
from ._text import NotFound, count_noun, suggest

AREA = "cell:cellArea"
TRANSCRIPTS = "cell:transcriptCount"
NUCLEI = "cell:nucleusCount"


def dataset() -> dict[str, Any]:
    """The bridge's description of the open dataset (read fresh)."""
    return get_bridge().dataset()


def size() -> tuple[int, str]:
    """The number of cells and the dataset's noun for them."""
    info = dataset()
    return int(info["count"]), str(info.get("noun") or "cells")


def as_column(values: Any, dtype: type, what: str) -> np.ndarray:
    """values copied to a 1-D array of dtype, checked to have one per cell."""
    count, noun = size()
    array = np.array(values, dtype=dtype)
    if array.shape != (count,):
        raise DataError(
            f"The app sent {what} with {array.size:,} values for {count_noun(count, noun)}."
        )
    return array


class Column(NamedTuple):
    """One column the dataset lists: cells[label] reads it."""

    label: str
    kind: str
    group: str


class Columns(list[Column]):
    """The dataset's columns, printed grouped."""

    def __repr__(self) -> str:
        if not self:
            return "<no columns>"
        width = max(len(column.label) for column in self)
        lines: list[str] = []
        for group in dict.fromkeys(column.group for column in self):
            lines.append(f"{group}:")
            lines.extend(
                f"  {column.label:<{width}}  {column.kind}"
                for column in self
                if column.group == group
            )
        return "\n".join(lines)


class Classes:
    """A category column: each cell's class, as codes into labels.

    A cell can be in more than one class (as with sets); `==`, `isin` and
    `counts` count those extra classes too. len() is the number of cells.
    """

    def __init__(
        self,
        label: str,
        codes: np.ndarray,
        labels: list[str],
        extra_rows: np.ndarray,
        extra_codes: np.ndarray,
    ) -> None:
        self._label = label
        self._codes = codes
        self._labels = labels
        self._extra_rows = extra_rows
        self._extra_codes = extra_codes

    @property
    def codes(self) -> np.ndarray:
        """Each cell's first class as an index into labels (int32, −1 = none)."""
        return read_only(self._codes)

    @property
    def labels(self) -> list[str]:
        """The class names, in the app's order."""
        return list(self._labels)

    def __len__(self) -> int:
        return len(self._codes)

    def _index(self, label: Any) -> int:
        if isinstance(label, int | np.integer) and not isinstance(label, bool | np.bool_):
            label = str(label)
        if not isinstance(label, str):
            raise TypeError(f"Class labels are text; got {type(label).__name__}.")
        try:
            return self._labels.index(label)
        except ValueError:
            raise NotFound(
                f'"{self._label}" has no class "{label}".'
                + suggest(label, self._labels)
                + " See .labels for the list."
            ) from None

    def _mask(self, index: int) -> np.ndarray:
        mask = self._codes == index
        mask[self._extra_rows[self._extra_codes == index]] = True
        return mask

    def __eq__(self, other: object) -> Any:  # type: ignore[override]
        if isinstance(other, str | int | np.integer) and not isinstance(other, bool):
            return self._mask(self._index(other))
        return NotImplemented

    def __ne__(self, other: object) -> Any:  # type: ignore[override]
        mask = self.__eq__(other)
        return mask if mask is NotImplemented else ~mask

    __hash__ = None  # type: ignore[assignment]

    def isin(self, labels: Iterable[Any] | str) -> np.ndarray:
        """True for cells in any of these classes."""
        if isinstance(labels, str):
            labels = [labels]
        mask = np.zeros(len(self._codes), dtype=bool)
        for label in labels:
            mask |= self._mask(self._index(label))
        return mask

    def counts(self) -> dict[str, int]:
        """How many cells each class has; a cell in several classes counts in each."""
        size = len(self._labels)
        totals = np.bincount(self._codes[self._codes >= 0], minlength=size)[:size]
        # Extra classes, once per cell and class, leaving out each cell's first class.
        rows, codes = self._extra_rows, self._extra_codes
        keep = (codes >= 0) & (self._codes[rows] != codes)
        pairs = np.unique(rows[keep].astype(np.int64) * max(size, 1) + codes[keep])
        extra = (pairs % max(size, 1)).astype(np.intp)
        totals = totals + np.bincount(extra, minlength=size)[:size]
        return {label: int(total) for label, total in zip(self._labels, totals, strict=True)}

    def __repr__(self) -> str:
        counts = self.counts()
        head = f'<classes "{self._label}": {len(counts):,} classes, {len(self._codes):,} cells>'
        shown = list(counts.items())[:20]
        unassigned = int(np.count_nonzero(self._codes < 0))
        if unassigned:
            shown.append(("(none)", unassigned))
        if not shown:
            return head
        width = max(len(label) for label, _ in shown)
        lines = [head, *(f"  {label:<{width}}  {total:>10,}" for label, total in shown)]
        if len(counts) > 20:
            lines.append(f"  … {len(counts) - 20:,} more; see .counts()")
        return "\n".join(lines)


def _classes(column: dict[str, Any]) -> Classes:
    raw = get_bridge().category_column(column["id"])
    codes = frozen(as_column(raw["codes"], np.int32, f'"{column["label"]}" codes'))
    labels = [str(label) for label in raw["labels"]]
    extra_rows = frozen(np.array(raw.get("extra_rows", []), dtype=np.int32).reshape(-1))
    extra_codes = frozen(np.array(raw.get("extra_codes", []), dtype=np.int32).reshape(-1))
    if extra_rows.shape != extra_codes.shape:
        raise DataError(f'The app sent "{column["label"]}" with unpaired extra classes.')
    return Classes(str(column["label"]), codes, labels, extra_rows, extra_codes)


def _number(column_id: str, label: str) -> np.ndarray:
    def read() -> np.ndarray:
        values = get_bridge().number_column(column_id)
        return frozen(as_column(values, np.float64, f'"{label}"'))

    return cached(("number", column_id), read)


def _missing() -> np.ndarray:
    count, _ = size()
    return cached(("missing",), lambda: frozen(np.full(count, np.nan)))


def _positions() -> tuple[np.ndarray, np.ndarray]:
    def read() -> tuple[np.ndarray, np.ndarray]:
        x, y = get_bridge().positions()
        return (
            frozen(as_column(x, np.float64, "x positions")),
            frozen(as_column(y, np.float64, "y positions")),
        )

    return cached(("positions",), read)


def _check_layer(layer: str | None, layers: list[str]) -> None:
    if layer is None:
        return
    if not isinstance(layer, str):
        raise TypeError(f"layer is a layer name; got {type(layer).__name__}.")
    if layer in layers:
        return
    if not layers:
        raise ValueError(f'This dataset has no layers, so there is no "{layer}"; leave layer out.')
    raise ValueError(f'This dataset has no layer "{layer}". Its layers: {", ".join(layers)}.')


class Cells:
    """The open dataset's cells: one row per cell, in the app's order.

    Arrays are cached until the dataset changes and are read-only;
    `arr.copy()` gives a writable copy.
    """

    def __len__(self) -> int:
        return size()[0]

    def __repr__(self) -> str:
        info = dataset()
        count = int(info["count"])
        return f"<cells: {count_noun(count, str(info.get('noun') or 'cells'))} — {info['name']}>"

    @property
    def id(self) -> np.ndarray:
        """Each cell's ID (str)."""

        def read() -> np.ndarray:
            return frozen(as_column(get_bridge().cell_ids(), np.str_, "cell IDs"))

        return read_only(cached(("ids",), read))

    @property
    def x(self) -> np.ndarray:
        """x in µm (float64)."""
        return read_only(_positions()[0])

    @property
    def y(self) -> np.ndarray:
        """y in µm, pointing down (float64)."""
        return read_only(_positions()[1])

    @property
    def area(self) -> np.ndarray:
        """Cell area in µm² (float64); all NaN when the dataset has none."""
        return self._cell_column(AREA)

    @property
    def transcripts(self) -> np.ndarray:
        """Transcripts per cell (float64); all NaN when the dataset has none."""
        return self._cell_column(TRANSCRIPTS)

    @property
    def nuclei(self) -> np.ndarray:
        """Nuclei per cell (float64); all NaN when the dataset has none."""
        return self._cell_column(NUCLEI)

    def _cell_column(self, column_id: str) -> np.ndarray:
        for column in dataset()["columns"]:
            if column["id"] == column_id:
                return read_only(_number(column_id, str(column["label"])))
        return read_only(_missing())

    @property
    def columns(self) -> Columns:
        """The columns cells[label] can read: (label, kind, group)."""
        return Columns(
            Column(str(column["label"]), str(column["kind"]), str(column["group"]))
            for column in dataset()["columns"]
        )

    def __getitem__(self, name: str) -> Any:
        """A column by label, else by ID: float64 for numbers, Classes for categories."""
        if not isinstance(name, str):
            raise TypeError(
                'cells[...] takes a column name, as cells["Cell type"]; '
                "to pick rows, index an array: cells.x[mask]."
            )
        column = _find_column(name)
        if column["kind"] == "number":
            return read_only(_number(column["id"], str(column["label"])))
        if column["kind"] == "category":
            return cached(("category", column["id"]), lambda: _classes(column))
        raise DataError(f'"{name}" is a {column["kind"]} column, which Python cannot read.')

    def gene(self, name: str, layer: str | None = None, allow_large: bool = False) -> np.ndarray:
        """One gene's expression per cell (float32), from layer (an H5AD layer) if given.

        allow_large=True starts a read the app would otherwise refuse as too large.
        """
        if not isinstance(name, str):
            raise TypeError(f"gene() takes a gene name; got {type(name).__name__}.")
        info = dataset()
        if not info.get("has_genes"):
            raise DataError(f"{info['name']} has no gene expression.")
        _check_layer(layer, [str(item) for item in info.get("layers") or []])

        def read() -> np.ndarray:
            values = get_bridge().gene(name, layer, bool(allow_large))
            return frozen(as_column(values, np.float32, f'gene "{name}"'))

        key = ("gene", name) if layer is None else ("gene", name, layer)
        return read_only(cached(key, read))

    @property
    def gene_names(self) -> list[str]:
        """Every gene name the dataset has."""
        if not dataset().get("has_genes"):
            return []
        names = cached(("gene_names",), lambda: [str(name) for name in get_bridge().gene_names()])
        return list(names)

    @property
    def selected(self) -> int | None:
        """The row of the cell selected in the app, or None."""
        row = get_bridge().selected()
        return None if row is None else int(row)


def _find_column(name: str) -> dict[str, Any]:
    columns = dataset()["columns"]
    for field in ("label", "id"):
        for column in columns:
            if column[field] == name:
                return column
    labels = [str(column["label"]) for column in columns]
    raise NotFound(
        f'No column "{name}".' + suggest(name, labels) + " See cells.columns for the list."
    )
