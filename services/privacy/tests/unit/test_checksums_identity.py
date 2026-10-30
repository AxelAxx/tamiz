"""DNI, NIE and CIF check characters (spec 004 FR-009, US2-2, US2-4, US2-5; research R-13).

`python-stdnum` is the test oracle; the domain functions do not depend on it.
"""

import pytest
from hypothesis import given
from hypothesis import strategies as st
from stdnum.es import cif, dni, nie

from privacy.domain.checksums import (
    CIF_DIGIT_CONTROL,
    CIF_LETTER_CONTROL,
    compact,
    is_valid_cif,
    is_valid_dni,
    is_valid_nie,
)

DIGITS = "0123456789"
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
CIF_ORG_LETTERS = "ABCDEFGHJNPQRSUVW"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("12.345.678-z", "12345678Z"), ("x 1234567 l", "X1234567L"), ("B-1234567/4", "B12345674")],
)
def test_compact_removes_separators_and_upper_cases(raw: str, expected: str) -> None:
    assert compact(raw) == expected


@pytest.mark.parametrize(
    ("candidate", "valid"),
    [
        ("12345678Z", True),
        ("00000000T", True),
        ("12345678z", True),
        ("12.345.678-Z", True),
        ("12345678A", False),
        ("1234567Z", False),
        ("123456789Z", False),
        ("ABCDEFGHZ", False),
        ("", False),
    ],
)
def test_us2_2_dni_letter(candidate: str, valid: bool) -> None:
    assert is_valid_dni(candidate) is valid


@pytest.mark.parametrize(
    ("candidate", "valid"),
    [
        ("X1234567L", True),
        ("Y1234567X", True),
        ("x-1234567-l", True),
        ("X1234567A", False),
        ("W1234567L", False),
        ("X123456L", False),
    ],
)
def test_us2_4_nie_letter(candidate: str, valid: bool) -> None:
    assert is_valid_nie(candidate) is valid


@pytest.mark.parametrize(
    ("candidate", "valid"),
    [
        ("B12345674", True),  # digit control required (A, B, E, H)
        ("A58818501", True),
        ("P1234567D", True),  # letter control required (P, Q, R, S, N, W)
        ("G12345674", True),  # either
        ("G1234567D", True),
        ("B1234567D", False),  # B needs the digit
        ("P12345674", False),  # P needs the letter
        ("B12345675", False),  # wrong control
        ("K1234567D", False),  # K, L, M are not company prefixes
        ("12345678Z", False),
    ],
)
def test_us2_5_cif_control(candidate: str, valid: bool) -> None:
    assert is_valid_cif(candidate) is valid


@given(st.text(DIGITS, min_size=8, max_size=8), st.sampled_from(LETTERS))
def test_dni_agrees_with_stdnum(number: str, letter: str) -> None:
    assert is_valid_dni(number + letter) == dni.is_valid(number + letter)


@given(st.sampled_from("XYZ"), st.text(DIGITS, min_size=7, max_size=7), st.sampled_from(LETTERS))
def test_nie_agrees_with_stdnum(prefix: str, number: str, letter: str) -> None:
    candidate = prefix + number + letter
    assert is_valid_nie(candidate) == nie.is_valid(candidate)


@given(
    st.sampled_from(CIF_ORG_LETTERS),
    st.text(DIGITS, min_size=7, max_size=7),
    st.sampled_from(DIGITS + "ABCDEFGHIJ"),
)
def test_cif_agrees_with_stdnum_plus_the_control_kind_rule(
    org: str, number: str, control: str
) -> None:
    candidate = org + number + control
    kind_ok = not (
        (org in CIF_DIGIT_CONTROL and not control.isdigit())
        or (org in CIF_LETTER_CONTROL and control.isdigit())
    )
    assert is_valid_cif(candidate) == (cif.is_valid(candidate) and kind_ok)


@given(st.text(DIGITS, min_size=8, max_size=8), st.sampled_from(LETTERS))
def test_changing_the_dni_letter_of_a_valid_dni_invalidates_it(number: str, other: str) -> None:
    letter = dni.calc_check_digit(number)
    if other != letter:
        assert not is_valid_dni(number + other)


@given(st.sampled_from("XYZ"), st.text(DIGITS, min_size=7, max_size=7), st.sampled_from(LETTERS))
def test_changing_the_nie_letter_of_a_valid_nie_invalidates_it(
    prefix: str, number: str, other: str
) -> None:
    letter = nie.calc_check_digit(prefix + number)
    assert is_valid_nie(prefix + number + letter)
    if other != letter:
        assert not is_valid_nie(prefix + number + other)


@given(st.sampled_from("ABEH"), st.text(DIGITS, min_size=7, max_size=7), st.sampled_from(DIGITS))
def test_changing_the_cif_control_digit_invalidates_it(org: str, number: str, other: str) -> None:
    digit = cif.calc_check_digits(org + number)[0]
    assert is_valid_cif(org + number + digit)
    if other != digit:
        assert not is_valid_cif(org + number + other)
