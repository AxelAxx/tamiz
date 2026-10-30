"""The metrics scorer itself (spec 004 US4-2): matching rules and failure messages."""

from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding
from tests.metrics.scoring import Scores
from tests.support.corpus import Span

K = EntityKind


def test_structured_kinds_need_exact_offsets() -> None:
    scores = Scores()

    scores.add_case([Span(K.DNI, 10, 19)], [Finding(K.DNI, 10, 18, 1.0)])

    assert (scores.per_kind[K.DNI].tp, scores.per_kind[K.DNI].fp) == (0, 1)
    assert scores.per_kind[K.DNI].fn == 1


def test_person_and_location_count_on_overlap() -> None:
    scores = Scores()

    scores.add_case([Span(K.PERSON, 4, 20)], [Finding(K.PERSON, 8, 20, 0.85)])

    assert scores.per_kind[K.PERSON].tp == 1


def test_a_label_is_matched_at_most_once() -> None:
    scores = Scores()

    scores.add_case(
        [Span(K.PERSON, 0, 10)], [Finding(K.PERSON, 0, 4, 0.85), Finding(K.PERSON, 5, 10, 0.85)]
    )

    assert (scores.per_kind[K.PERSON].tp, scores.per_kind[K.PERSON].fp) == (1, 1)


def test_wrong_kind_is_a_false_positive_and_a_miss() -> None:
    scores = Scores()

    scores.add_case([Span(K.NSS, 0, 12)], [Finding(K.PHONE, 0, 12, 0.6)])

    assert scores.per_kind[K.PHONE].fp == 1
    assert scores.per_kind[K.NSS].fn == 1


def test_us4_2_a_failing_threshold_names_the_kind_the_metric_and_the_value() -> None:
    scores = Scores()
    for _ in range(9):
        scores.add_case([Span(K.DNI, 0, 9)], [Finding(K.DNI, 0, 9, 1.0)])
    scores.add_case([Span(K.DNI, 0, 9)], [])

    assert scores.failures() == ["DNI recall 0.900 < 0.95"]


def test_no_support_and_no_predictions_is_perfect() -> None:
    scores = Scores()

    assert scores.per_kind[K.CIF].precision == 1.0
    assert scores.per_kind[K.CIF].recall == 1.0
    assert scores.failures() == []
