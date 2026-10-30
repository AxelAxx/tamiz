"""The corpus is versioned, synthetic, well formed and big enough (spec 004 US4-3, FR-017)."""

import importlib.util
from collections import Counter
from collections.abc import Callable
from pathlib import Path

import pytest

from privacy.domain.checksums import (
    is_spanish_phone,
    is_valid_cif,
    is_valid_dni,
    is_valid_iban,
    is_valid_nie,
    is_valid_nss,
)
from privacy.domain.entity_kind import STRUCTURED, EntityKind
from tests.support.corpus import CORPUS, load_cases, load_meta

CHECKS: dict[EntityKind, Callable[[str], bool]] = {
    EntityKind.DNI: is_valid_dni,
    EntityKind.NIE: is_valid_nie,
    EntityKind.CIF: is_valid_cif,
    EntityKind.IBAN: is_valid_iban,
    EntityKind.NSS: is_valid_nss,
    EntityKind.PHONE: is_spanish_phone,
}
BAD_TAGS: dict[str, Callable[[str], bool]] = {
    "dni-bad-letter": is_valid_dni,
    "nie-bad-letter": is_valid_nie,
    "cif-bad-control": is_valid_cif,
    "iban-bad-check": is_valid_iban,
    "nss-bad-control": is_valid_nss,
}


def test_us4_3_meta_declares_version_and_synthetic_origin() -> None:
    meta = load_meta()

    assert meta["type"] == "meta"
    assert meta["version"] == "1"
    assert meta["synthetic"] is True
    assert meta["generator"] == "scripts/generate_corpus.py"


def test_us4_3_sizes() -> None:
    cases = load_cases()
    per_kind = Counter(span.kind for case in cases for span in case.spans)
    negatives = [case for case in cases if "negative" in case.tags]

    assert len(cases) >= 300
    assert len(negatives) >= 50
    assert all(per_kind[kind] >= 30 for kind in STRUCTURED), per_kind
    assert per_kind[EntityKind.PERSON] >= 60
    assert per_kind[EntityKind.LOCATION] >= 40


def test_spans_are_sorted_disjoint_and_inside_the_text() -> None:
    assert len({case.id for case in load_cases()}) == len(load_cases())
    for case in load_cases():
        previous_end = 0
        for span in case.spans:
            assert previous_end <= span.start < span.end <= len(case.text), case.id
            previous_end = span.end


def test_every_positive_identifier_passes_its_check() -> None:
    for case in load_cases():
        for span in case.spans:
            check = CHECKS.get(span.kind)
            if check is not None:
                assert check(case.value(span)), (case.id, span.kind)


def test_every_hard_negative_identifier_fails_its_check() -> None:
    seen = Counter[str]()
    for case in load_cases():
        for tag, check in BAD_TAGS.items():
            if tag in case.tags:
                seen[tag] += 1
                candidates = [w.strip(".,") for w in case.text.split()]
                assert not any(check(w) for w in candidates), case.id
                assert case.spans == ()
    assert set(seen) == set(BAD_TAGS)


def test_us4_3_the_generator_reproduces_the_committed_file() -> None:
    script = Path(__file__).resolve().parents[2] / "scripts" / "generate_corpus.py"
    spec = importlib.util.spec_from_file_location("generate_corpus", script)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.generate() == CORPUS.read_text(encoding="utf-8")


@pytest.mark.parametrize("domain", ["example.com", "example.org", "example.net"])
def test_emails_use_only_reserved_domains(domain: str) -> None:
    emails = [
        case.value(span)
        for case in load_cases()
        for span in case.spans
        if span.kind is EntityKind.EMAIL
    ]
    assert all(e.rsplit("@", 1)[1] in {"example.com", "example.org", "example.net"} for e in emails)
    assert any(e.endswith(domain) for e in emails)
