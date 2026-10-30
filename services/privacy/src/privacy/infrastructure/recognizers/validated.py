"""A Presidio pattern recognizer whose validation is a domain function (research R-12).

Presidio's extension point is overriding `validate_result`: `True` raises the candidate's
score to 1.0, `None` keeps the pattern's score, `False` drops it. The validator is passed in,
so the rule stays in the domain. With `confirms=False` (phones: a structure check, not a
checksum) a passing candidate keeps its pattern score, which context words can then raise.
"""

from collections.abc import Callable, Sequence

from presidio_analyzer import Pattern, PatternRecognizer

LANGUAGE = "es"


class ValidatedPatternRecognizer(PatternRecognizer):
    def __init__(
        self,
        entity: str,
        patterns: Sequence[Pattern],
        validator: Callable[[str], bool],
        context: Sequence[str] = (),
        *,
        confirms: bool = True,
    ) -> None:
        super().__init__(
            supported_entity=entity,
            name=f"Tamiz{entity.title().replace('_', '')}Recognizer",
            supported_language=LANGUAGE,
            patterns=list(patterns),
            context=list(context),
        )
        self._validator = validator
        self._confirms = confirms

    def validate_result(self, pattern_text: str) -> bool | None:
        if not self._validator(pattern_text):
            return False
        return True if self._confirms else None
