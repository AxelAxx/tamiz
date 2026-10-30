"""One allow-listed JSON line per request (spec 004 FR-021, US5-1; research R-09)."""

import logging
import re

from fastapi import Request
from fastapi.testclient import TestClient

from privacy.api.logging import ALLOWED_FIELDS, BASE_FIELDS
from tests.support.logs import LogCapture


def test_us5_1_one_request_line_with_allow_listed_fields_only(
    client: TestClient, log_capture: LogCapture
) -> None:
    client.get("/health", headers={"x-request-id": "req-123"})

    [line] = log_capture.requests()
    assert set(line) <= BASE_FIELDS | ALLOWED_FIELDS
    assert line["request_id"] == "req-123"
    assert line["endpoint"] == "/health"
    assert line["status"] == 200
    assert isinstance(line["duration_ms"], float)


def test_us5_1_request_id_is_echoed_or_generated(client: TestClient) -> None:
    echoed = client.get("/health", headers={"x-request-id": "abc-1"})
    generated = client.get("/health")
    unsafe = client.get("/health", headers={"x-request-id": "Maria Garcia 12345678Z"})

    assert echoed.headers["x-request-id"] == "abc-1"
    assert re.fullmatch(r"[0-9a-f]{32}", generated.headers["x-request-id"])
    assert re.fullmatch(r"[0-9a-f]{32}", unsafe.headers["x-request-id"])


def test_us5_1_unexpected_extra_fields_are_dropped(log_capture: LogCapture) -> None:
    logging.getLogger("privacy.test").info("request", extra={"text": "Lucía", "status": 200})

    [line] = log_capture.lines()
    assert "text" not in line
    assert line["status"] == 200
    log_capture.assert_absent("Lucía")


def test_us5_1_unexpected_errors_log_type_and_frames_but_never_the_message(
    client: TestClient, log_capture: LogCapture
) -> None:
    async def boom(request: Request) -> None:
        raise ValueError("Lucía García, DNI 12345678Z")

    client.app.router.add_api_route("/boom", boom)  # type: ignore[attr-defined]

    response = client.get("/boom")

    assert response.status_code == 500
    assert response.json() == {
        "error": {"type": "internal_error", "message": "Internal error", "field": None}
    }
    assert any(line.get("exc_type") == "ValueError" for line in log_capture.lines())
    [request_line] = log_capture.requests()
    assert request_line["status"] == 500
    assert request_line["error_type"] == "internal_error"
    log_capture.assert_absent("Lucía", "12345678Z")


def test_unknown_path_is_a_typed_404(client: TestClient, log_capture: LogCapture) -> None:
    response = client.get("/patients/12345678Z")

    assert response.status_code == 404
    assert response.json()["error"]["type"] == "not_found"
    [line] = log_capture.requests()
    assert line["error_type"] == "not_found"
    assert line["endpoint"] == "unmatched"
    log_capture.assert_absent("12345678Z")


def test_third_party_debug_and_info_never_reach_the_handler(log_capture: LogCapture) -> None:
    library = logging.getLogger("presidio-analyzer")
    previous = library.level
    library.setLevel(logging.DEBUG)
    try:
        library.debug("Context list is: lucia@example.com teléfono")
        library.info("Found context keyword 'teléfono'")
        library.warning("Regex pattern timed out, skipping.")
    finally:
        library.setLevel(previous)

    assert [line["msg"] for line in log_capture.lines()] == ["Regex pattern timed out, skipping."]
    log_capture.assert_absent("lucia@example.com")
