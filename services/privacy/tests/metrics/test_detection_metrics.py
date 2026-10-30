"""Detection metrics over the synthetic corpus, with thresholds (spec 004 US4-1, US4-4,
SC-001 … SC-003). Writes `reports/detection-metrics.json` for the evals feature and CI."""

from pathlib import Path

import pytest

from privacy.application.analyze_text import AnalyzeCommand, analyze_text
from privacy.application.anonymize_text import anonymize_text
from privacy.infrastructure.presidio_analyzer import PresidioAnalyzer, build_engine
from tests.metrics.scoring import Scores, write_report
from tests.support.corpus import load_cases, load_meta
from tests.support.restore import restore

pytestmark = pytest.mark.metrics

REPORT = Path(__file__).resolve().parents[2] / "reports" / "detection-metrics.json"


@pytest.fixture(scope="module")
def analyzer() -> PresidioAnalyzer:
    return PresidioAnalyzer(build_engine("es_core_news_lg"))


def test_us4_1_us4_4_detection_meets_the_thresholds(analyzer: PresidioAnalyzer) -> None:
    scores = Scores()
    round_trip_exact = 0
    values_left = 0
    cases = load_cases()

    for case in cases:
        command = AnalyzeCommand(text=case.text)
        scores.add_case(case.spans, analyze_text(analyzer, command).findings)
        anonymized = anonymize_text(analyzer, command)
        round_trip_exact += restore(anonymized.text, anonymized.mapping) == case.text
        values_left += sum(entry.value in anonymized.text for entry in anonymized.mapping)

    report = scores.report(
        corpus_version=load_meta()["version"],
        cases=len(cases),
        min_score=AnalyzeCommand(text="").min_score,
        round_trip={"cases": len(cases), "exact": round_trip_exact, "values_left": values_left},
    )
    write_report(REPORT, report)
    print("\n" + scores.table())

    assert round_trip_exact == len(cases), "SC-003: anonymize → restore must be exact"
    assert values_left == 0, "SC-003: no reported value may remain in anonymized text"
    assert scores.failures() == [], "detection below threshold: " + "; ".join(scores.failures())
