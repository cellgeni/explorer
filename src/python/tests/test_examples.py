"""The plan's two example requests, run as the console runs them."""

from typing import Any

import numpy as np
from fake_bridge import FakeBridge


def run(source: str) -> dict[str, Any]:
    space: dict[str, Any] = {}
    exec("from explorer import *", space)
    exec(compile(source, "<console>", "exec"), space)
    return space


def test_cells_near_a_point_by_distance(bridge: FakeBridge) -> None:
    space = run(
        """
import numpy as np
x0, y0 = (5210.4, 3180.9)
d = np.hypot(cells.x - x0, cells.y - y0)
near = (cells.gene("CD3E") > 20) & (d <= 250)
color(near, "green", by=d, reverse=True)
"""
    )
    d = np.hypot(bridge.x - 5210.4, bridge.y - 3180.9)
    near = (bridge.genes["CD3E"] > 20) & (d <= 250)
    rows = np.flatnonzero(near)
    assert rows.size > 0
    np.testing.assert_array_equal(space["near"], near)

    (command,) = bridge.draws
    assert command["op"] == "color"
    assert command["name"] is None
    assert command["rows"].tolist() == rows.tolist()
    assert command["rows"].dtype == np.uint32
    assert command["color"] == "#008000"
    assert command["cmap"] is None
    np.testing.assert_array_equal(command["values"], d[rows].astype(np.float32))
    assert command["vmin"] == d[rows].min()
    assert command["vmax"] == d[rows].max() <= 250
    assert command["reverse"] is True


def test_picks_from_two_rois(bridge: FakeBridge) -> None:
    space = run(
        """
a = rois["ROI 1"].contains(cells) & (cells.area > 50)
b = rois["ROI 2"].contains(cells) & (cells.gene("Y") > 99)
color(a | b, "orange", name="ROI picks")
others("hide")
"""
    )
    area = bridge.numbers["cell:area"][2]
    in_one = bridge.contains("sel-1")
    in_two = bridge.contains("sel-2")
    expected = (in_one & (area > 50)) | (in_two & (bridge.genes["Y"] > 99))
    assert expected.any()
    assert (in_one & (area > 50)).any() and (in_two & (bridge.genes["Y"] > 99)).any()
    np.testing.assert_array_equal(space["a"] | space["b"], expected)

    picks, hide = bridge.draws
    assert picks["op"] == "color"
    assert picks["name"] == "ROI picks"
    assert picks["color"] == "#ffa500"
    assert picks["rows"].tolist() == np.flatnonzero(expected).tolist()
    assert picks["values"] is None
    assert hide == {"op": "others", "mode": "hide"}
