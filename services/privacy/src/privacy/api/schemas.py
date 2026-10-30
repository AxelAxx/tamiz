"""Pydantic contract of the HTTP API (spec 004 FR-022; data-model §4).

`openapi.json` is exported from these models; the gateway mirrors it in Zod (T-005-03).
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from privacy.domain.entity_kind import EntityKind
from privacy.domain.sensitivity import SensitivityLevel

type ErrorType = Literal[
    "invalid_request", "not_found", "payload_too_large", "not_ready", "internal_error"
]


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(description="Text to analyze. May be empty.")
    language: Literal["es"] = Field(default="es", description="Only Spanish in this version.")
    min_score: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Findings below are dropped. Default: the service's "
        "PRIVACY_DEFAULT_MIN_SCORE (0.5).",
    )
    entities: list[EntityKind] | None = Field(
        default=None, min_length=1, description="Kinds to report. Default: all."
    )


class FindingOut(BaseModel):
    kind: EntityKind
    start: int = Field(ge=0, description="Inclusive offset (Unicode code points).")
    end: int = Field(gt=0, description="Exclusive offset (Unicode code points).")
    score: float = Field(ge=0.0, le=1.0)


class AnalyzeResponse(BaseModel):
    findings: list[FindingOut] = Field(description="Sorted by start, non-overlapping.")
    counts: dict[EntityKind, int] = Field(description="Only kinds with at least one finding.")
    sensitivity_level: SensitivityLevel


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"]
    ready: bool
    version: str


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: ErrorType
    message: str
    field: str | None = None


class ErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorBody
