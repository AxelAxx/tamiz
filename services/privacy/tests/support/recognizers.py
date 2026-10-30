"""Run one pattern recognizer alone, without loading a language model."""

from typing import cast

from presidio_analyzer import EntityRecognizer
from presidio_analyzer.nlp_engine import NlpArtifacts


def found(recognizer: EntityRecognizer, text: str) -> list[tuple[str, str, float]]:
    # Pattern recognizers never read NLP artifacts; no language model is loaded here.
    no_nlp = cast("NlpArtifacts", None)
    results = recognizer.analyze(text, recognizer.supported_entities, no_nlp)
    return [(r.entity_type, text[r.start : r.end], r.score) for r in results]
