"""Check characters of Spanish identifiers (spec 004 FR-009 … FR-013; research R-13).

These are the business rules of "what is a DNI": a candidate with a wrong control
character is not one. Every function is total: malformed input is `False`, never an error.
"""

import re

_SEPARATORS = re.compile(r"[\s.\-/]")
_DNI = re.compile(r"\d{8}[A-Z]")
_NIE = re.compile(r"[XYZ]\d{7}[A-Z]")
_CIF = re.compile(r"[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]")

DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"
_NIE_PREFIX = {"X": "0", "Y": "1", "Z": "2"}

CIF_LETTER_CONTROL = frozenset("PQRSNW")  # public bodies, foreign entities: letter
CIF_DIGIT_CONTROL = frozenset("ABEH")  # companies: digit
_CIF_CONTROL_LETTERS = "JABCDEFGHI"


def compact(candidate: str) -> str:
    """Upper-case, without spaces, dots, dashes or slashes."""
    return _SEPARATORS.sub("", candidate).upper()


def _dni_letter(number: str) -> str:
    return DNI_LETTERS[int(number) % 23]


def is_valid_dni(candidate: str) -> bool:
    value = compact(candidate)
    return _DNI.fullmatch(value) is not None and _dni_letter(value[:8]) == value[8]


def is_valid_nie(candidate: str) -> bool:
    value = compact(candidate)
    if _NIE.fullmatch(value) is None:
        return False
    return _dni_letter(_NIE_PREFIX[value[0]] + value[1:8]) == value[8]


def _cif_control_digit(digits: str) -> int:
    even = sum(int(d) for d in digits[1::2])
    odd = sum(sum(divmod(2 * int(d), 10)) for d in digits[0::2])
    return (10 - (even + odd) % 10) % 10


def is_valid_cif(candidate: str) -> bool:
    value = compact(candidate)
    if _CIF.fullmatch(value) is None:
        return False
    organisation, digits, control = value[0], value[1:8], value[8]
    expected = _cif_control_digit(digits)
    as_digit = control == str(expected)
    as_letter = control == _CIF_CONTROL_LETTERS[expected]
    if organisation in CIF_DIGIT_CONTROL:
        return as_digit
    if organisation in CIF_LETTER_CONTROL:
        return as_letter
    return as_digit or as_letter


# IBAN lengths of the SEPA countries (ISO 13616 registry). Other countries are not reported.
IBAN_LENGTHS = {
    "AD": 24, "AT": 20, "BE": 16, "BG": 22, "CH": 21, "CY": 28, "CZ": 24, "DE": 22,
    "DK": 18, "EE": 20, "ES": 24, "FI": 18, "FR": 27, "GB": 22, "GI": 23, "GR": 27,
    "HR": 21, "HU": 28, "IE": 22, "IS": 26, "IT": 27, "LI": 21, "LT": 20, "LU": 20,
    "LV": 21, "MC": 27, "MT": 31, "NL": 18, "NO": 15, "PL": 28, "PT": 25, "RO": 24,
    "SE": 24, "SI": 19, "SK": 24, "SM": 27,
}  # fmt: skip
_IBAN = re.compile(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}")
_ACCOUNT_WEIGHTS = (1, 2, 4, 8, 5, 10, 9, 7, 3, 6)


def _account_control(ten_digits: str) -> str:
    value = 11 - sum(int(d) * w for d, w in zip(ten_digits, _ACCOUNT_WEIGHTS, strict=True)) % 11
    return {11: "0", 10: "1"}.get(value, str(value))


def _spanish_account_is_valid(bban: str) -> bool:
    """`BBBB GGGG DD NNNNNNNNNN`: the two control digits of the old Spanish CCC."""
    bank_branch, controls, account = bban[:8], bban[8:10], bban[10:]
    return controls == _account_control("00" + bank_branch) + _account_control(account)


def is_valid_iban(candidate: str) -> bool:
    value = compact(candidate)
    if _IBAN.fullmatch(value) is None or IBAN_LENGTHS.get(value[:2]) != len(value):
        return False
    rearranged = value[4:] + value[:4]
    if int("".join(str(int(char, 36)) for char in rearranged)) % 97 != 1:
        return False
    bban = value[4:]
    return not value.startswith("ES") or (bban.isdigit() and _spanish_account_is_valid(bban))


_NSS = re.compile(r"\d{12}")
_NSS_PROVINCES = frozenset([*range(1, 54), 66])


def is_valid_nss(candidate: str) -> bool:
    """`PP NNNNNNNN CC`: province, number, and `CC = base mod 97` (TGSS rule)."""
    value = compact(candidate)
    if _NSS.fullmatch(value) is None or int(value[:2]) not in _NSS_PROVINCES:
        return False
    province, number, control = int(value[:2]), int(value[2:10]), int(value[10:])
    base = number + province * 10_000_000 if number < 10_000_000 else int(value[:10])
    return base % 97 == control


_SPANISH_PHONE = re.compile(r"(?:\+34|0034)?(?:[689]\d{8}|7[1-4]\d{7})")


def is_spanish_phone(candidate: str) -> bool:
    """Structure only (no checksum exists): nine digits starting 6, 71-74, 8 or 9."""
    return _SPANISH_PHONE.fullmatch(compact(candidate)) is not None
