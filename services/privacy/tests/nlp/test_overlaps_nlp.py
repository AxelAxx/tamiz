"""One finding per span with every recognizer registered (spec 004 edge cases; R-08)."""

import pytest

from privacy.application.analyze_text import AnalyzeCommand, analyze_text
from privacy.infrastructure.presidio_analyzer import PresidioAnalyzer

pytestmark = pytest.mark.nlp


def kinds(analyzer: PresidioAnalyzer, text: str) -> list[tuple[str, str]]:
    result = analyze_text(analyzer, AnalyzeCommand(text=text))
    return [(f.kind.value, text[f.start : f.end]) for f in result.findings]


def test_phone_shaped_digits_inside_an_iban_are_one_iban(analyzer: PresidioAnalyzer) -> None:
    text = "IBAN ES91 2100 0418 4502 0005 1332 y teléfono 699 888 777"

    assert kinds(analyzer, text) == [
        ("IBAN", "ES91 2100 0418 4502 0005 1332"),
        ("PHONE", "699 888 777"),
    ]


def test_a_compact_nss_is_reported_once(analyzer: PresidioAnalyzer) -> None:
    text = "NSS 281234567840 del trabajador."

    assert kinds(analyzer, text) == [("NSS", "281234567840")]


def test_mixed_identifiers_in_one_text(analyzer: PresidioAnalyzer) -> None:
    text = (
        "Expediente de Jorge Navarro Gil, NIE Y1234567X, cuenta ES91 2100 0418 4502 0005 1332, "
        "empresa B12345674, móvil +34 612 345 678."
    )

    found = kinds(analyzer, text)

    assert ("NIE", "Y1234567X") in found
    assert ("IBAN", "ES91 2100 0418 4502 0005 1332") in found
    assert ("CIF", "B12345674") in found
    assert ("PHONE", "+34 612 345 678") in found
    assert len({(k, v) for k, v in found}) == len(found)
