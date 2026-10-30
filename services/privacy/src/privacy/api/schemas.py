"""Pydantic contract of the HTTP API (spec 004 FR-022). `openapi.json` is exported from it."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

type ErrorType = Literal[
    "invalid_request", "not_found", "payload_too_large", "not_ready", "internal_error"
]


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
