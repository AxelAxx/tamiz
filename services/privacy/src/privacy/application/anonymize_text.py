"""Use case: replace personal data by reversible placeholders (spec 004 US3).

The analysis is the same as `analyze_text` (kinds, minimum score, overlaps), so exactly the
reported findings are replaced. The mapping is returned to the caller and kept nowhere.
"""

from dataclasses import dataclass

from privacy.application.analyze_text import AnalysisResult, AnalyzeCommand, analyze_text
from privacy.application.ports import PiiAnalyzerPort
from privacy.domain.placeholders import PlaceholderEntry, anonymize


@dataclass(frozen=True, slots=True)
class AnonymizationResult:
    text: str
    mapping: tuple[PlaceholderEntry, ...]
    analysis: AnalysisResult


def anonymize_text(analyzer: PiiAnalyzerPort, command: AnalyzeCommand) -> AnonymizationResult:
    analysis = analyze_text(analyzer, command)
    anonymized = anonymize(command.text, analysis.findings)
    return AnonymizationResult(text=anonymized.text, mapping=anonymized.mapping, analysis=analysis)
