"""Shared fixtures: the app under test and a log capture that sees exactly what production logs."""

import io
import logging
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from privacy.api.app import create_app
from privacy.api.logging import service_handler
from tests.support.corpus import load_cases
from tests.support.fakes import FakeAnalyzer
from tests.support.logs import LogCapture


@pytest.fixture(scope="session", autouse=True)
def no_corpus_content_in_logs() -> Iterator[None]:
    """Spec 004 US5-1, SC-005: across the whole session, no corpus text or labelled value
    may appear in anything the service logs (formatted as in production)."""
    stream = io.StringIO()
    handler = service_handler(stream)
    root = logging.getLogger()
    root.addHandler(handler)
    previous_level = root.level
    root.setLevel(logging.DEBUG)  # worst case: everything that reaches the handler
    try:
        yield
    finally:
        root.removeHandler(handler)
        root.setLevel(previous_level)
    logged = stream.getvalue()
    for case in load_cases():
        assert case.text not in logged, f"corpus case {case.id} reached the logs"
        for span in case.spans:
            value = case.value(span)
            if len(value) >= 5:
                assert value not in logged, f"a {span.kind.value} value of {case.id} was logged"


@pytest.fixture
def log_capture() -> Iterator[LogCapture]:
    capture = LogCapture()
    handler = service_handler(capture.stream)
    root = logging.getLogger()
    previous_level = root.level
    root.addHandler(handler)
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
