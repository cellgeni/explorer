import re

import pytest

from explorer._colors import CMAPS, CSS_COLORS, parse_cmap, parse_color


def test_all_css_named_colours() -> None:
    assert len(CSS_COLORS) == 148
    assert all(re.fullmatch(r"#[0-9a-f]{6}", value) for value in CSS_COLORS.values())
    assert CSS_COLORS["rebeccapurple"] == "#663399"
    assert CSS_COLORS["grey"] == CSS_COLORS["gray"] == "#808080"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("green", "#008000"),
        ("Green", "#008000"),
        (" LightGoldenRodYellow ", "#fafad2"),
        ("#abc", "#aabbcc"),
        ("#ABC", "#aabbcc"),
        ("#1A2b3C", "#1a2b3c"),
    ],
)
def test_parse_color(text: str, expected: str) -> None:
    assert parse_color(text) == expected


@pytest.mark.parametrize(
    "text", ["#abcd", "#12345", "#gggggg", "abc", "", "rgb(1,2,3)", "#aabbccdd"]
)
def test_bad_colours(text: str) -> None:
    with pytest.raises(ValueError, match="CSS colour name"):
        parse_color(text)


def test_close_colour_names_are_suggested() -> None:
    with pytest.raises(ValueError, match='Did you mean "orange"'):
        parse_color("ornage")


def test_colour_must_be_text() -> None:
    with pytest.raises(TypeError):
        parse_color((1, 2, 3))


def test_cmaps() -> None:
    assert CMAPS == ("viridis", "magma", "inferno", "plasma", "cividis", "turbo")
    assert parse_cmap("TURBO") == "turbo"
    with pytest.raises(ValueError):
        parse_cmap("jet")
    with pytest.raises(ValueError):
        parse_cmap(None)
