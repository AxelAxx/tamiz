"""The synthetic corpus (spec 004 FR-017; data-model §5), loaded for tests."""

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from privacy.domain.entity_kind import EntityKind

CORPUS = Path(__file__).resolve().parents[1] / "corpus" / "pii-es.v1.jsonl"


@dataclass(frozen=True, slots=True)
class Span:
    kind: EntityKind
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class CorpusCase:
    id: str
    text: str
    spans: tuple[Span, ...]
    tags: tuple[str, ...]

    def value(self, span: Span) -> str:
        return self.text[span.start : span.end]


@cache
def load_meta() -> dict[str, object]:
    first = CORPUS.read_text(encoding="utf-8").splitlines()[0]
    meta: dict[str, object] = json.loads(first)
    return meta


@cache
def load_cases() -> tuple[CorpusCase, ...]:
    cases = []
    for line in CORPUS.read_text(encoding="utf-8").splitlines()[1:]:
        record = json.loads(line)
        cases.append(
            CorpusCase(
                id=record["id"],
                text=record["text"],
                spans=tuple(
                    Span(EntityKind(s["kind"]), s["start"], s["end"]) for s in record["spans"]
                ),
                tags=tuple(record["tags"]),
            )
        )
    return tuple(cases)
