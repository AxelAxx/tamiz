"""IBAN recognizer (spec 004 FR-010, US2-6).

Candidates are the country code, check digits and groups of four (spaced or compact).
After the first group (which may hold a bank code in letters, as in GB or NL) only digit
groups follow, so a word right after the IBAN is never swallowed into the candidate. IBANs
with letters later in the BBAN (some FR, IT accounts) are therefore not found: an accepted
miss, measured by the corpus.
"""

from presidio_analyzer import Pattern

from privacy.domain.checksums import is_valid_iban
from privacy.infrastructure.recognizers.validated import ValidatedPatternRecognizer

IBAN_REGEX = r"(?<!\w)[A-Z]{2}\d{2} ?[A-Z0-9]{4}(?: ?\d{4}){1,6}(?: ?\d{1,3})?(?!\w)"


def iban_recognizer() -> ValidatedPatternRecognizer:
    return ValidatedPatternRecognizer(
        "IBAN",
        [Pattern("iban", IBAN_REGEX, 0.5)],
        is_valid_iban,
        context=["iban", "cuenta", "transferencia", "domiciliación", "banco"],
    )
