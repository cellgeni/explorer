from typing import Any

import numpy as np
import pytest
from fake_bridge import FakeBridge

import explorer
from explorer.console import complete, display, format_exception, is_complete, token_start


def namespace() -> dict[str, Any]:
    space: dict[str, Any] = {"np": np}
    exec("from explorer import *", space)
    return space


def run(source: str, space: dict[str, Any] | None = None) -> BaseException:
    """Run source as the console would, returning what it raised."""
    try:
        exec(compile(source, "<console>", "exec"), namespace() if space is None else space)
    except BaseException as error:  # noqa: BLE001
        return error
    raise AssertionError("expected an error")


# is_complete


@pytest.mark.parametrize(
    "source",
    [
        "",
        "   ",
        "1 + 1",
        "x = 1,",
        ")",
        "print(1))",
        "def f():\n    return 1\n",
        "def f():\n    return 1\n\n",
        "x = 1\ny = 2",
        "if x:\n    pass\nelse:\n    pass\n",
        "1 +  # comment\n)",
    ],
)
def test_complete_inputs(source: str) -> None:
    assert is_complete(source)


@pytest.mark.parametrize(
    "source",
    [
        "for x in y:",
        "1 +",
        "1 + \\",
        "x =",
        "a and",
        "cells.",
        "print(1",
        "x = [1,\n2,",
        '"""text',
        "def f():\n    return 1",
        "if x:\n    pass\nelse:",
        "x = 1\nfor i in y:",
        "mask = (cells.area > 50) &",
    ],
)
def test_incomplete_inputs(source: str) -> None:
    assert not is_complete(source)


# display


def test_display_none() -> None:
    assert display(None, 10) is None


def test_display_mask() -> None:
    mask = np.zeros(1_414_155, dtype=bool)
    mask[:81_394] = True
    assert display(mask, 1_414_155) == "mask: 81,394 of 1,414,155 cells"


def test_display_bool_array_of_another_length() -> None:
    assert display(np.array([True, False]), 10) == "array([ True, False])"


def test_display_arrays_are_summarised() -> None:
    assert display(np.arange(3.0), 10) == "array([0., 1., 2.])"
    text = display(np.arange(5000), 5000)
    assert text is not None and "..." in text


def test_display_other_values() -> None:
    assert display(3, 10) == "3"
    assert display("a", 10) == "'a'"
    assert display({"a": 1}, 10) == "{'a': 1}"


def test_display_explorer_objects(bridge: FakeBridge) -> None:
    assert display(explorer.cells, 5000) == "<cells: 5,000 cells — Xenium demo>"


# format_exception


def test_format_exception_hides_explorer_frames(bridge: FakeBridge) -> None:
    source = 'x = 1\ny = cells["Cell typ"]'
    error = run(source)
    text = format_exception(error, source)
    assert text.splitlines() == [
        "Traceback (most recent call last):",
        '  File "<console>", line 2, in <module>',
        '    y = cells["Cell typ"]',
        'KeyError: No column "Cell typ". Did you mean "Cell type"? See cells.columns for the list.',
    ]
    assert "explorer" not in text.lower().replace("cells", "")
    assert "_cells.py" not in text and "During handling" not in text


def test_format_exception_shows_user_functions(bridge: FakeBridge) -> None:
    source = "def pick():\n    return cells.gene('BIG')\n\npick()"
    error = run(source)
    lines = format_exception(error, source).splitlines()
    assert lines[1:5] == [
        '  File "<console>", line 4, in <module>',
        "    pick()",
        '  File "<console>", line 2, in pick',
        "    return cells.gene('BIG')",
    ]
    assert lines[-1] == "ReadTooLarge: Reading BIG downloads a lot."
    assert "fake_bridge" not in "\n".join(lines)


def test_format_exception_without_source() -> None:
    error = run("1 / 0")
    assert format_exception(error).splitlines() == [
        "Traceback (most recent call last):",
        '  File "<console>", line 1, in <module>',
        "ZeroDivisionError: division by zero",
    ]


def test_format_exception_keeps_user_chains() -> None:
    source = "try:\n    1 / 0\nexcept ZeroDivisionError as e:\n    raise ValueError('bad') from e"
    text = format_exception(run(source), source)
    assert "ZeroDivisionError: division by zero" in text
    assert "The above exception was the direct cause of the following exception:" in text
    assert text.endswith("ValueError: bad")


def test_format_exception_with_no_user_frames() -> None:
    assert format_exception(KeyError("x")) == "KeyError: 'x'"
    assert format_exception(ValueError()) == "ValueError"


def test_format_exception_notes() -> None:
    error = ValueError("bad")
    error.add_note("a note")
    assert format_exception(error) == "ValueError: bad\na note"


def test_format_syntax_error_with_caret() -> None:
    with pytest.raises(SyntaxError) as caught:
        compile("x = (1 +\n", "<console>", "exec")
    text = format_exception(caught.value)
    assert text.startswith('  File "<console>", line 1')
    assert "^" in text
    assert text.splitlines()[-1].startswith("SyntaxError:")


# complete


def test_complete_names() -> None:
    space = namespace()
    assert "cells" in complete("cel", 3, space)
    assert "color(" in complete("col", 3, space)
    assert complete("", 0, space) == []
    assert complete("1 + ", 4, space) == []
    # Not after a call, a subscript or inside a number.
    assert complete("np.ones(3).sh", 13, space) == []
    assert complete("x[0].re", 7, space) == []
    assert complete("1.5e", 4, space) == []


def test_complete_attributes(bridge: FakeBridge) -> None:
    space = namespace()
    found = complete("cells.ar", 8, space)
    assert found == ["cells.area"]
    assert "cells.gene(" in complete("cells.g", 7, space)
    assert "cells.gene_names" in complete("cells.g", 7, space)
    # Properties are not read to complete.
    assert bridge.calls["positions"] == 0


def test_complete_column_labels(bridge: FakeBridge) -> None:
    space = namespace()
    assert complete('cells["Cell', 11, space) == ["Cell area", "Cell type"]
    assert complete("x = cells['T", 12, space) == ["Transcripts"]
    # Case is ignored when nothing matches exactly.
    assert complete('cells["cell t', 13, space) == ["Cell type"]
    assert len(complete('cells["', 7, space)) == len(explorer.cells.columns)


def test_complete_gene_names(bridge: FakeBridge) -> None:
    space = namespace()
    assert complete('cells.gene("CD', 14, space) == ["CD3E"]
    assert complete("cells.gene('ms", 14, space) == ["MS4A1"]
    complete('cells.gene("S', 13, space)
    assert bridge.calls["gene_names"] == 1


def test_complete_uses_text_before_the_cursor(bridge: FakeBridge) -> None:
    source = 'cells["Cell t"] + 1'
    assert complete(source, 13, namespace()) == ["Cell type"]


def test_complete_dedupes_and_limits() -> None:
    space = {f"name{index}": index for index in range(300)}
    found = complete("name", 4, space)
    assert len(found) == 200
    assert found == sorted(set(found))


def test_complete_without_a_dataset() -> None:
    assert complete('cells["', 7, namespace()) == []


def test_token_start() -> None:
    assert token_start('x = cells["Cell t', 17) == 11
    assert token_start('cells.gene("CD', 14) == 12
    assert token_start("y = cells.ar", 12) == 4
    assert token_start("y = ", 4) == 4
