"""POST /analyze with a fake analyzer (spec 004 US1-3, US1-6, FR-004, FR-023)."""

import json
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

from privacy.api.app import create_app
from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding
from tests.support.fakes import FakeAnalyzer, spans
from tests.support.logs import LogCapture

K = EntityKind
TEXT = "La paciente Lucía Fernández Ruiz, con DNI 12345678Z, vive en Valencia."


def by_text(text: str) -> list[Finding]:
    if "Lucía" not in text:
        return []
    return spans(
        text,
        (K.PERSON, "Lucía Fernández Ruiz", 0.85),
        (K.DNI, "12345678Z", 1.0),
        (K.LOCATION, "Valencia", 0.85),
    )


def make(analyzer: FakeAnalyzer | None = None, min_score: float = 0.5) -> TestClient:
    return TestClient(create_app(analyzer or FakeAnalyzer(by_text), default_min_score=min_score))


def test_response_shape_offsets_counts_and_level() -> None:
    response = make().post("/analyze", json={"text": TEXT})

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "findings": [
            {"kind": "PERSON", "start": 12, "end": 32, "score": 0.85},
            {"kind": "DNI", "start": 42, "end": 51, "score": 1.0},
            {"kind": "LOCATION", "start": 61, "end": 69, "score": 0.85},
        ],
        "counts": {"PERSON": 1, "DNI": 1, "LOCATION": 1},
        "sensitivity_level": "critical",
    }
    assert TEXT[12:32] == "Lucía Fernández Ruiz"


def test_us1_6_the_response_contains_no_substring_of_the_input() -> None:
    raw = make().post("/analyze", json={"text": TEXT}).text
    words = {w.strip(",.") for w in TEXT.split()}
    sensitive = [w for w in words if len(w) >= 3 and w.lower() not in {"con", "dni"}]

    assert all(word not in raw for word in sensitive)


def test_us1_3_text_without_personal_data_is_none() -> None:
    response = make().post("/analyze", json={"text": "¿Qué tiempo hará mañana?"})

    assert response.json() == {"findings": [], "counts": {}, "sensitivity_level": "none"}


def test_empty_text_is_valid() -> None:
    response = make().post("/analyze", json={"text": ""})

    assert response.status_code == 200
    assert response.json()["sensitivity_level"] == "none"


def test_entities_and_min_score_reach_the_use_case() -> None:
    analyzer = FakeAnalyzer(by_text)

    response = make(analyzer).post(
        "/analyze", json={"text": TEXT, "entities": ["LOCATION", "PERSON"], "min_score": 0.9}
    )

    assert response.json()["findings"] == []
    assert analyzer.calls == [(TEXT, frozenset({K.LOCATION, K.PERSON}))]


def test_the_service_default_min_score_applies_when_the_request_omits_it() -> None:
    response = make(min_score=0.9).post("/analyze", json={"text": TEXT})

    assert response.json()["counts"] == {"DNI": 1}


def test_not_ready_is_503_and_the_analyzer_is_not_called() -> None:
    analyzer = FakeAnalyzer(by_text, ready=False)

    response = make(analyzer).post("/analyze", json={"text": TEXT})

    assert response.status_code == 503
    assert response.json()["error"]["type"] == "not_ready"
    assert analyzer.calls == []


def test_log_line_has_metadata_only(log_capture: LogCapture) -> None:
    make().post("/analyze", json={"text": TEXT})

    [line] = log_capture.requests()
    assert line["endpoint"] == "/analyze"
    assert line["text_length"] == len(TEXT)
    assert line["counts"] == {"PERSON": 1, "DNI": 1, "LOCATION": 1}
    assert line["level"] == "critical"
    log_capture.assert_absent("Lucía", "Fernández", "12345678Z", "Valencia")


def test_concurrent_requests_get_their_own_results() -> None:
    client = make(FakeAnalyzer(lambda text: spans(text, (K.EMAIL, text.split()[-1], 1.0))))
    texts = [f"escribe a user{i}@example.com" for i in range(20)]

    def call(text: str) -> tuple[str, object]:
        return text, client.post("/analyze", json={"text": text}).json()

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(call, texts))

    for text, body in results:
        [found] = json.loads(json.dumps(body))["findings"]
        assert text[found["start"] : found["end"]] == text.split()[-1]
