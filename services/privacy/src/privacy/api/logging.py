"""JSON logging with an allow-list of fields, and one line per request (research R-09).

Nothing outside `BASE_FIELDS | ALLOWED_FIELDS` is ever written, whatever a caller passes in
`extra`. Exception messages and source lines are never written either: they can carry request
content. A stack is file, line and function names only.
"""

import json
import logging
import re
import time
import traceback
import uuid
from datetime import UTC, datetime

from starlette.types import ASGIApp, Message, Receive, Scope, Send

BASE_FIELDS = frozenset({"ts", "severity", "logger", "msg", "exc_type", "stack"})
ALLOWED_FIELDS = frozenset(
    {
        "request_id",
        "endpoint",
        "status",
        "duration_ms",
        "text_length",
        "counts",
        "level",
        "error_type",
    }
)

REQUEST_ID_HEADER = "x-request-id"
_SAFE_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")

logger = logging.getLogger("privacy.request")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "severity": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for name in ALLOWED_FIELDS:
            if name in record.__dict__:
                line[name] = record.__dict__[name]
        if record.exc_info and record.exc_info[0] is not None:
            exc_type, _, tb = record.exc_info
            line["exc_type"] = exc_type.__name__
            line["stack"] = [
                f"{frame.filename}:{frame.lineno} in {frame.name}"
                for frame in traceback.extract_tb(tb)
            ]
        return json.dumps(line, ensure_ascii=False, default=str)


def configure_logging(level: str) -> None:
    """Route every logger (Uvicorn's included) through the JSON formatter on stdout."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).handlers.clear()
        logging.getLogger(name).propagate = True


def _request_id(scope: Scope) -> str:
    headers: list[tuple[bytes, bytes]] = scope.get("headers", [])
    for name, value in headers:
        if name == REQUEST_ID_HEADER.encode():
            candidate = value.decode("latin-1")
            if _SAFE_REQUEST_ID.fullmatch(candidate):
                return candidate
    return uuid.uuid4().hex


def _endpoint(scope: Scope) -> str:
    """The matched route template, never the raw path: a path can carry personal data."""
    path: object = getattr(scope.get("route"), "path", None)
    return path if isinstance(path, str) else "unmatched"


class RequestLogMiddleware:
    """Echo or create the request id and write one allow-listed line per request.

    Routes and error handlers add fields through `request.state.log_fields`.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _request_id(scope)
        fields: dict[str, object] = {}
        scope.setdefault("state", {})["log_fields"] = fields
        status = 500
        started = time.perf_counter()

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER.encode(), request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            status = 500
            fields.setdefault("error_type", "internal_error")
            raise
        finally:
            logger.info(
                "request",
                extra={
                    **fields,
                    "request_id": request_id,
                    "endpoint": _endpoint(scope),
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                },
            )
