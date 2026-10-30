"""Reversible placeholders (spec 004 FR-014, FR-015; research R-07).

Each finding is replaced by `<KIND_n>`: numbered per kind from 1 in order of first
appearance, one placeholder per distinct (kind, value). Numbering starts after the highest
`n` already present in the text for that kind, so restoring by the returned mapping is
exact even when the input already contains placeholder-shaped strings. The mapping exists
only in the return value; nothing here stores it.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass

from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding

PLACEHOLDER_PATTERN = re.compile(
    r"<(" + "|".join(sorted((k.value for k in EntityKind), key=len, reverse=True)) + r")_(\d+)>"
)


@dataclass(frozen=True, slots=True)
class PlaceholderEntry:
    placeholder: str
    kind: EntityKind
    value: str


@dataclass(frozen=True, slots=True)
class Anonymized:
    text: str
    mapping: tuple[PlaceholderEntry, ...]


def _highest_existing(text: str) -> dict[EntityKind, int]:
    highest: dict[EntityKind, int] = {}
    for match in PLACEHOLDER_PATTERN.finditer(text):
        kind = EntityKind(match.group(1))
        highest[kind] = max(highest.get(kind, 0), int(match.group(2)))
    return highest


def anonymize(text: str, findings: Sequence[Finding]) -> Anonymized:
    """Replace `findings` (non-overlapping, inside `text`) by placeholders."""
    last_number = _highest_existing(text)
    by_value: dict[tuple[EntityKind, str], str] = {}
    mapping: list[PlaceholderEntry] = []
    pieces: list[str] = []
    cursor = 0
    for f in sorted(findings, key=lambda f: f.start):
        value = text[f.start : f.end]
        placeholder = by_value.get((f.kind, value))
        if placeholder is None:
            last_number[f.kind] = last_number.get(f.kind, 0) + 1
            placeholder = f"<{f.kind.value}_{last_number[f.kind]}>"
            by_value[(f.kind, value)] = placeholder
            mapping.append(PlaceholderEntry(placeholder, f.kind, value))
        pieces.append(text[cursor : f.start])
        pieces.append(placeholder)
        cursor = f.end
    pieces.append(text[cursor:])
    return Anonymized(text="".join(pieces), mapping=tuple(mapping))
