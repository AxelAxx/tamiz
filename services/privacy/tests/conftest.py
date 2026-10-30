"""Shared fixtures: the app under test and a log capture that sees exactly what production logs."""

import logging
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from privacy.api.app import create_app
from privacy.api.logging import JsonFormatter
from tests.support.fakes import FakeAnalyzer
from tests.support.logs import LogCapture


@pytest.fixture
def log_capture() -> Iterator[LogCapture]:
    capture = LogCapture()
    handler = logging.StreamHandler(capture.stream)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    previous_level = root.level
    root.addHandler(handler)
    # The test client's own request lines (httpx) are not service output.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    root.setLevel(logging.INFO)
    try:
        yield capture
    finally:
        root.removeHandler(handler)
        root.setLevel(previous_level)


@pytest.fixture
def make_client() -> Callable[..., TestClient]:
    def make(*, ready: bool = True) -> TestClient:
        app = create_app(FakeAnalyzer(ready=ready))
        return TestClient(app, raise_server_exceptions=False)

    return make


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()
