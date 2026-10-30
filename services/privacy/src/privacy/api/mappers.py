"""Between the HTTP contract and the use cases."""

from privacy.api.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    AnonymizeResponse,
    FindingOut,
    PlaceholderOut,
)
from privacy.application.analyze_text import ALL_KINDS, AnalysisResult, AnalyzeCommand
from privacy.application.anonymize_text import AnonymizationResult


def to_command(body: AnalyzeRequest, default_min_score: float) -> AnalyzeCommand:
    return AnalyzeCommand(
        text=body.text,
        min_score=default_min_score if body.min_score is None else body.min_score,
        kinds=ALL_KINDS if body.entities is None else frozenset(body.entities),
    )


def to_analyze_response(result: AnalysisResult) -> AnalyzeResponse:
    return AnalyzeResponse(
        findings=[
            FindingOut(kind=f.kind, start=f.start, end=f.end, score=round(f.score, 4))
            for f in result.findings
        ],
        counts=dict(result.counts),
        sensitivity_level=result.level,
    )


def to_anonymize_response(result: AnonymizationResult) -> AnonymizeResponse:
    return AnonymizeResponse(
        text=result.text,
        mapping=[
            PlaceholderOut(placeholder=e.placeholder, kind=e.kind, value=e.value)
            for e in result.mapping
        ],
        analysis=to_analyze_response(result.analysis),
    )


def log_fields(text: str, result: AnalysisResult) -> dict[str, object]:
    """Metadata for the request log line (research R-09): sizes, counts, level; no content."""
    return {
        "text_length": len(text),
        "counts": {kind.value: n for kind, n in result.counts.items()},
        "level": result.level.value,
    }
