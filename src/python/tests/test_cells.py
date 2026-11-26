import numpy as np
import pytest
from fake_bridge import FakeBridge

import explorer
from explorer import DataError, ExplorerError, ReadRefused, ReadTooLarge, cells


def test_no_bridge_is_an_explorer_error() -> None:
    with pytest.raises(ExplorerError, match="No dataset is open"):
        len(cells)


def test_len_and_repr(bridge: FakeBridge) -> None:
    assert len(cells) == 5000
    assert repr(cells) == "<cells: 5,000 cells — Xenium demo>"
    bridge.noun = "spots"
    assert repr(cells) == "<cells: 5,000 spots — Xenium demo>"


def test_positions_and_ids(bridge: FakeBridge) -> None:
    assert cells.x.dtype == np.float64
    assert cells.y.dtype == np.float64
    np.testing.assert_array_equal(cells.x, bridge.x)
    np.testing.assert_array_equal(cells.y, bridge.y)
    assert cells.id.dtype.kind == "U"
    assert cells.id[0] == "cell-00000"
    assert len(cells.id) == 5000


def test_cell_columns(bridge: FakeBridge) -> None:
    np.testing.assert_array_equal(cells.area, bridge.numbers["cell:cellArea"][2])
    np.testing.assert_array_equal(cells.transcripts, bridge.numbers["cell:transcriptCount"][2])
    assert cells.area.dtype == np.float64


def test_missing_cell_column_is_all_nan(bridge: FakeBridge) -> None:
    nuclei = cells.nuclei
    assert nuclei.dtype == np.float64
    assert nuclei.shape == (5000,)
    assert np.isnan(nuclei).all()
    assert bridge.calls["number:cell:nucleusCount"] == 0


def test_number_column_by_label_and_id(bridge: FakeBridge) -> None:
    score = cells["Score"]
    assert score.dtype == np.float64
    np.testing.assert_array_equal(score, bridge.numbers["track:score"][2])
    np.testing.assert_array_equal(cells["track:score"], score)


def test_label_wins_over_id(bridge: FakeBridge) -> None:
    # A column labelled like another column's ID is found by its label.
    bridge.numbers["other"] = ("track:score", "Metadata", np.zeros(5000))
    assert (cells["track:score"] == 0).all()


def test_unknown_column_suggests_close_labels(bridge: FakeBridge) -> None:
    with pytest.raises(KeyError) as caught:
        cells["Cell typ"]
    message = str(caught.value)
    assert '"Cell type"' in message
    assert "cells.columns" in message


def test_non_string_column_is_a_type_error(bridge: FakeBridge) -> None:
    with pytest.raises(TypeError, match="cells.x\\[mask\\]"):
        cells[0]  # type: ignore[index]


def test_columns_print_grouped(bridge: FakeBridge) -> None:
    columns = cells.columns
    assert ("Cell area", "number", "Cell") in columns
    assert ("Cell type", "category", "Classes") in columns
    assert columns[0].label == "Cell area"
    text = repr(columns)
    assert text.splitlines()[0] == "Cell:"
    assert "Classes:" in text and "Metadata:" in text
    assert "Cell type" in text and "category" in text


def test_arrays_are_cached(bridge: FakeBridge) -> None:
    for _ in range(3):
        cells.x, cells.y, cells.id, cells.area, cells["Score"], cells["Cell type"]
        cells.gene("CD3E")
        assert cells.gene_names
    assert bridge.calls["positions"] == 1
    assert bridge.calls["cell_ids"] == 1
    assert bridge.calls["number:cell:cellArea"] == 1
    assert bridge.calls["number:track:score"] == 1
    assert bridge.calls["category:class:type"] == 1
    assert bridge.calls["gene:CD3E:None"] == 1
    assert bridge.calls["gene_names"] == 1


@pytest.mark.parametrize(
    "read",
    [
        lambda: cells.x,
        lambda: cells.y,
        lambda: cells.id,
        lambda: cells.area,
        lambda: cells.nuclei,
        lambda: cells["Score"],
        lambda: cells["Cell type"].codes,
        lambda: cells.gene("CD3E"),
    ],
)
def test_arrays_are_read_only(bridge: FakeBridge, read) -> None:
    array = read()
    assert not array.flags.writeable
    with pytest.raises(ValueError):
        array[0] = array[1]
    with pytest.raises(ValueError):
        array.flags.writeable = True
    writable = array.copy()
    writable[0] = writable[1]
    np.testing.assert_array_equal(read(), array)


