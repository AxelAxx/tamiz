"""DNI, NIE and CIF recognizers (spec 004 FR-009, US2-1 … US2-5).

The patterns find candidates (case-insensitive, with the usual separators); the domain's
check-character functions decide. The look-arounds keep a candidate from starting or
ending inside a longer token, so `ABC12345678Z9` or `123456789Z` never match.
"""

from presidio_analyzer import Pattern

from privacy.domain.checksums import is_valid_cif, is_valid_dni, is_valid_nie
from privacy.infrastructure.recognizers.validated import ValidatedPatternRecognizer

_BEFORE = r"(?<![\w.\-/])"
_AFTER = r"(?![\w\-/]|\.\w)"
_SEP = r"[ .\-]?"

DNI_REGEX = _BEFORE + r"\d{2}\.?\d{3}\.?\d{3}" + _SEP + r"[A-Z]" + _AFTER
NIE_REGEX = _BEFORE + r"[XYZ]" + _SEP + r"\d{7}" + _SEP + r"[A-Z]" + _AFTER
CIF_REGEX = _BEFORE + r"[ABCDEFGHJNPQRSUVW]" + _SEP + r"\d{7}" + _SEP + r"[0-9A-J]" + _AFTER

# Candidates are validated, so the base score only matters for explanations.
_BASE_SCORE = 0.5


def dni_recognizer() -> ValidatedPatternRecognizer:
    return ValidatedPatternRecognizer(
        "DNI",
        [Pattern("dni", DNI_REGEX, _BASE_SCORE)],
        is_valid_dni,
        context=["dni", "nif", "documento", "identidad"],
    )


def nie_recognizer() -> ValidatedPatternRecognizer:
    return ValidatedPatternRecognizer(
        "NIE",
        [Pattern("nie", NIE_REGEX, _BASE_SCORE)],
        is_valid_nie,
        context=["nie", "extranjero", "residencia", "documento"],
    )


def cif_recognizer() -> ValidatedPatternRecognizer:
    return ValidatedPatternRecognizer(
        "CIF",
        [Pattern("cif", CIF_REGEX, _BASE_SCORE)],
        is_valid_cif,
        context=["cif", "nif", "empresa", "sociedad", "factura"],
    )
