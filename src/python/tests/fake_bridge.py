"""An in-memory Bridge for the tests, with a small made-up Xenium-like dataset."""

import json
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np

from explorer import DataError, ReadRefused, ReadTooLarge

FIXTURES = Path(__file__).parent / "fixtures"


def load_contains_fixture() -> dict[str, Any]:
    """The lasso, box and points shared with the app's roiSelectionContains test."""
    return json.loads((FIXTURES / "contains.json").read_text())


def box_corners(min_x: float, min_y: float, max_x: float, max_y: float) -> np.ndarray:
    return np.array([[min_x, min_y], [max_x, min_y], [max_x, max_y], [min_x, max_y]], dtype=float)


def polygon_contains(polygon: np.ndarray, x: np.ndarray, y: np.ndarray, box: bool) -> np.ndarray:
    """As the app's roiSelectionContains: an inclusive bounding-box test, then
    (for a lasso) the even-odd rule."""
    min_x, min_y = polygon.min(axis=0)
    max_x, max_y = polygon.max(axis=0)
    in_box = (x >= min_x) & (x <= max_x) & (y >= min_y) & (y <= max_y)
    if box:
        return in_box
    inside = np.zeros(len(x), dtype=bool)
    previous = len(polygon) - 1
    for index in range(len(polygon)):
        cx, cy = polygon[index]
        bx, by = polygon[previous]
        previous = index
        with np.errstate(divide="ignore", invalid="ignore"):
            crosses = ((cy > y) != (by > y)) & (x < (bx - cx) * (y - cy) / (by - cy) + cx)
        inside ^= crosses
    return in_box & inside


class FakeBridge:
    """A Bridge over arrays held in memory. It records calls and draw commands."""

    def __init__(
        self,
        *,
        x: np.ndarray,
        y: np.ndarray,
        name: str = "Fake Xenium",
        noun: str = "cells",
        numbers: dict[str, tuple[str, str, np.ndarray]] | None = None,
        categories: dict[str, tuple[str, str, dict[str, Any]]] | None = None,
        genes: dict[str, np.ndarray] | None = None,
        layers: list[str] | None = None,
        rois: list[dict[str, Any]] | None = None,
    ) -> None:
        self.x = np.asarray(x, dtype=float)
        self.y = np.asarray(y, dtype=float)
        self.name = name
        self.noun = noun
        self.numbers = numbers or {}
        self.categories = categories or {}
        self.genes = genes or {}
        self.layers = layers or []
        self.roi_list = rois or []
        self.selected_row: int | None = None
        self.center = (float(np.mean(self.x)), float(np.mean(self.y)))
        self.bounds = (
            float(self.x.min()),
            float(self.y.min()),
            float(self.x.max()),
            float(self.y.max()),
        )
        # Genes whose reads are too large without allow_large, and refused ones: bytes.
        self.large_genes: dict[str, int] = {}
        self.refused_genes: dict[str, int] = {}
        self.calls: Counter[str] = Counter()
        self.gene_requests: list[tuple[str, str | None, bool]] = []
        self.draws: list[dict[str, Any]] = []

    @property
    def count(self) -> int:
        return len(self.x)

    def dataset(self) -> dict[str, Any]:
        self.calls["dataset"] += 1
        columns = [
            {"id": column_id, "label": label, "kind": "number", "group": group}
            for column_id, (label, group, _) in self.numbers.items()
        ] + [
            {"id": column_id, "label": label, "kind": "category", "group": group}
            for column_id, (label, group, _) in self.categories.items()
        ]
        return {
            "name": self.name,
            "count": self.count,
            "noun": self.noun,
            "columns": columns,
            "has_genes": bool(self.genes),
            "layers": list(self.layers),
        }

    def positions(self) -> tuple[np.ndarray, np.ndarray]:
        self.calls["positions"] += 1
        return self.x.copy(), self.y.copy()

    def cell_ids(self) -> list[str]:
        self.calls["cell_ids"] += 1
        return [f"cell-{row:05d}" for row in range(self.count)]

    def number_column(self, column_id: str) -> np.ndarray:
        self.calls[f"number:{column_id}"] += 1
        if column_id not in self.numbers:
            raise DataError(f'No number column "{column_id}".')
        return self.numbers[column_id][2].astype(np.float64)

    def category_column(self, column_id: str) -> dict[str, Any]:
        self.calls[f"category:{column_id}"] += 1
        if column_id not in self.categories:
            raise DataError(f'No category column "{column_id}".')
        data = self.categories[column_id][2]
        return {
            "codes": np.asarray(data["codes"], dtype=np.int32).copy(),
            "labels": list(data["labels"]),
            "extra_rows": np.asarray(data.get("extra_rows", []), dtype=np.int32),
            "extra_codes": np.asarray(data.get("extra_codes", []), dtype=np.int32),
        }

    def gene_names(self) -> list[str]:
        self.calls["gene_names"] += 1
        return list(self.genes)

    def gene(self, name: str, layer: str | None, allow_large: bool) -> np.ndarray:
        self.calls[f"gene:{name}:{layer}"] += 1
        self.gene_requests.append((name, layer, allow_large))
        if name in self.refused_genes:
            raise ReadRefused(f"Reading {name} needs too much memory.", self.refused_genes[name])
        if name in self.large_genes and not allow_large:
            raise ReadTooLarge(f"Reading {name} downloads a lot.", self.large_genes[name])
        if name not in self.genes:
            raise DataError(f'This dataset has no gene "{name}".')
        values = self.genes[name].astype(np.float32)
        # Each layer scales the values, so tests can tell layers apart.
        return values * (1 + self.layers.index(layer)) if layer is not None else values

    def selected(self) -> int | None:
        self.calls["selected"] += 1
        return self.selected_row

    def rois(self) -> list[dict[str, Any]]:
        self.calls["rois"] += 1
        return [
            {**roi, "polygons": [np.array(polygon, dtype=float) for polygon in roi["polygons"]]}
            for roi in self.roi_list
        ]

    def contains(self, key: str) -> np.ndarray:
        self.calls[f"contains:{key}"] += 1
        for roi in self.roi_list:
            if roi["key"] == key:
                mask = np.zeros(self.count, dtype=bool)
                for polygon in roi["polygons"]:
                    mask |= polygon_contains(
                        np.asarray(polygon, dtype=float), self.x, self.y, roi.get("box", False)
                    )
                return mask
        raise DataError(f'No ROI with key "{key}".')

    def view(self) -> dict[str, Any]:
        self.calls["view"] += 1
        return {"center": self.center, "bounds": self.bounds}

    def draw(self, command: dict[str, Any]) -> None:
        self.calls["draw"] += 1
        self.draws.append(command)


def demo_bridge(count: int = 5000, seed: int = 1) -> FakeBridge:
    """A Xenium-like dataset: positions, cell columns, classes, genes, layers and ROIs."""
    rng = np.random.default_rng(seed)
    x = rng.uniform(4500.0, 6000.0, count)
    y = rng.uniform(2500.0, 4000.0, count)

    area = rng.uniform(10.0, 120.0, count)
    transcripts = rng.integers(0, 500, count).astype(float)
    score = rng.normal(0.0, 1.0, count)
    score[::7] = np.nan

    types = ["T cell", "B cell", "Tumour", "Stroma"]
    type_codes = rng.integers(-1, len(types), count).astype(np.int32)
    # Some cells are in a second class too; row 10's repeats its first class.
    extra_rows = np.array([0, 1, 2, 3, 10], dtype=np.int32)
    extra_codes = np.array([2, 2, 0, 3, 1], dtype=np.int32)
    type_codes[extra_rows] = 1  # B cell first, so the extra class differs.
    favourites = np.full(count, -1, dtype=np.int32)
    favourites[:25] = 0

    genes = {
        name: rng.poisson(lam, count).astype(np.float32)
        for name, lam in (("CD3E", 15.0), ("Y", 90.0), ("SNAP25", 2.0), ("MS4A1", 5.0))
    }
    genes["BIG"] = np.zeros(count, dtype=np.float32)
    genes["HUGE"] = np.zeros(count, dtype=np.float32)

    lasso = np.array(
        [[5000, 3000], [5400, 2950], [5500, 3300], [5200, 3500], [4950, 3350]], dtype=float
    )
    rois = [
        {"key": "sel-1", "name": "ROI 1", "kind": "selection", "polygons": [lasso], "box": False},
        {
            "key": "sel-2",
            "name": "ROI 2",
            "kind": "selection",
            "polygons": [box_corners(5600, 3600, 5900, 3900)],
            "box": True,
        },
        {
            "key": "sel-3",
            "name": "ROI 1",
            "kind": "selection",
            "polygons": [box_corners(4600, 2600, 4700, 2700)],
            "box": True,
        },
        {
            "key": "feature-1",
            "name": "Tumour",
            "kind": "feature",
            "polygons": [
                np.array([[4600, 3600], [4800, 3600], [4700, 3800], [4600, 3600]], dtype=float),
                np.array([[5800, 2600], [5950, 2600], [5900, 2800]], dtype=float),
            ],
            "box": False,
        },
        {
            "key": "current",
            "name": "Current selection",
            "kind": "current",
            "polygons": [box_corners(5100, 3100, 5300, 3300)],
            "box": True,
        },
    ]

    bridge = FakeBridge(
        x=x,
        y=y,
        name="Xenium demo",
        numbers={
            "cell:cellArea": ("Cell area", "Cell", area),
            "cell:transcriptCount": ("Transcripts", "Cell", transcripts),
            "track:score": ("Score", "Metadata", score),
        },
        categories={
            "class:type": (
                "Cell type",
                "Classes",
                {
                    "codes": type_codes,
                    "labels": types,
                    "extra_rows": extra_rows,
                    "extra_codes": extra_codes,
                },
            ),
            "set:favourites": (
                "Favourites",
                "Classes",
                {"codes": favourites, "labels": ["Favourites"]},
            ),
            "obs:leiden": (
                "leiden",
                "Metadata",
                {"codes": (np.arange(count) % 3).astype(np.int32), "labels": ["0", "1", "2"]},
            ),
        },
        genes=genes,
        layers=["counts", "raw"],
        rois=rois,
    )
    bridge.large_genes["BIG"] = 3_000_000_000
    bridge.refused_genes["HUGE"] = 90_000_000_000
    return bridge
