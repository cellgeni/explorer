import numpy as np
import pytest
from fake_bridge import FakeBridge

from explorer import cells, clear, color, highlight, others, show
from explorer._draw import rows_of

# Masks


def test_bool_mask_becomes_rows(bridge: FakeBridge) -> None:
    mask = np.zeros(5000, dtype=bool)
    mask[[7, 3, 4999]] = True
    rows = rows_of(mask)
    assert rows.dtype == np.uint32
    assert rows.tolist() == [3, 7, 4999]


def test_row_numbers_are_sorted_and_unique(bridge: FakeBridge) -> None:
    assert rows_of([9, 2, 9, 0]).tolist() == [0, 2, 9]
    assert rows_of(np.array([4, 1], dtype=np.int64)).tolist() == [1, 4]
    assert rows_of(np.array([4], dtype=np.uint64)).tolist() == [4]
    assert rows_of(12).tolist() == [12]
    assert rows_of([]).tolist() == []
    assert rows_of(np.flatnonzero(cells.area > 100)).dtype == np.uint32


def test_bool_list_is_a_mask(bridge: FakeBridge) -> None:
    assert rows_of([True] + [False] * 4999).tolist() == [0]


def test_mask_of_another_length(bridge: FakeBridge) -> None:
    with pytest.raises(ValueError) as caught:
        rows_of(np.ones(1200, dtype=bool))
    assert str(caught.value) == (
        "This mask has 1,200 entries but the dataset has 5,000 cells — "
        "was it made for another dataset?"
    )


def test_rows_out_of_range(bridge: FakeBridge) -> None:
    with pytest.raises(ValueError, match="Row 5,000 is out of range.*rows 0 to 4,999"):
        rows_of([1, 5000])
    with pytest.raises(ValueError, match="Row -1 is out of range"):
        rows_of([-1, 3])


@pytest.mark.parametrize(
    "mask",
    [None, True, np.array([0.5, 1.0]), ["a"], np.zeros((2, 2), dtype=int)],
)
def test_bad_masks(bridge: FakeBridge, mask) -> None:
    with pytest.raises((TypeError, ValueError)):
        rows_of(mask)


def test_two_dimensional_bool_mask(bridge: FakeBridge) -> None:
    with pytest.raises(ValueError, match="one-dimensional"):
        rows_of(np.ones((2, 2500), dtype=bool))


def test_classes_is_not_a_mask(bridge: FakeBridge) -> None:
    with pytest.raises(TypeError, match='cells\\["Cell type"\\] == "T cell"'):
        rows_of(cells["Cell type"])


# color


def test_solid_color(bridge: FakeBridge) -> None:
    assert color([3, 1], "Orange") is None
    (command,) = bridge.draws
    assert command["rows"].tolist() == [1, 3]
    assert command["rows"].dtype == np.uint32
    assert {key: value for key, value in command.items() if key != "rows"} == {
        "op": "color",
        "name": "Result",
        "color": "#ffa500",
        "cmap": None,
        "values": None,
        "vmin": None,
        "vmax": None,
        "reverse": False,
    }


def test_single_hue_ramp(bridge: FakeBridge) -> None:
    by = np.arange(5000, dtype=np.int64)
    color([10, 20, 30], "#0f0", by=by, name="Ramp")
    (command,) = bridge.draws
    assert command["name"] == "Ramp"
    assert command["color"] == "#00ff00"
    assert command["cmap"] is None
    assert command["values"].dtype == np.float32
    assert command["values"].tolist() == [10.0, 20.0, 30.0]
    assert (command["vmin"], command["vmax"]) == (10.0, 30.0)
    assert isinstance(command["vmin"], float)
    assert command["reverse"] is False


def test_colour_map(bridge: FakeBridge) -> None:
    mask = cells.area > 60
    color(mask, by=cells.area, cmap="Viridis", vmin=0, vmax=200, reverse=True)
    (command,) = bridge.draws
    assert command["color"] is None
    assert command["cmap"] == "viridis"
    assert (command["vmin"], command["vmax"], command["reverse"]) == (0.0, 200.0, True)
    np.testing.assert_array_equal(command["values"], cells.area[mask].astype(np.float32))


def test_range_ignores_nan_and_defaults_each_end(bridge: FakeBridge) -> None:
    by = np.full(5000, np.nan)
    by[[1, 2, 3]] = [5.0, np.nan, -2.0]
    color([1, 2, 3], "red", by=by, vmax=9)
    command = bridge.draws[-1]
    assert (command["vmin"], command["vmax"]) == (-2.0, 9.0)
    assert np.isnan(command["values"][1])


