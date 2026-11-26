import numpy as np
import pytest
from fake_bridge import FakeBridge, box_corners, load_contains_fixture, polygon_contains

import explorer
from explorer import cells, rois


def test_names_in_bridge_order_with_repeats_numbered(bridge: FakeBridge) -> None:
    assert list(rois) == ["ROI 1", "ROI 2", "ROI 1 (2)", "Tumour", "Current selection"]
    assert len(rois) == 5
    assert "ROI 1 (2)" in rois
    assert "ROI 3" not in rois
    assert rois["ROI 1 (2)"].key == "sel-3"


def test_a_name_that_looks_numbered_does_not_clash(bridge: FakeBridge) -> None:
    bridge.roi_list.append({**bridge.roi_list[0], "key": "sel-9", "name": "ROI 1 (2)"})
    names = list(rois)
    assert names.count("ROI 1 (2)") == 1
    assert "ROI 1 (2) (2)" in names
    assert rois["ROI 1 (2) (2)"].key == "sel-9"


def test_roi_attributes(bridge: FakeBridge) -> None:
    roi = rois["ROI 1"]
    assert (roi.name, roi.kind, roi.key, roi.box) == ("ROI 1", "selection", "sel-1", False)
    assert roi.polygon.shape == (5, 2)
    assert roi.polygon.dtype == np.float64
    assert rois["ROI 2"].box


def test_feature_with_several_polygons(bridge: FakeBridge) -> None:
    tumour = rois["Tumour"]
    assert tumour.kind == "feature"
    assert isinstance(tumour.polygon, list)
    assert [polygon.shape for polygon in tumour.polygon] == [(4, 2), (3, 2)]


def test_reprs(bridge: FakeBridge) -> None:
    assert repr(rois["ROI 1"]) == '<ROI "ROI 1": lasso, 5 vertices>'
    assert repr(rois["ROI 2"]) == '<ROI "ROI 2": box, 300.0 × 300.0 µm>'
    # The closing vertex that repeats the first is not counted.
    assert repr(rois["Tumour"]) == '<ROI "Tumour": feature, 2 polygons, 6 vertices>'
    assert repr(rois["Current selection"]) == (
        '<ROI "Current selection": current box, 200.0 × 200.0 µm>'
    )
    assert repr(rois) == ('<rois: "ROI 1", "ROI 2", "ROI 1 (2)", "Tumour", "Current selection">')


def test_current(bridge: FakeBridge) -> None:
    assert rois.current is not None
    assert rois.current.key == "current"
    bridge.roi_list = [roi for roi in bridge.roi_list if roi["kind"] != "current"]
    assert rois.current is None


def test_rois_are_read_fresh(bridge: FakeBridge) -> None:
    assert len(rois) == 5
    bridge.roi_list = bridge.roi_list[:1]
    assert list(rois) == ["ROI 1"]
    bridge.roi_list = []
    assert repr(rois) == "<rois: none yet>"
    with pytest.raises(KeyError, match="no ROIs yet"):
        rois["ROI 1"]


def test_unknown_name_suggests(bridge: FakeBridge) -> None:
    with pytest.raises(KeyError, match='Did you mean "Tumour"'):
        rois["Tumor"]


def test_polygon_is_a_copy(bridge: FakeBridge) -> None:
    polygon = rois["ROI 1"].polygon
    polygon[0] = 0
    assert rois["ROI 1"].polygon[0, 0] == 5000


def test_contains(bridge: FakeBridge) -> None:
    mask = rois["ROI 1"].contains(cells)
    assert mask.dtype == np.bool_ and mask.shape == (5000,)
    lasso = np.asarray(bridge.roi_list[0]["polygons"][0])
    np.testing.assert_array_equal(mask, polygon_contains(lasso, bridge.x, bridge.y, False))
    assert 0 < mask.sum() < 5000
    box = rois["ROI 2"].contains(cells)
    expected = (bridge.x >= 5600) & (bridge.x <= 5900) & (bridge.y >= 3600) & (bridge.y <= 3900)
    np.testing.assert_array_equal(box, expected)


def test_contains_is_not_cached(bridge: FakeBridge) -> None:
    rois["ROI 2"].contains(cells)
    bridge.roi_list[1]["polygons"] = [box_corners(0, 0, 1, 1)]
    assert not rois["ROI 2"].contains(cells).any()
    assert bridge.calls["contains:sel-2"] == 2


def test_contains_needs_cells(bridge: FakeBridge) -> None:
    with pytest.raises(TypeError, match="contains\\(cells\\)"):
        rois["ROI 1"].contains(cells.x)  # type: ignore[arg-type]


def test_contains_fixture() -> None:
    """The fake's geometry gives the answers the app's roiSelectionContains does."""
    fixture = load_contains_fixture()
    points = fixture["points"]
    box = fixture["box"]
    fake = FakeBridge(
        x=np.array([point["x"] for point in points]),
        y=np.array([point["y"] for point in points]),
        rois=[
            {
                "key": "lasso",
                "name": "Star",
                "kind": "selection",
                "polygons": [np.array(fixture["lasso"])],
                "box": False,
            },
            {
                "key": "box",
                "name": "Box",
                "kind": "selection",
                "polygons": [box_corners(box["minX"], box["minY"], box["maxX"], box["maxY"])],
                "box": True,
            },
        ],
    )
    explorer.connect(fake)
    try:
        star = rois["Star"].contains(cells)
        inside_box = rois["Box"].contains(cells)
    finally:
        explorer._bridge._State.bridge = None
    for index, point in enumerate(points):
        assert star[index] == point["lasso"], point["note"]
        assert inside_box[index] == point["box"], point["note"]
