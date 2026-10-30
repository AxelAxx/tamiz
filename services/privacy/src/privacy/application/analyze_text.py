"""Use case: which personal data a text contains and how sensitive it is (spec 004 US1)."""

from collections.abc import Mapping
from dataclasses import dataclass, field

from privacy.application.ports import PiiAnalyzerPort
from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding
from privacy.domain.overlap import resolve_overlaps
from privacy.domain.sensitivity import SensitivityLevel, counts_of, level_of

ALL_KINDS: frozenset[EntityKind] = frozenset(EntityKind)
DEFAULT_MIN_SCORE = 0.5


@dataclass(frozen=True, slots=True)
class AnalyzeCommand:
    text: str
    min_score: float = DEFAULT_MIN_SCORE
    kinds: frozenset[EntityKind] = ALL_KINDS


@dataclass(frozen=True, slots=True)
class AnalysisResult:
    findings: tuple[Finding, ...]
    counts: Mapping[EntityKind, int] = field(default_factory=dict)
    level: SensitivityLevel = SensitivityLevel.NONE


def analyze_text(analyzer: PiiAnalyzerPort, command: AnalyzeCommand) -> AnalysisResult:
    raw = analyzer.analyze(command.text, command.kinds) if command.text.strip() else ()
    kept = [f for f in raw if f.kind in command.kinds and f.score >= command.min_score]
    findings = resolve_overlaps(kept)
    return AnalysisResult(findings=findings, counts=counts_of(findings), level=level_of(findings))
