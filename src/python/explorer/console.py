"""Helpers for the app's Python console: when to run, what to print, completions."""

import codeop
import io
import re
import rlcompleter
import tokenize
import traceback
import warnings
from typing import Any

import numpy as np

from ._bridge import ExplorerError
from ._cells import Cells

FILENAME = "<console>"
MAX_COMPLETIONS = 200

# A last token that needs something after it: the input goes on.
_CONTINUING_OPS = {
    "+", "-", "*", "/", "//", "%", "**", "@", "<<", ">>", "&", "|", "^", "~",
    "<", ">", "<=", ">=", "==", "!=", "=", ":=", ".", "->",
    "+=", "-=", "*=", "/=", "//=", "%=", "**=", "@=", "<<=", ">>=", "&=", "|=", "^=",
}  # fmt: skip
_CONTINUING_WORDS = {"and", "or", "not", "in", "is"}

_COLUMN_STRING = re.compile(r"""\bcells\s*\[\s*(["'])([^"'\\]*)$""")
_GENE_STRING = re.compile(r"""\bcells\s*\.\s*gene\s*\(\s*(["'])([^"'\\]*)$""")
# A dotted name, not following an attribute of a call or subscript, or a number.
_NAME = re.compile(r"(?<![\w.)\]\"'])[A-Za-z_][\w.]*$")

_cells = Cells()


def _compile(source: str, symbol: str) -> Any:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return codeop.compile_command(source, FILENAME, symbol)


def is_complete(source: str) -> bool:
    """True when the input would run (or fails with a syntax error to show),
    False when it needs more lines, as an interactive console decides."""
    if not source.strip():
        return True
    try:
        return _compile(source, "single") is not None
    except (SyntaxError, OverflowError, ValueError):
        pass
    # Several statements (pasted): judge them as a block.
    try:
        return _compile(source, "exec") is not None
    except (SyntaxError, OverflowError, ValueError):
        return not _ends_open(source)


def _ends_open(source: str) -> bool:
    """Whether the last token is an operator that needs a right-hand side."""
    last = None
    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            if token.type in (tokenize.OP, tokenize.NAME):
                last = token
            elif token.type not in (
                tokenize.NEWLINE, tokenize.NL, tokenize.COMMENT, tokenize.INDENT,
                tokenize.DEDENT, tokenize.ENDMARKER,
            ):  # fmt: skip
                last = None
    except (tokenize.TokenError, SyntaxError):
        return False
    if last is None:
        return False
    if last.type == tokenize.OP:
        return last.string in _CONTINUING_OPS
    return last.string in _CONTINUING_WORDS


def display(value: Any, count: int) -> str | None:
    """What the console prints for the last expression's value, or None for nothing."""
    if value is None:
        return None
    if isinstance(value, np.ndarray):
        if value.dtype == np.bool_ and value.shape == (count,):
            return f"mask: {int(np.count_nonzero(value)):,} of {count:,} cells"
        return np.array_repr(value)
    return repr(value)


def format_exception(exc: BaseException, source: str | None = None) -> str:
    """The error as the console shows it: only frames from the user's code.

    Frames come from code compiled as "<console>"; source (the input just run)
    supplies their lines when linecache has none.
    """
    if isinstance(exc, SyntaxError):
        return "".join(traceback.format_exception_only(type(exc), exc)).rstrip("\n")
    lines = source.splitlines() if source is not None else []
    parts: list[str] = []
    for error, link in _chain(exc):
        frames = _user_frames(error)
        if error is not exc and not frames:
            continue
        if parts and link:
            parts.append(f"\n{link}\n")
        parts.append(_format_one(error, frames, lines))
    return "\n".join(parts)


_CAUSE = "The above exception was the direct cause of the following exception:"
_CONTEXT = "During handling of the above exception, another exception occurred:"


def _chain(exc: BaseException) -> list[tuple[BaseException, str]]:
    """The exception and those it was raised from, oldest first, each with the
    sentence that links it to the next."""
    chain: list[tuple[BaseException, str]] = [(exc, "")]
    seen = {id(exc)}
    current = exc
    while True:
        if current.__cause__ is not None:
            current, link = current.__cause__, _CAUSE
        elif current.__context__ is not None and not current.__suppress_context__:
            current, link = current.__context__, _CONTEXT
        else:
            break
        if id(current) in seen:
            break
        seen.add(id(current))
        chain.append((current, link))
    # Oldest first; each link moves to the exception it introduces.
    errors = [error for error, _ in reversed(chain)]
    links = [link for _, link in reversed(chain)]
    return list(zip(errors, ["", *links[:-1]], strict=True))


def _user_frames(exc: BaseException) -> list[traceback.FrameSummary]:
    return [
        frame for frame in traceback.extract_tb(exc.__traceback__) if frame.filename == FILENAME
    ]


def _format_one(exc: BaseException, frames: list[traceback.FrameSummary], lines: list[str]) -> str:
    out: list[str] = []
    if frames:
        out.append("Traceback (most recent call last):")
        for frame in frames:
            out.append(f'  File "{FILENAME}", line {frame.lineno}, in {frame.name}')
            text = frame.line or _line(lines, frame.lineno)
            if text:
                out.append(f"    {text.strip()}")
    out.append(_exception_line(exc))
    out.extend(str(note) for note in getattr(exc, "__notes__", None) or [])
    return "\n".join(out)


def _line(lines: list[str], lineno: int | None) -> str:
    if lineno is None or not 0 < lineno <= len(lines):
        return ""
    return lines[lineno - 1]


def _exception_line(exc: BaseException) -> str:
    name = getattr(type(exc), "console_name", None) or type(exc).__name__
    try:
        message = str(exc)
    except Exception:  # noqa: BLE001 - a broken __str__ must not hide the error
        message = "<message unavailable>"
    return f"{name}: {message}" if message else name


def token_start(source: str, cursor: int) -> int:
    """Where the token `complete` completes begins: after the quote inside
    cells["…"] or cells.gene("…"), else at the dotted name before the cursor."""
    text = source[:cursor]
    for pattern in (_COLUMN_STRING, _GENE_STRING):
        match = pattern.search(text)
        if match:
            return match.start(2)
    match = _NAME.search(text)
    return match.start() if match else cursor


def complete(source: str, cursor: int, namespace: dict[str, Any]) -> list[str]:
    """Completions for the token before the cursor (see token_start): names and
    attributes, column labels inside cells["…"], gene names inside cells.gene("…")."""
    text = source[:cursor]
    try:
        match = _COLUMN_STRING.search(text)
        if match:
            return _pick([column.label for column in _cells.columns], match.group(2))
        match = _GENE_STRING.search(text)
        if match:
            return _pick(_cells.gene_names, match.group(2))
        match = _NAME.search(text)
        if not match:
            return []
        return _pick(_python_names(match.group(), namespace), match.group())
    except ExplorerError:
        return []


def _python_names(token: str, namespace: dict[str, Any]) -> list[str]:
    completer = rlcompleter.Completer(namespace)
    found: list[str] = []
    try:
        for state in range(10_000):
            match = completer.complete(token, state)
            if match is None:
                break
            found.append(match)
    except Exception:  # noqa: BLE001 - evaluating the prefix can fail any way
        return []
    return found


def _pick(candidates: list[str], prefix: str) -> list[str]:
    """Candidates starting with prefix (ignoring case if none match exactly)."""
    unique = set(candidates)
    matches = [item for item in unique if item.startswith(prefix)]
    if not matches:
        lower = prefix.lower()
        matches = [item for item in unique if item.lower().startswith(lower)]
    return sorted(matches)[:MAX_COMPLETIONS]
