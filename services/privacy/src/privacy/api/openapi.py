"""The committed contract (`services/privacy/openapi.json`) as the app renders it."""

import json
from typing import cast

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

type JsonObject = dict[str, object]

_FASTAPI_422_SCHEMAS = ("HTTPValidationError", "ValidationError")


def _without_422(document: JsonObject) -> JsonObject:
    """Validation errors are 400 `invalid_request` here (research R-10), never FastAPI's 422."""
    paths = cast("dict[str, dict[str, JsonObject]]", document.get("paths", {}))
    for operations in paths.values():
        for operation in operations.values():
            responses = cast("dict[str, object]", operation.get("responses", {}))
            responses.pop("422", None)
    components = cast("dict[str, dict[str, object]]", document.get("components", {}))
    for name in _FASTAPI_422_SCHEMAS:
        components.get("schemas", {}).pop(name, None)
    return document


def install_openapi(app: FastAPI) -> None:
    def openapi() -> dict[str, object]:
        if app.openapi_schema is None:
            app.openapi_schema = _without_422(
                get_openapi(
                    title=app.title,
                    version=app.version,
                    summary=app.summary,
                    routes=app.routes,
                    separate_input_output_schemas=False,
                )
            )
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]


def render_openapi(app: FastAPI) -> str:
    return json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"
