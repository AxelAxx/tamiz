"""IBAN, NSS and Spanish phone structure (spec 004 FR-010 … FR-012, US2-6 … US2-8; R-13)."""

import pytest
from hypothesis import given
from hypothesis import strategies as st
from stdnum import iban
from stdnum.es import ccc

from privacy.domain.checksums import is_spanish_phone, is_valid_iban, is_valid_nss

DIGITS = "0123456789"


@pytest.mark.parametrize(
    ("candidate", "valid"),
    [
        ("ES9121000418450200051332", True),
        ("ES91 2100 0418 4502 0005 1332", True),
        ("es91 2100 0418 4502 0005 1332", True),
        ("ES9121000418450200051333", False),  # mod-97 fails
        ("ES4121000418990200051332", False),  # mod-97 passes, account control digits fail
        ("ES912100041845020005133", False),  # wrong length for ES
        ("DE89370400440532013000", True),
        ("FR1420041010050500013M02606", True),
        ("GB82WEST12345698765432", True),
        ("NL91ABNA0417164300", True),
        ("XX89370400440532013000", False),  # unknown country
        ("", False),
    ],
)
def test_us2_6_iban(candidate: str, valid: bool) -> None:
    assert is_valid_iban(candidate) is valid


def _spanish_iban(bank: str, branch: str, account: str) -> str:
    bban = bank + branch + ccc.calc_check_digits(bank + branch + "00" + account) + account
    return _with_iban_check("ES", bban)


def _with_iban_check(country: str, bban: str) -> str:
    rearranged = bban + country + "00"
    number = int("".join(str(int(c, 36)) for c in rearranged))
    return f"{country}{98 - number % 97:02d}{bban}"


spanish_accounts = st.tuples(
    st.text(DIGITS, min_size=4, max_size=4),
    st.text(DIGITS, min_size=4, max_size=4),
    st.text(DIGITS, min_size=10, max_size=10),
)


@given(spanish_accounts)
def test_generated_spanish_ibans_are_valid_and_agree_with_stdnum(
    parts: tuple[str, str, str],
) -> None:
    candidate = _spanish_iban(*parts)

    assert is_valid_iban(candidate)
    assert iban.is_valid(candidate)


@given(spanish_accounts, st.text(DIGITS, min_size=2, max_size=2))
def test_spanish_iban_with_any_account_control_agrees_with_stdnum(
    parts: tuple[str, str, str], control: str
) -> None:
    bank, branch, account = parts
    candidate = _with_iban_check("ES", bank + branch + control + account)

    assert is_valid_iban(candidate) == iban.is_valid(candidate)


@given(spanish_accounts, st.integers(4, 23), st.sampled_from(DIGITS))
def test_changing_one_digit_of_a_valid_iban_invalidates_it(
    parts: tuple[str, str, str], position: int, digit: str
) -> None:
    candidate = _spanish_iban(*parts)
    mutated = candidate[:position] + digit + candidate[position + 1 :]
    if mutated != candidate:
        assert not is_valid_iban(mutated)


@pytest.mark.parametrize(
    ("candidate", "valid"),
    [
        ("281234567840", True),
        ("28/12345678/40", True),
        ("28 12345678 40", True),
        ("080123456774", True),  # number below 10 000 000
        ("460001234530", True),
        ("281234567841", False),
        ("001234567840", False),  # province 00
        ("2812345678", False),
        ("28123456784", False),
    ],
)
def test_us2_7_nss(candidate: str, valid: bool) -> None:
    assert is_valid_nss(candidate) is valid


@given(st.integers(1, 53), st.text(DIGITS, min_size=8, max_size=8), st.integers(0, 96))
def test_changing_the_nss_control_invalidates_it(province: int, number: str, other: int) -> None:
    head = f"{province:02d}{number}"
    base = int(number) + province * 10_000_000 if int(number) < 10_000_000 else int(head)
    control = base % 97
    assert is_valid_nss(f"{head}{control:02d}")
    if other != control:
        assert not is_valid_nss(f"{head}{other:02d}")


@pytest.mark.parametrize(
    ("candidate", "valid"),
    [
        ("612345678", True),
        ("612 345 678", True),
        ("612 34 56 78", True),
        ("+34 612 345 678", True),
        ("0034612345678", True),
        ("912345678", True),  # landline
        ("812345678", True),
        ("712345678", True),  # 71-74 are mobile ranges
        ("752345678", False),
        ("512345678", False),
        ("61234567", False),
        ("6123456789", False),
        ("+33612345678", False),
    ],
)
def test_us2_8_spanish_phone_structure(candidate: str, valid: bool) -> None:
    assert is_spanish_phone(candidate) is valid
