"""Sensitivity level by rule (spec 004 FR-006; US1-1 … US1-4, domain part)."""

import pytest

from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding, finding
from privacy.domain.sensitivity import LEVEL_BY_KIND, SensitivityLevel, counts_of, level_of

K = EntityKind


def f(kind: EntityKind, start: int = 0) -> Finding:
    return Finding(kind=kind, start=start, end=start + 1, score=0.9)


def test_level_mapping_is_total() -> None:
    assert set(LEVEL_BY_KIND) == set(EntityKind)


def test_us1_3_no_findings_is_none() -> None:
    assert level_of([]) is SensitivityLevel.NONE


def test_us1_1_person_email_phone_is_high() -> None:
    assert level_of([f(K.PERSON), f(K.EMAIL, 2), f(K.PHONE, 4)]) is SensitivityLevel.HIGH


def test_us1_2_a_dni_makes_the_text_critical() -> None:
    assert level_of([f(K.PERSON), f(K.DNI, 2)]) is SensitivityLevel.CRITICAL


@pytest.mark.parametrize("kind", [K.LOCATION, K.CIF])
def test_us1_4_only_location_or_cif_is_low(kind: EntityKind) -> None:
    assert level_of([f(kind)]) is SensitivityLevel.LOW


@pytest.mark.parametrize("kind", [K.DNI, K.NIE, K.NSS, K.IBAN, K.CREDIT_CARD])
def test_critical_kinds(kind: EntityKind) -> None:
    assert LEVEL_BY_KIND[kind] is SensitivityLevel.CRITICAL


def test_counts_only_present_kinds() -> None:
    assert counts_of([f(K.PERSON), f(K.PERSON, 2), f(K.EMAIL, 4)]) == {K.PERSON: 2, K.EMAIL: 1}


@pytest.mark.parametrize(
    ("start", "end", "score"), [(-1, 3, 0.5), (3, 3, 0.5), (4, 3, 0.5), (0, 3, 1.5), (0, 3, -0.1)]
)
def test_incoherent_findings_are_rejected_without_raising(
    start: int, end: int, score: float
) -> None:
    assert finding(K.DNI, start, end, score) is None


def test_coherent_finding() -> None:
    assert finding(K.DNI, 0, 9, 1.0) == Finding(K.DNI, 0, 9, 1.0)
