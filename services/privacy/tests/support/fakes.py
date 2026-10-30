"""In-memory fake of the analyzer port (constitution VIII)."""

from collections.abc import Callable, Sequence

from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding

type Script = Callable[[str], Sequence[Finding]]


class FakeAnalyzer:
    """Answers from a script (text → findings); records every call."""

    def __init__(self, script: Script | None = None, *, ready: bool = True) -> None:
        self._script: Script = script or (lambda _text: ())
        self.ready = ready
        self.calls: list[tuple[str, frozenset[EntityKind]]] = []

    def analyze(self, text: str, kinds: frozenset[EntityKind]) -> Sequence[Finding]:
        self.calls.append((text, kinds))
        return self._script(text)

    def is_ready(self) -> bool:
        return self.ready


def spans(text: str, *items: tuple[EntityKind, str, float]) -> list[Finding]:
    """Findings for the first occurrence of each value in `text`."""
    found = []
    for kind, value, score in items:
        start = text.index(value)
        found.append(Finding(kind=kind, start=start, end=start + len(value), score=score))
    return found
