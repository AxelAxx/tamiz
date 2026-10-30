"""One piece of personal data found in a text: where it is, never what it is."""

from dataclasses import dataclass

from privacy.domain.entity_kind import EntityKind


@dataclass(frozen=True, slots=True)
class Finding:
    kind: EntityKind
    start: int  # inclusive offset into the text
    end: int  # exclusive
    score: float  # 0.0 … 1.0

    @property
    def length(self) -> int:
        return self.end - self.start

    def overlaps(self, other: "Finding") -> bool:
        return self.start < other.end and other.start < self.end


def finding(kind: EntityKind, start: int, end: int, score: float) -> Finding | None:
    """A `Finding` when the values are coherent, `None` otherwise (never raises)."""
    if start < 0 or end <= start or not 0.0 <= score <= 1.0:
        return None
    return Finding(kind=kind, start=start, end=end, score=score)
