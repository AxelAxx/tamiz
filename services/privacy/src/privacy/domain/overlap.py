"""One finding per span (research R-08): higher score, then the more specific kind, then the
longer span wins."""

from collections.abc import Sequence

from privacy.domain.entity_kind import SPECIFICITY
from privacy.domain.finding import Finding

_SPECIFICITY_RANK = {kind: rank for rank, kind in enumerate(SPECIFICITY)}


def _priority(f: Finding) -> tuple[float, int, int, int]:
    # Larger is better; the start offset makes the order total (deterministic results).
    return (f.score, -_SPECIFICITY_RANK[f.kind], f.length, -f.start)


def resolve_overlaps(findings: Sequence[Finding]) -> tuple[Finding, ...]:
    kept: list[Finding] = []
    for candidate in sorted(set(findings), key=_priority, reverse=True):
        if not any(candidate.overlaps(k) for k in kept):
            kept.append(candidate)
    return tuple(sorted(kept, key=lambda f: (f.start, f.end)))
