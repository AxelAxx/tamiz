"""Malformed requests: 400 naming the field, never echoing the value (spec 004 US5-4)."""

import pytest
from fastapi.testclient import TestClient

from privacy.api.app import create_app
from tests.support.fakes import FakeAnalyzer
from tests.support.logs import LogCapture

SECRET = "Lucía-12345678Z"  # noqa: S105 - synthetic personal data, not a credential


@pytest.mark.parametrize(
    ("body", "field"),
    [
        (f'{{"text": "{SECRET}"', "body"),  # not JSON
        ("{}", "text"),
        (f'{{"text": ["{SECRET}"]}}', "text"),
        (f'{{"text": "hola", "note": "{SECRET}"}}', "note"),
        (f'{{"text": "hola", "language": "{SECRET}"}}', "language"),
        ('{"text": "hola", "language": "en"}', "language"),
        ('{"text": "hola", "min_score": 2}', "min_score"),
        ('{"text": "hola", "entities": []}', "entities"),
        (f'{{"text": "hola", "entities": ["{SECRET}"]}}', "entities.0"),
    ],
)
def test_us5_4_malformed_requests_are_400_with_the_field_and_without_the_value(
    body: str, field: str, log_capture: LogCapture
) -> None:
    analyzer = FakeAnalyzer()
    client = TestClient(create_app(analyzer))

    response = client.post("/analyze", content=body, headers={"content-type": "application/json"})

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["type"] == "invalid_request"
    assert error["field"] == field
    assert SECRET not in response.text
    assert "Lucía" not in response.text
    log_capture.assert_absent(SECRET, "Lucía", "12345678Z")
    [line] = log_capture.requests()
    assert line["error_type"] == "invalid_request"
    assert analyzer.calls == []


def test_a_body_that_is_not_utf8_is_400_on_the_body(log_capture: LogCapture) -> None:
    client = TestClient(create_app(FakeAnalyzer()))

    response = client.post(
        "/analyze",
        content='{"text": "Soy Lucía"}'.encode("cp1252"),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["field"] == "body"
    assert "Soy" not in response.text
    log_capture.assert_absent("Soy")
