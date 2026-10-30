"""Spanish phone recognizer (spec 004 FR-012, US2-8; research R-12).

Phone numbers have no checksum, so a structurally valid candidate keeps a base score of 0.6
(above the default minimum 0.5); Presidio's context enhancer raises it when a phone word is
nearby. Groupings 3-3-3 and 3-2-2-2, with an optional `+34` or `0034`. A number preceded by
another country code (`+33 612 345 678`) is not Spanish and is not reported.
"""

from presidio_analyzer import Pattern

from privacy.domain.checksums import is_spanish_phone
from privacy.infrastructure.recognizers.validated import ValidatedPatternRecognizer

PHONE_BASE_SCORE = 0.6

_SEP = r"[ .\-]?"
PHONE_REGEX = (
    r"(?<![\w+/.\-])(?<!\+\d{1,3}[ .\-]?)"
    r"(?:(?:\+|00)34" + _SEP + r")?"
    r"[6789]\d{2}(?:(?:" + _SEP + r"\d{3}){2}|(?:" + _SEP + r"\d{2}){3})"
    r"(?![\w\-]|[.,/]\d)"
)


def phone_recognizer() -> ValidatedPatternRecognizer:
    return ValidatedPatternRecognizer(
        "PHONE",
        [Pattern("phone_es", PHONE_REGEX, PHONE_BASE_SCORE)],
        is_spanish_phone,
        context=["teléfono", "telefono", "tel", "tlf", "móvil", "movil", "llamar", "whatsapp"],
        confirms=False,
    )
