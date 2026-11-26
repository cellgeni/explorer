import numpy as np
import pytest
from fake_bridge import FakeBridge

from explorer import Classes, cells


def expected_mask(bridge: FakeBridge, column_id: str, label: str) -> np.ndarray:
    data = bridge.categories[column_id][2]
    index = list(data["labels"]).index(label)
    mask = np.asarray(data["codes"]) == index
    extra_rows = np.asarray(data.get("extra_rows", []), dtype=int)
    extra_codes = np.asarray(data.get("extra_codes", []), dtype=int)
    mask[extra_rows[extra_codes == index]] = True
    return mask


def test_category_column_is_classes(bridge: FakeBridge) -> None:
    types = cells["Cell type"]
    assert isinstance(types, Classes)
    assert types.codes.dtype == np.int32
    assert types.labels == ["T cell", "B cell", "Tumour", "Stroma"]
    assert len(types) == 5000
    assert cells["class:type"] is types


def test_equals_counts_cells_in_several_classes(bridge: FakeBridge) -> None:
    types = cells["Cell type"]
    tumour = types == "Tumour"
    assert tumour.dtype == np.bool_
    # Rows 0 and 1 are B cells first, Tumour as well.
    assert tumour[0] and tumour[1]
    assert (types == "B cell")[0]
    np.testing.assert_array_equal(tumour, expected_mask(bridge, "class:type", "Tumour"))
    assert np.count_nonzero(tumour) > np.count_nonzero(types.codes == 2)


def test_not_equals_is_the_complement(bridge: FakeBridge) -> None:
    types = cells["Cell type"]
    np.testing.assert_array_equal(types != "Tumour", ~(types == "Tumour"))


def test_isin(bridge: FakeBridge) -> None:
    types = cells["Cell type"]
    either = types.isin(["T cell", "Stroma"])
    np.testing.assert_array_equal(either, (types == "T cell") | (types == "Stroma"))
    np.testing.assert_array_equal(types.isin("Stroma"), types == "Stroma")
    assert not types.isin([]).any()


def test_unknown_class_suggests(bridge: FakeBridge) -> None:
    types = cells["Cell type"]
    with pytest.raises(KeyError, match='Did you mean "Tumour"'):
        types == "Tumor"  # noqa: B015
    with pytest.raises(KeyError):
        types.isin(["T cell", "nope"])


def test_number_labels_match_by_text(bridge: FakeBridge) -> None:
    leiden = cells["leiden"]
    np.testing.assert_array_equal(leiden == 1, leiden == "1")
    assert (leiden == 1).sum() == np.count_nonzero(np.arange(5000) % 3 == 1)


def test_comparing_with_other_types_is_not_a_mask(bridge: FakeBridge) -> None:
    types = cells["Cell type"]
    assert (types == [1, 2]) is False
    with pytest.raises(TypeError):
        types.isin([1.5])


def test_counts(bridge: FakeBridge) -> None:
    counts = cells["Cell type"].counts()
    assert list(counts) == ["T cell", "B cell", "Tumour", "Stroma"]
    for label, total in counts.items():
        assert total == np.count_nonzero(expected_mask(bridge, "class:type", label))


def test_repr_lists_classes_and_counts(bridge: FakeBridge) -> None:
    text = repr(cells["Cell type"])
    first, *rest = text.splitlines()
    assert first == '<classes "Cell type": 4 classes, 5,000 cells>'
    assert rest[0].split()[:2] == ["T", "cell"]
    assert any(line.strip().startswith("(none)") for line in rest)
    assert f"{cells['Cell type'].counts()['Tumour']:,}" in text


def test_repr_shortens_many_classes(bridge: FakeBridge) -> None:
    labels = [f"class {index}" for index in range(30)]
    bridge.categories["obs:many"] = (
        "Many",
        "Metadata",
        {"codes": (np.arange(5000) % 30).astype(np.int32), "labels": labels},
    )
    lines = repr(cells["Many"]).splitlines()
    assert len(lines) == 22
    assert lines[-1].strip() == "… 10 more; see .counts()"


def test_set_column(bridge: FakeBridge) -> None:
    favourites = cells["Favourites"] == "Favourites"
    assert np.flatnonzero(favourites).tolist() == list(range(25))
