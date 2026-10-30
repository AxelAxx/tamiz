"""Error envelope and handlers (research R-10). Messages never contain request content."""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from privacy.api.schemas import ErrorBody, ErrorEnvelope, ErrorType

logger = logging.getLogger("privacy.errors")


def error_response(
    request: Request, status: int, type_: ErrorType, message: str, field: str | None = None
) -> JSONResponse:
    request.state.log_fields["error_type"] = type_
    envelope = ErrorEnvelope(error=ErrorBody(type=type_, message=message, field=field))
    return JSONResponse(status_code=status, content=envelope.model_dump())


async def _http_exception(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, HTTPException):
        return await _unexpected(request, exc)
    if exc.status_code == 404:
        return error_response(request, 404, "not_found", "Not found")
    if exc.status_code >= 500:
        return error_response(request, exc.status_code, "internal_error", "Internal error")
    return error_response(request, exc.status_code, "invalid_request", "Invalid request")


async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
    logger.error("unhandled exception", exc_info=exc)
    return error_response(request, 500, "internal_error", "Internal error")


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, _http_exception)
    app.add_exception_handler(Exception, _unexpected)
