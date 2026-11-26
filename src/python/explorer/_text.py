"""Small text helpers shared by the error messages and reprs."""

import difflib
from collections.abc import Iterable


class NotFound(KeyError):
    """A KeyError whose message prints as written, without quotes."""

    console_name = "KeyError"

    def __str__(self) -> str:
        return str(self.args[0]) if self.args else ""


def suggest(name: str, choices: Iterable[str]) -> str:
    """' Did you mean "a" or "b"?' for close matches, else ''."""
    matches = difflib.get_close_matches(name, list(choices), n=3, cutoff=0.6)
    if not matches:
        return ""
    quoted = [f'"{match}"' for match in matches]
    joined = quoted[0] if len(quoted) == 1 else ", ".join(quoted[:-1]) + " or " + quoted[-1]
    return f" Did you mean {joined}?"


def count_noun(count: int, noun: str) -> str:
    """'1,414,155 cells', or '1 cell'."""
    if count == 1 and noun.endswith("s"):
        noun = noun[:-1]
    return f"{count:,} {noun}"
