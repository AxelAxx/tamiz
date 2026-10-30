"""The real engine (Presidio + `es_core_news_lg`), loaded once per test session."""

import pytest
from fastapi.testclient import TestClient

from privacy.api.app import create_app
from privacy.infrastructure.presidio_analyzer import PresidioAnalyzer, build_engine


@pytest.fixture(scope="session")
def analyzer() -> PresidioAnalyzer:
    return PresidioAnalyzer(build_engine("es_core_news_lg"))


@pytest.fixture(scope="session")
def nlp_client(analyzer: PresidioAnalyzer) -> TestClient:
    return TestClient(create_app(analyzer))
