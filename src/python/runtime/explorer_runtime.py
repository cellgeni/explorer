"""The console's runner in Pyodide (plan 29-D).

Connects the ``explorer`` package to the app through a bridge whose calls
block on the main thread's replies with ``run_sync`` (JSPI), runs the user's
input, and completes names. The worker imports it once Python has started.
"""

import sys
import time

import numpy as np
from pyodide.code import eval_code_async
from pyodide.ffi import JsException, run_sync, to_js

import explorer
from explorer import DataError, ReadRefused, ReadTooLarge
from explorer import console as explorer_console

_ERRORS = {"ReadTooLarge": ReadTooLarge, "ReadRefused": ReadRefused}

user_namespace: dict = {"__name__": "__main__"}


def _array(proxy, dtype):
    """A NumPy copy of a JS typed array."""
    array = np.empty(proxy.length, dtype=dtype)
    if proxy.length > 0:
        proxy.assign_to(array)
    return array


def _js(value):
    """A request's arguments as JS objects; arrays as typed arrays."""
    if isinstance(value, np.ndarray):
        return to_js(memoryview(np.ascontiguousarray(value)))
    if isinstance(value, dict):
        return to_js({key: _js(item) for key, item in value.items()}, depth=1,
                     dict_converter=_object_from_entries)
    return value


def _object_from_entries(entries):
    from js import Object

    return Object.fromEntries(entries)


class PyodideBridge:
    """The app's data, asked of the main thread (the protocol in pythonMessages.ts).

    Stop is held off while a request is built and answered (an interrupt as
    the reply resolves can break Pyodide's event loop), then raised as
    KeyboardInterrupt once the reply is in.
    """

    def __init__(self, request, interrupts):
        self._request = request
        self._interrupts = interrupts

    def _call(self, kind: str, **arguments):
        message = {"kind": kind, **arguments}
        self._interrupts.pause()
        try:
            return run_sync(self._request(_js(message)))
        except JsException as error:
            name = getattr(error, "name", "")
            text = getattr(error, "message", str(error))
            if name in _ERRORS:
                raise _ERRORS[name](text, int(getattr(error.js_error, "bytes", 0) or 0)) from None
            raise DataError(text) from None
        finally:
            self._interrupts.resume()

    def dataset(self) -> dict:
        info = self._call("dataset")
        return {
            "name": info.name,
            "count": int(info.count),
            "noun": info.noun,
            "columns": [
                {"id": column.id, "label": column.label, "kind": column.kind, "group": column.group}
                for column in info.columns
            ],
            "has_genes": bool(info.hasGenes),
            "layers": list(info.layers),
        }

    def positions(self):
        result = self._call("positions")
        return _array(result.x, np.float64), _array(result.y, np.float64)

    def cell_ids(self) -> list[str]:
        return list(self._call("cell-ids").to_py())

    def number_column(self, column_id: str):
        return _array(self._call("number-column", columnId=column_id), np.float64)

    def category_column(self, column_id: str) -> dict:
        result = self._call("category-column", columnId=column_id)
        return {
            "codes": _array(result.codes, np.int32),
            "labels": list(result.labels),
            "extra_rows": _array(result.extraRows, np.int32),
            "extra_codes": _array(result.extraCodes, np.int32),
        }

    def gene_names(self) -> list[str]:
        return list(self._call("gene-names").to_py())

    def gene(self, name: str, layer: str | None, allow_large: bool):
        return _array(
            self._call("gene", name=name, layer=layer, allowLarge=allow_large), np.float32
        )

    def selected(self) -> int | None:
        row = self._call("selected")
        return None if row is None else int(row)

    def rois(self) -> list[dict]:
        return [
            {
                "key": roi.key,
                "name": roi.name,
                "kind": roi.kind,
                "polygons": [
                    _array(polygon, np.float64).reshape(-1, 2) for polygon in roi.polygons
                ],
                "box": bool(roi.box),
            }
            for roi in self._call("rois")
        ]

    def contains(self, key: str):
        return _array(self._call("contains", key=key), np.uint8).view(np.bool_)

    def view(self) -> dict:
        view = self._call("view")
        return {"center": tuple(view.center), "bounds": tuple(view.bounds)}

    def draw(self, command: dict) -> None:
        self._call("draw", command=command)


def _interruptible_sleep(sleep):
    """time.sleep that Stop can end, slept by the worker (Pyodide's swallows Stop)."""
    original = time.sleep

    def interruptible(seconds: float) -> None:
        seconds = float(seconds)
        if seconds < 0:
            raise ValueError("sleep length must be non-negative")
        sleep(seconds)

    interruptible.__doc__ = original.__doc__
    return interruptible


def setup(request, interrupts) -> None:
    """Connects ``explorer`` to the app and fills the user's namespace."""
    if interrupts.sleep is not None:
        time.sleep = _interruptible_sleep(interrupts.sleep)
    explorer.connect(PyodideBridge(request, interrupts))
    exec(
        "import numpy as np\n"
        "from explorer import cells, rois, view, color, highlight, show, others, clear\n"
        "from explorer import ReadTooLarge, ReadRefused, DataError\n",
        user_namespace,
    )


async def invalidate() -> None:
    """Forgets cached columns: another dataset, or other cells."""
    explorer.invalidate()


async def is_complete(source: str) -> bool:
    return explorer_console.is_complete(source)


async def run(source: str) -> dict:
    """Runs one input: ``incomplete`` when it needs more lines."""
    if not explorer_console.is_complete(source):
        return {"status": "incomplete", "display": None, "error": None}
    if source.strip() == "":
        return {"status": "ok", "display": None, "error": None}
    try:
        value = await eval_code_async(
            source, user_namespace, filename="<console>", return_mode="last_expr"
        )
    except BaseException as error:  # noqa: BLE001 - shown to the user
        return {
            "status": "error",
            "display": None,
            "error": explorer_console.format_exception(error, source),
        }
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
    try:
        count = len(explorer.cells) if _is_mask(value) else 0
        shown = explorer_console.display(value, count)
    except BaseException as error:  # noqa: BLE001 - a repr that fails
        return {
            "status": "error",
            "display": None,
            "error": explorer_console.format_exception(error, source),
        }
    if value is not None:
        user_namespace["_"] = value
    return {"status": "ok", "display": shown, "error": None}


def _is_mask(value) -> bool:
    return isinstance(value, np.ndarray) and value.dtype == np.bool_ and value.ndim == 1


async def complete(source: str, cursor: int) -> dict:
    """Completions, and where the text they replace starts."""
    try:
        return {
            "start": explorer_console.token_start(source, cursor),
            "items": list(explorer_console.complete(source, cursor, user_namespace)),
        }
    except Exception:  # noqa: BLE001 - completion never raises
        return {"start": cursor, "items": []}
