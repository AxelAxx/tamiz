"""Error envelope and handlers (research R-10). Messages never contain request content."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
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
    if exc.status_code == 413:
        return error_response(request, 413, "payload_too_large", "Body larger than 1 MiB")
    if exc.status_code >= 500:
        return error_response(request, exc.status_code, "internal_error", "Internal error")
    if exc.status_code == 400:  # FastAPI could not read the body (for example, not UTF-8)
        return error_response(request, 400, "invalid_request", "Body could not be read", "body")
    return error_response(request, exc.status_code, "invalid_request", "Invalid request")


async def _validation(request: Request, exc: Exception) -> JSONResponse:
    """400 naming the first problem's field; never FastAPI's 422, which echoes the input."""
    if not isinstance(exc, RequestValidationError):
        return await _unexpected(request, exc)
    errors = exc.errors()
    first = errors[0] if errors else {}
    location = [str(part) for part in first.get("loc", ())]
    if location[:1] == ["body"]:
        location = location[1:]
    is_json_error = first.get("type") == "json_invalid"
    field = "body" if is_json_error or not location else ".".join(location)
    message = "Body is not valid JSON" if is_json_error else str(first.get("msg", "Invalid"))
    return error_response(request, 400, "invalid_request", message, field)


async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
    logger.error("unhandled exception", exc_info=exc)
    return error_response(request, 500, "internal_error", "Internal error")


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _validation)
    app.add_exception_handler(HTTPException, _http_exception)
    app.add_exception_handler(Exception, _unexpected)
