"""GET /health (spec 004 FR-001, US5-5; research R-11)."""

from collections.abc import Callable
from importlib.metadata import version

from fastapi.testclient import TestClient


def test_us5_5_health_is_200_when_ready(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "ready": True,
        "version": version("tamiz-privacy"),
    }


def test_us5_5_health_is_503_not_ready_until_the_model_is_loaded(
    make_client: Callable[..., TestClient],
) -> None:
    response = make_client(ready=False).get("/health")

    assert response.status_code == 503
    assert response.json() == {
        "error": {"type": "not_ready", "message": "Service is not ready", "field": None}
    }
