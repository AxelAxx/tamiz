"""Presidio adapter for `PiiAnalyzerPort` (research R-02).

One explicit registry instead of Presidio's predefined set: spaCy names and places, email
and card (Luhn) recognizers, plus our Spanish recognizers (T-004-04, T-004-05). Every result
is mapped to `EntityKind`; anything else Presidio returns is dropped, so the closed list of
FR-005 holds whatever the library does.
"""

import threading
from collections.abc import Mapping, Sequence
from types import MappingProxyType

from presidio_analyzer import AnalyzerEngine, EntityRecognizer, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_analyzer.predefined_recognizers import (
    CreditCardRecognizer,
    EmailRecognizer,
    SpacyRecognizer,
)

from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding, finding

LANGUAGE = "es"

PRESIDIO_TO_KIND: Mapping[str, EntityKind] = MappingProxyType(
    {
        "EMAIL_ADDRESS": EntityKind.EMAIL,
        "CREDIT_CARD": EntityKind.CREDIT_CARD,
        "PERSON": EntityKind.PERSON,
        "LOCATION": EntityKind.LOCATION,
        # Our own recognizers use the kind's name as their entity name.
        **{
            kind.value: kind
            for kind in EntityKind
            if kind not in {EntityKind.EMAIL, EntityKind.CREDIT_CARD}
        },
    }
)
KIND_TO_PRESIDIO: Mapping[EntityKind, str] = MappingProxyType(
    {kind: name for name, kind in PRESIDIO_TO_KIND.items()}
)


def default_recognizers() -> list[EntityRecognizer]:
    return [
        # spaCy `PER` → PERSON and `LOC`/`GPE` → LOCATION; ORG and MISC are not reported.
        SpacyRecognizer(supported_language=LANGUAGE, supported_entities=["PERSON", "LOCATION"]),
        EmailRecognizer(supported_language=LANGUAGE),
        CreditCardRecognizer(supported_language=LANGUAGE),
    ]


def build_engine(
    spacy_model: str, recognizers: Sequence[EntityRecognizer] | None = None
) -> AnalyzerEngine:
    """Load the Spanish model and register exactly `recognizers` (default: the set above)."""
    nlp_engine = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": LANGUAGE, "model_name": spacy_model}],
        }
    ).create_engine()
    registry = RecognizerRegistry(supported_languages=[LANGUAGE])
    for recognizer in recognizers if recognizers is not None else default_recognizers():
        registry.add_recognizer(recognizer)
    return AnalyzerEngine(nlp_engine=nlp_engine, registry=registry, supported_languages=[LANGUAGE])


class PresidioAnalyzer:
    """`PiiAnalyzerPort` over an `AnalyzerEngine`.

    Calls are serialised: spaCy pipelines are not guaranteed to be thread-safe, and the API
    runs each analysis in a worker thread so the event loop stays free.
    """

    def __init__(self, engine: AnalyzerEngine) -> None:
        self._engine = engine
        self._lock = threading.Lock()
        self._supported = frozenset(engine.get_supported_entities(language=LANGUAGE))

    def analyze(self, text: str, kinds: frozenset[EntityKind]) -> Sequence[Finding]:
        entities = sorted(
            name for kind in kinds if (name := KIND_TO_PRESIDIO[kind]) in self._supported
        )
        if not entities:
            return ()
        with self._lock:
            results = self._engine.analyze(text=text, language=LANGUAGE, entities=entities)
        found: list[Finding] = []
        for result in results:
            kind = PRESIDIO_TO_KIND.get(result.entity_type)
            if kind is None:
                continue
            mapped = finding(kind, result.start, result.end, float(result.score))
            if mapped is not None:
                found.append(mapped)
        return found

    def is_ready(self) -> bool:
        return True
