"""Reversible placeholders (spec 004 US3-1 … US3-4, US3-6, FR-014, FR-015; research R-07)."""

from hypothesis import given
from hypothesis import strategies as st

from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding
from privacy.domain.overlap import resolve_overlaps
from privacy.domain.placeholders import PlaceholderEntry, anonymize
from tests.support.fakes import spans
from tests.support.restore import restore

K = EntityKind


def all_spans(text: str, kind: EntityKind, value: str) -> list[Finding]:
    found, start = [], text.find(value)
    while start != -1:
        found.append(Finding(kind, start, start + len(value), 0.9))
        start = text.find(value, start + len(value))
    return found


def test_us3_1_each_kind_is_numbered_in_order_of_first_appearance() -> None:
    text = "Ana Ruiz y Pedro Gil, DNI 12345678Z, escriben a ana@example.com."
    findings = spans(
        text,
        (K.PERSON, "Ana Ruiz", 0.85),
        (K.PERSON, "Pedro Gil", 0.85),
        (K.DNI, "12345678Z", 1.0),
        (K.EMAIL, "ana@example.com", 1.0),
    )

    result = anonymize(text, findings)

    assert result.text == "<PERSON_1> y <PERSON_2>, DNI <DNI_1>, escriben a <EMAIL_1>."
    assert result.mapping == (
        PlaceholderEntry("<PERSON_1>", K.PERSON, "Ana Ruiz"),
        PlaceholderEntry("<PERSON_2>", K.PERSON, "Pedro Gil"),
        PlaceholderEntry("<DNI_1>", K.DNI, "12345678Z"),
        PlaceholderEntry("<EMAIL_1>", K.EMAIL, "ana@example.com"),
    )
    for entry in result.mapping:
        assert entry.value not in result.text


def test_us3_2_the_same_value_shares_one_placeholder() -> None:
    text = "Lucía llamó. Lucía volvió a llamar. Dile a Lucía que sí."

    result = anonymize(text, all_spans(text, K.PERSON, "Lucía"))

    assert result.text == "<PERSON_1> llamó. <PERSON_1> volvió a llamar. Dile a <PERSON_1> que sí."
    assert result.mapping == (PlaceholderEntry("<PERSON_1>", K.PERSON, "Lucía"),)


def test_the_same_value_of_two_kinds_gets_two_placeholders() -> None:
    text = "Valencia es mi apellido y Valencia mi ciudad."
    findings = [Finding(K.PERSON, 0, 8, 0.85), Finding(K.LOCATION, 26, 34, 0.85)]

    result = anonymize(text, findings)

    assert result.text == "<PERSON_1> es mi apellido y <LOCATION_1> mi ciudad."


def test_us3_3_restore_gives_back_the_original() -> None:
    text = "Ana Ruiz, DNI 12345678Z. Ana Ruiz otra vez."
    findings = [*all_spans(text, K.PERSON, "Ana Ruiz"), *spans(text, (K.DNI, "12345678Z", 1.0))]

    result = anonymize(text, resolve_overlaps(findings))

    assert restore(result.text, result.mapping) == text


def test_us3_4_no_findings_leave_the_text_unchanged() -> None:
    result = anonymize("Nada que ocultar.", [])

    assert result.text == "Nada que ocultar."
    assert result.mapping == ()


def test_us3_6_new_placeholders_skip_numbers_already_in_the_text() -> None:
    text = "Plantilla <DNI_1> y <DNI_3>; real 12345678Z; nombre <PERSON_2> y Ana."
    findings = spans(text, (K.DNI, "12345678Z", 1.0), (K.PERSON, "Ana", 0.85))

    result = anonymize(text, findings)

    assert (
        result.text == "Plantilla <DNI_1> y <DNI_3>; real <DNI_4>; nombre <PERSON_2> y <PERSON_3>."
    )
    assert restore(result.text, result.mapping) == text


def test_the_whole_text_can_be_one_finding() -> None:
    result = anonymize("12345678Z", [Finding(K.DNI, 0, 9, 1.0)])

    assert result.text == "<DNI_1>"
    assert restore(result.text, result.mapping) == "12345678Z"


ALPHABET = "ab <>_DNIPERSON0123456789"


@st.composite
def text_and_findings(draw: st.DrawFn) -> tuple[str, list[Finding]]:
    text = draw(st.text(ALPHABET, max_size=60))
    cuts = sorted(draw(st.sets(st.integers(0, len(text)), max_size=8)))
    findings = []
    for start, end in zip(cuts[::2], cuts[1::2], strict=False):
        if end > start:
            kind = draw(st.sampled_from([K.DNI, K.PERSON, K.EMAIL]))
            findings.append(Finding(kind, start, end, 0.9))
    return text, findings


@given(text_and_findings())
def test_us3_3_round_trip_for_any_text_and_findings(case: tuple[str, list[Finding]]) -> None:
    text, findings = case

    result = anonymize(text, findings)

    assert restore(result.text, result.mapping) == text
    placeholders = [entry.placeholder for entry in result.mapping]
    assert len(placeholders) == len(set(placeholders))
