"""1 MiB body limit (spec 004 FR-020, US5-3)."""

import json
from collections.abc import Iterator

from fastapi.testclient import TestClient

from privacy.api.app import create_app
from privacy.api.limits import MAX_BODY_BYTES
from tests.support.fakes import FakeAnalyzer


def body_of_size(size: int) -> bytes:
    """A valid JSON request of exactly `size` bytes."""
    skeleton = json.dumps({"text": ""}).encode()
    return json.dumps({"text": "a" * (size - len(skeleton))}).encode()


def test_us5_3_a_body_over_1_mib_is_413_and_never_analyzed() -> None:
    analyzer = FakeAnalyzer()
    client = TestClient(create_app(analyzer))

    response = client.post(
        "/analyze",
        content=body_of_size(MAX_BODY_BYTES + 1),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 413
    assert response.json()["error"] == {
        "type": "payload_too_large",
        "message": "Body larger than 1 MiB",
        "field": None,
    }
    assert analyzer.calls == []


def test_us5_3_a_chunked_body_over_1_mib_is_413() -> None:
    analyzer = FakeAnalyzer()
    client = TestClient(create_app(analyzer))
    payload = body_of_size(MAX_BODY_BYTES + 1)

    def chunks() -> Iterator[bytes]:
        for i in range(0, len(payload), 65_536):
            yield payload[i : i + 65_536]

    response = client.post(
        "/analyze", content=chunks(), headers={"content-type": "application/json"}
    )

    assert response.status_code == 413
    assert analyzer.calls == []


def test_exactly_1_mib_is_accepted() -> None:
    analyzer = FakeAnalyzer()
    client = TestClient(create_app(analyzer))
    payload = body_of_size(MAX_BODY_BYTES)
    assert len(payload) == MAX_BODY_BYTES

    response = client.post(
        "/analyze", content=payload, headers={"content-type": "application/json"}
    )

    assert response.status_code == 200
    assert len(analyzer.calls) == 1
