"""Use case `anonymize_text` (spec 004 US3-7)."""

from privacy.application.analyze_text import AnalyzeCommand
from privacy.application.anonymize_text import anonymize_text
from privacy.domain.entity_kind import EntityKind
from privacy.domain.sensitivity import SensitivityLevel
from tests.support.fakes import FakeAnalyzer, spans

K = EntityKind
TEXT = "Soy Ana Ruiz, DNI 12345678Z, y mi primo es 87654321X."


def test_us3_7_the_result_carries_the_analysis_of_the_original_text() -> None:
    analyzer = FakeAnalyzer(
        lambda text: spans(
            text,
            (K.PERSON, "Ana Ruiz", 0.85),
            (K.DNI, "12345678Z", 1.0),
            (K.DNI, "87654321X", 0.3),
        )
    )

    result = anonymize_text(analyzer, AnalyzeCommand(text=TEXT))

    assert result.text == "Soy <PERSON_1>, DNI <DNI_1>, y mi primo es 87654321X."
    assert result.analysis.level is SensitivityLevel.CRITICAL
    assert [(f.kind, TEXT[f.start : f.end]) for f in result.analysis.findings] == [
        (K.PERSON, "Ana Ruiz"),
        (K.DNI, "12345678Z"),
    ]


def test_only_reported_findings_are_replaced() -> None:
    analyzer = FakeAnalyzer(lambda text: spans(text, (K.PERSON, "Ana Ruiz", 0.85)))

    result = anonymize_text(analyzer, AnalyzeCommand(text=TEXT, kinds=frozenset({K.DNI})))

    assert result.text == TEXT
    assert result.mapping == ()