def test_all_nan_range_is_zero_to_one(bridge: FakeBridge) -> None:
    color([1, 2], cmap="magma", by=np.full(5000, np.nan))
    assert (bridge.draws[-1]["vmin"], bridge.draws[-1]["vmax"]) == (0.0, 1.0)


def test_empty_mask_draws(bridge: FakeBridge) -> None:
    color(np.zeros(5000, dtype=bool), "red", by=cells.area)
    command = bridge.draws[-1]
    assert command["rows"].tolist() == []
    assert command["values"].tolist() == []
    assert (command["vmin"], command["vmax"]) == (0.0, 1.0)


@pytest.mark.parametrize(
    ("kwargs", "error", "match"),
    [
        ({}, ValueError, "Give a color"),
        ({"color": "red", "cmap": "viridis", "by": np.zeros(5000)}, ValueError, "not both"),
        ({"cmap": "viridis"}, ValueError, "cmap needs by="),
        ({"cmap": "jet", "by": np.zeros(5000)}, ValueError, "viridis, magma, inferno"),
        ({"color": "red", "vmin": 1}, ValueError, "need by="),
        ({"color": "red", "reverse": True}, ValueError, "need by="),
        ({"color": "red", "by": np.zeros(10)}, ValueError, "by= has 10 values"),
        ({"color": "red", "by": np.array(["a"] * 5000)}, TypeError, "one number per cell"),
        ({"color": "red", "by": np.zeros(5000), "vmin": 3, "vmax": 1}, ValueError, "reverse=True"),
        ({"color": "red", "by": np.zeros(5000), "vmin": np.inf}, ValueError, "finite"),
        ({"color": "red", "by": np.zeros(5000), "vmin": "1"}, TypeError, "vmin is a number"),
        ({"color": "red", "name": ""}, ValueError, "blank"),
        ({"color": "red", "name": 3}, TypeError, "name is text"),
        ({"color": "reed"}, ValueError, 'Did you mean "red"'),
    ],
)
def test_color_validation(bridge: FakeBridge, kwargs, error, match) -> None:
    with pytest.raises(error, match=match):
        color([1], **kwargs)
    assert bridge.draws == []


def test_by_a_category_is_a_type_error(bridge: FakeBridge) -> None:
    with pytest.raises(TypeError, match="not a category"):
        color([1], "red", by=cells["Cell type"])


# The other calls


def test_highlight(bridge: FakeBridge) -> None:
    assert highlight([5, 2]) is None
    assert highlight([1], "#ABC", name="Picked") is None
    first, second = bridge.draws
    assert first["op"] == "highlight"
    assert first["rows"].tolist() == [2, 5]
    assert (first["name"], first["color"]) == ("Result", "#ffffff")
    assert (second["name"], second["color"]) == ("Picked", "#aabbcc")
    assert set(first) == {"op", "name", "rows", "color"}


def test_highlight_bad_colour(bridge: FakeBridge) -> None:
    with pytest.raises(TypeError):
        highlight([1], None)  # type: ignore[arg-type]
    assert bridge.draws == []


def test_show(bridge: FakeBridge) -> None:
    assert show(cells.area > 100) is None
    assert show(None) is None
    shown, everything = bridge.draws
    assert shown["op"] == "show"
    assert shown["rows"].tolist() == np.flatnonzero(cells.area > 100).tolist()
    assert everything == {"op": "show", "rows": None}


def test_others(bridge: FakeBridge) -> None:
    others("fade")
    others("hide")
    assert bridge.draws == [{"op": "others", "mode": "fade"}, {"op": "others", "mode": "hide"}]
    with pytest.raises(ValueError, match='"fade" or "hide"'):
        others("dim")


def test_clear(bridge: FakeBridge) -> None:
    assert clear() is None
    clear("ROI picks")
    assert bridge.draws == [{"op": "clear", "name": None}, {"op": "clear", "name": "ROI picks"}]
    with pytest.raises(TypeError):
        clear(1)  # type: ignore[arg-type]


def test_each_call_draws_once(bridge: FakeBridge) -> None:
    color([1], "red")
    highlight([1])
    show([1])
    others("fade")
    clear()
    assert bridge.calls["draw"] == 5
