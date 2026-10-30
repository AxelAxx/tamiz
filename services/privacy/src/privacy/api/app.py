"""FastAPI application factory. Adapters are injected; this module never builds them."""

from collections.abc import Callable
from importlib.metadata import version

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from privacy.api.errors import error_response, install_error_handlers
from privacy.api.logging import RequestLogMiddleware
from privacy.api.schemas import ErrorEnvelope, HealthResponse

SERVICE_VERSION = version("tamiz-privacy")


def create_app(readiness: Callable[[], bool]) -> FastAPI:
    app = FastAPI(
        title="Tamiz privacy service",
        version=SERVICE_VERSION,
        summary="Personal-data detection and reversible anonymization for Spanish text.",
    )
    install_error_handlers(app)
    app.add_middleware(RequestLogMiddleware)

    @app.get(
        "/health",
        response_model=HealthResponse,
        responses={503: {"model": ErrorEnvelope}},
    )
    async def health(request: Request) -> HealthResponse | JSONResponse:
        if not readiness():
            return error_response(request, 503, "not_ready", "Service is not ready")
        return HealthResponse(status="ok", ready=True, version=SERVICE_VERSION)

    return app