def test_invalidate_drops_the_cache(bridge: FakeBridge) -> None:
    first = cells.x
    bridge.x = bridge.x + 1
    assert cells.x[0] == first[0]
    explorer.invalidate()
    assert cells.x[0] == first[0] + 1
    assert bridge.calls["positions"] == 2


def test_connect_drops_the_cache(bridge: FakeBridge) -> None:
    cells.gene("CD3E")
    explorer.connect(bridge)
    cells.gene("CD3E")
    assert bridge.calls["gene:CD3E:None"] == 2


def test_wrong_length_from_the_bridge_is_a_data_error(bridge: FakeBridge) -> None:
    bridge.numbers["track:score"] = ("Score", "Metadata", np.zeros(10))
    with pytest.raises(DataError, match="10 values for 5,000 cells"):
        cells["Score"]


def test_gene(bridge: FakeBridge) -> None:
    values = cells.gene("CD3E")
    assert values.dtype == np.float32
    np.testing.assert_array_equal(values, bridge.genes["CD3E"])
    assert bridge.gene_requests == [("CD3E", None, False)]


def test_gene_layers_are_cached_separately(bridge: FakeBridge) -> None:
    plain = cells.gene("CD3E")
    raw = cells.gene("CD3E", layer="raw")
    np.testing.assert_array_equal(raw, plain * 2)
    cells.gene("CD3E", layer="raw")
    assert bridge.gene_requests == [("CD3E", None, False), ("CD3E", "raw", False)]


def test_unknown_layer_lists_the_layers(bridge: FakeBridge) -> None:
    with pytest.raises(ValueError, match="Its layers: counts, raw"):
        cells.gene("CD3E", layer="spliced")
    assert bridge.gene_requests == []


def test_layer_on_a_dataset_without_layers(bridge: FakeBridge) -> None:
    bridge.layers = []
    with pytest.raises(ValueError, match="no layers"):
        cells.gene("CD3E", layer="raw")
    assert bridge.gene_requests == []


def test_dataset_without_genes(bridge: FakeBridge) -> None:
    bridge.genes = {}
    with pytest.raises(DataError, match="no gene expression"):
        cells.gene("CD3E")
    assert cells.gene_names == []


def test_unknown_gene_is_the_bridges_data_error(bridge: FakeBridge) -> None:
    with pytest.raises(DataError, match='no gene "NOPE"'):
        cells.gene("NOPE")


def test_large_read_needs_allow_large(bridge: FakeBridge) -> None:
    with pytest.raises(ReadTooLarge) as caught:
        cells.gene("BIG")
    assert caught.value.bytes == 3_000_000_000
    assert isinstance(caught.value, ExplorerError)
    # The failure is not cached: allowing it reads.
    assert cells.gene("BIG", allow_large=True).shape == (5000,)
    assert bridge.gene_requests[-1] == ("BIG", None, True)


def test_refused_read(bridge: FakeBridge) -> None:
    with pytest.raises(ReadRefused) as caught:
        cells.gene("HUGE", allow_large=True)
    assert caught.value.bytes == 90_000_000_000
    assert str(caught.value) == "Reading HUGE needs too much memory."


def test_gene_name_must_be_text(bridge: FakeBridge) -> None:
    with pytest.raises(TypeError):
        cells.gene(3)  # type: ignore[arg-type]


def test_gene_names_are_cached_copies(bridge: FakeBridge) -> None:
    names = cells.gene_names
    assert names[:2] == ["CD3E", "Y"]
    names.clear()
    assert cells.gene_names[:2] == ["CD3E", "Y"]
    assert bridge.calls["gene_names"] == 1


def test_selected_is_never_cached(bridge: FakeBridge) -> None:
    assert cells.selected is None
    bridge.selected_row = 42
    assert cells.selected == 42
    assert bridge.calls["selected"] == 2


def test_view(bridge: FakeBridge) -> None:
    from explorer import view

    bridge.center = (5250.0, 3250.0)
    bridge.bounds = (4500.0, 2500.0, 6000.0, 4000.0)
    assert view.center == (5250.0, 3250.0)
    assert view.bounds == (4500.0, 2500.0, 6000.0, 4000.0)
    bridge.center = (1.0, 2.0)
    assert view.center == (1.0, 2.0)
    assert repr(view).startswith("<view: center (1.0, 2.0) µm")


def test_error_classes() -> None:
    error = ReadTooLarge("big", 12)
    assert (str(error), error.bytes) == ("big", 12)
    assert ReadRefused("no", 5).bytes == 5
    for kind in (ReadTooLarge, ReadRefused, DataError):
        assert issubclass(kind, ExplorerError)
    assert issubclass(ExplorerError, Exception)
