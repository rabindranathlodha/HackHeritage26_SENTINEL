"""Tracks which model artifacts are actually loaded into the process.

`GET /health` reports the true state — it never claims a model is loaded when
it is not. At step 3.1 no artifacts exist yet, so all three report False; each
model registers itself here as it is built (3.5 A, 3.6 C, 3.7 B).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ModelRegistry:
    """In-process registry of loaded inference models."""

    _loaded: dict[str, bool] = field(
        default_factory=lambda: {"a": False, "b": False, "c": False}
    )

    def mark_loaded(self, key: str, loaded: bool = True) -> None:
        if key not in self._loaded:
            raise KeyError(f"unknown model key {key!r}; expected one of a, b, c")
        self._loaded[key] = loaded

    def status(self) -> dict[str, bool]:
        return dict(self._loaded)


registry = ModelRegistry()
