from collections.abc import Iterator

import pytest
from fake_bridge import FakeBridge, demo_bridge

import explorer
from explorer._bridge import _State


@pytest.fixture
def bridge() -> Iterator[FakeBridge]:
    """The demo dataset, connected."""
    fake = demo_bridge()
    explorer.connect(fake)
    yield fake
    _State.bridge = None
    explorer.invalidate()
