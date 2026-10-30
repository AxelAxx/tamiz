"""Precision and recall per kind over the corpus (spec 004 US4, SC-001, SC-002; R-14).

Matching: for structured kinds and cards a prediction counts only with the exact kind and
offsets; for `PERSON` and `LOCATION` the kind must match and the spans overlap (NER
boundaries legitimately differ on titles and particles). Each label is matched at most once.
"""

import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from privacy.domain.entity_kind import STRUCTURED, EntityKind
from privacy.domain.finding import Finding
from tests.support.corpus import Span

LENIENT = frozenset({EntityKind.PERSON, EntityKind.LOCATION})

THRESHOLDS: Mapping[EntityKind, Mapping[str, float]] = {
    **{kind: {"precision": 0.95, "recall": 0.95} for kind in STRUCTURED},
    EntityKind.PERSON: {"recall": 0.80},
}


@dataclass
class KindCounts:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    @property
    def support(self) -> int:
        return self.tp + self.fn

    @property
    def precision(self) -> float:
        predicted = self.tp + self.fp
        return self.tp / predicted if predicted else 1.0

    @property
    def recall(self) -> float:
        return self.tp / self.support if self.support else 1.0


@dataclass
class Scores:
    per_kind: dict[EntityKind, KindCounts] = field(
        default_factory=lambda: {kind: KindCounts() for kind in EntityKind}
    )

    def add_case(self, labels: Sequence[Span], predictions: Iterable[Finding]) -> None:
        unmatched = list(labels)
        for p in predictions:
            match = next((label for label in unmatched if _matches(label, p)), None)
            if match is None:
                self.per_kind[p.kind].fp += 1
            else:
                unmatched.remove(match)
                self.per_kind[p.kind].tp += 1
        for label in unmatched:
            self.per_kind[label.kind].fn += 1

    def failures(self) -> list[str]:
        problems = []
        for kind, limits in THRESHOLDS.items():
            counts = self.per_kind[kind]
            for metric, minimum in limits.items():
                value = counts.precision if metric == "precision" else counts.recall
                if value < minimum:
                    problems.append(f"{kind.value} {metric} {value:.3f} < {minimum}")
        return problems

    def table(self) -> str:
        rows = [f"{'kind':<12}{'support':>8}{'tp':>6}{'fp':>6}{'fn':>6}{'prec':>8}{'recall':>8}"]
        for kind, c in self.per_kind.items():
            rows.append(
                f"{kind.value:<12}{c.support:>8}{c.tp:>6}{c.fp:>6}{c.fn:>6}"
                f"{c.precision:>8.3f}{c.recall:>8.3f}"
            )
        return "\n".join(rows)

    def report(self, **extra: object) -> dict[str, object]:
        return {
            **extra,
            "per_kind": {
                kind.value: {
                    "support": c.support,
                    "tp": c.tp,
                    "fp": c.fp,
                    "fn": c.fn,
                    "precision": round(c.precision, 4),
                    "recall": round(c.recall, 4),
                }
                for kind, c in self.per_kind.items()
            },
            "thresholds": {k.value: dict(v) for k, v in THRESHOLDS.items()},
            "failures": self.failures(),
            "passed": not self.failures(),
        }


def _matches(label: Span, prediction: Finding) -> bool:
    if label.kind != prediction.kind:
        return False
    if label.kind in LENIENT:
        return label.start < prediction.end and prediction.start < label.end
    return (label.start, label.end) == (prediction.start, prediction.end)


def write_report(path: Path, report: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
