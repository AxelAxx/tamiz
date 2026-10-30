"""Ports the use cases depend on (constitution VIII)."""

from collections.abc import Sequence
from typing import Protocol

from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding


class PiiAnalyzerPort(Protocol):
    def analyze(self, text: str, kinds: frozenset[EntityKind]) -> Sequence[Finding]:
        """Raw findings for `kinds`: unfiltered by score, possibly overlapping."""
        ...

    def is_ready(self) -> bool: ...
