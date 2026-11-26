"""Where the app's view is, read fresh each time."""

from ._bridge import get_bridge


class View:
    """The app's view in µm (y down)."""

    @property
    def center(self) -> tuple[float, float]:
        """The view's centre (x, y)."""
        x, y = get_bridge().view()["center"]
        return float(x), float(y)

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        """What the view shows: (min_x, min_y, max_x, max_y)."""
        min_x, min_y, max_x, max_y = get_bridge().view()["bounds"]
        return float(min_x), float(min_y), float(max_x), float(max_y)

    def __repr__(self) -> str:
        x, y = self.center
        min_x, min_y, max_x, max_y = self.bounds
        return (
            f"<view: center ({x:,.1f}, {y:,.1f}) µm, "
            f"bounds ({min_x:,.1f}, {min_y:,.1f}) to ({max_x:,.1f}, {max_y:,.1f})>"
        )
