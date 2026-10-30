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
