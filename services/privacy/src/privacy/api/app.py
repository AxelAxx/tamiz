"""FastAPI application factory. Adapters are injected; this module never builds them."""

from importlib.metadata import version
from typing import Final

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from privacy.api.errors import error_response, install_error_handlers
from privacy.api.limits import BodyLimitMiddleware
from privacy.api.logging import RequestLogMiddleware
from privacy.api.mappers import log_fields, to_analyze_response, to_command
from privacy.api.openapi import install_openapi
from privacy.api.schemas import AnalyzeRequest, AnalyzeResponse, ErrorEnvelope, HealthResponse
from privacy.application.analyze_text import DEFAULT_MIN_SCORE, analyze_text
from privacy.application.ports import PiiAnalyzerPort

SERVICE_VERSION: Final = version("tamiz-privacy")

_INVALID: Final = {"model": ErrorEnvelope, "description": "Invalid request"}
_TOO_LARGE: Final = {"model": ErrorEnvelope, "description": "Body larger than 1 MiB"}
_NOT_READY: Final = {"model": ErrorEnvelope, "description": "Not ready"}


def create_app(analyzer: PiiAnalyzerPort, default_min_score: float = DEFAULT_MIN_SCORE) -> FastAPI:
    app = FastAPI(
        title="Tamiz privacy service",
        version=SERVICE_VERSION,
        summary="Personal-data detection and reversible anonymization for Spanish text.",
    )
    install_openapi(app)
    install_error_handlers(app)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(RequestLogMiddleware)

    def not_ready(request: Request) -> JSONResponse:
        return error_response(request, 503, "not_ready", "Service is not ready")

    @app.get("/health", response_model=HealthResponse, responses={503: _NOT_READY})
    async def health(request: Request) -> HealthResponse | JSONResponse:
        if not analyzer.is_ready():
            return not_ready(request)
        return HealthResponse(status="ok", ready=True, version=SERVICE_VERSION)

    @app.post(
        "/analyze",
        response_model=AnalyzeResponse,
        responses={400: _INVALID, 413: _TOO_LARGE, 503: _NOT_READY},
    )
    async def analyze(request: Request, body: AnalyzeRequest) -> AnalyzeResponse | JSONResponse:
        """Personal data found in `text` (kinds, offsets, scores; never values) and its level."""
        if not analyzer.is_ready():
            return not_ready(request)
        command = to_command(body, default_min_score)
        result = await run_in_threadpool(analyze_text, analyzer, command)
        request.state.log_fields.update(log_fields(body.text, result))
        return to_analyze_response(result)

    return app
