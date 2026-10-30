"""Social security number (NSS) recognizer (spec 004 FR-011, US2-7).

`PP NNNNNNNN CC`, compact or separated by `/`, space or dash; the domain checks province and
control digits.
"""

from presidio_analyzer import Pattern

from privacy.domain.checksums import is_valid_nss
from privacy.infrastructure.recognizers.validated import ValidatedPatternRecognizer

NSS_REGEX = r"(?<![\w/.\-+])\d{2}[ /\-]?\d{8}[ /\-]?\d{2}(?![\w/\-]|[.,]\d)"


def nss_recognizer() -> ValidatedPatternRecognizer:
    return ValidatedPatternRecognizer(
        "NSS",
        [Pattern("nss", NSS_REGEX, 0.5)],
        is_valid_nss,
        context=["seguridad social", "nss", "afiliación", "naf"],
    )
