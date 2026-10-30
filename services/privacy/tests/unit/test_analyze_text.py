"""Use case `analyze_text` with a fake analyzer (spec 004 US1-5, FR-007)."""

from privacy.application.analyze_text import ALL_KINDS, AnalyzeCommand, analyze_text
from privacy.domain.entity_kind import EntityKind
from privacy.domain.sensitivity import SensitivityLevel
from tests.support.fakes import FakeAnalyzer, spans

K = EntityKind
TEXT = "Soy Lucía Fernández y vivo en Valencia, DNI 12345678Z"


def scripted() -> FakeAnalyzer:
    return FakeAnalyzer(
        lambda text: spans(
            text,
            (K.PERSON, "Lucía Fernández", 0.85),
            (K.LOCATION, "Valencia", 0.85),
            (K.DNI, "12345678Z", 0.45),
        )
    )


def test_findings_below_min_score_are_dropped_before_the_level() -> None:
    result = analyze_text(scripted(), AnalyzeCommand(text=TEXT))

    assert [f.kind for f in result.findings] == [K.PERSON, K.LOCATION]
    assert result.level is SensitivityLevel.HIGH


def test_us1_5_a_higher_min_score_drops_more_findings() -> None:
    result = analyze_text(scripted(), AnalyzeCommand(text=TEXT, min_score=0.9))

    assert result.findings == ()
    assert result.level is SensitivityLevel.NONE


def test_a_lower_min_score_keeps_weak_findings() -> None:
    result = analyze_text(scripted(), AnalyzeCommand(text=TEXT, min_score=0.4))

    assert result.level is SensitivityLevel.CRITICAL
    assert result.counts == {K.PERSON: 1, K.LOCATION: 1, K.DNI: 1}


def test_kinds_restrict_what_is_reported() -> None:
    analyzer = scripted()

    result = analyze_text(analyzer, AnalyzeCommand(text=TEXT, kinds=frozenset({K.LOCATION})))

    assert [f.kind for f in result.findings] == [K.LOCATION]
    assert result.level is SensitivityLevel.LOW
    assert analyzer.calls == [(TEXT, frozenset({K.LOCATION}))]


def test_empty_or_blank_text_is_not_analyzed() -> None:
    analyzer = scripted()

    for text in ("", "   \n"):
        result = analyze_text(analyzer, AnalyzeCommand(text=text))
        assert result.findings == ()
        assert result.level is SensitivityLevel.NONE
    assert analyzer.calls == []


def test_all_kinds_by_default() -> None:
    assert AnalyzeCommand(text="x").kinds == ALL_KINDS
