"""POST /anonymize with a fake analyzer (spec 004 US3-1, US3-3, US3-7, FR-014, FR-016)."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from privacy.api.app import create_app
from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding
from tests.support.fakes import FakeAnalyzer, spans
from tests.support.logs import LogCapture
from tests.support.restore import restore

K = EntityKind
EXAMPLE = json.loads(
    (
        Path(__file__).resolve().parents[4]
        / "specs/004-privacy-service/contracts/anonymize.example.json"
    ).read_text(encoding="utf-8")
)


def example_findings(text: str) -> list[Finding]:
    """The findings of the contract example, as the real engine would report them."""
    found = spans(
        text,
        (K.PERSON, "Lucía Fernández Ruiz", 0.85),
        (K.DNI, "12345678Z", 1.0),
        (K.LOCATION, "Valencia", 0.85),
        (K.PHONE, "612 345 678", 0.95),
        (K.EMAIL, "lucia.fernandez@example.com", 1.0),
    )
    second = text.index("Lucía prefiere")
    return [*found, Finding(K.PERSON, second, second + len("Lucía"), 0.85)]


def client() -> TestClient:
    return TestClient(create_app(FakeAnalyzer(example_findings)))


def test_the_response_matches_the_contract_example() -> None:
    response = client().post("/anonymize", json=EXAMPLE["request"])

    assert response.status_code == 200
    assert response.json() == EXAMPLE["response"]


def test_us3_1_no_mapped_value_is_left_in_the_text() -> None:
    body = client().post("/anonymize", json=EXAMPLE["request"]).json()

    for entry in body["mapping"]:
        assert entry["value"] not in body["text"]


def test_us3_3_restoring_with_the_mapping_gives_back_the_request_text() -> None:
    body = client().post("/anonymize", json=EXAMPLE["request"]).json()
    mapping = {entry["placeholder"]: entry["value"] for entry in body["mapping"]}

    assert restore(body["text"], mapping) == EXAMPLE["request"]["text"]


def test_us3_7_the_analysis_of_the_original_text_is_included() -> None:
    body = client().post("/anonymize", json=EXAMPLE["request"]).json()

    assert body["analysis"]["sensitivity_level"] == "critical"
    text = EXAMPLE["request"]["text"]
    first = body["analysis"]["findings"][0]
    assert text[first["start"] : first["end"]] == "Lucía Fernández Ruiz"


def test_us3_4_text_without_personal_data_comes_back_unchanged() -> None:
    response = TestClient(create_app(FakeAnalyzer())).post(
        "/anonymize", json={"text": "Nada que ocultar."}
    )

    assert response.json() == {
        "text": "Nada que ocultar.",
        "mapping": [],
        "analysis": {"findings": [], "counts": {}, "sensitivity_level": "none"},
    }


def test_us3_5_the_log_line_has_no_value_and_no_mapping(log_capture: LogCapture) -> None:
    client().post("/anonymize", json=EXAMPLE["request"])

    [line] = log_capture.requests()
    assert line["endpoint"] == "/anonymize"
    assert line["level"] == "critical"
    for value in ("Lucía", "Fernández", "12345678Z", "612 345 678", "lucia.fernandez"):
        log_capture.assert_absent(value)
    log_capture.assert_absent("<PERSON_1>", "<DNI_1>")


def test_validation_errors_apply_to_anonymize_too() -> None:
    response = client().post("/anonymize", json={"text": "hola", "keep": "Lucía"})

    assert response.status_code == 400
    assert response.json()["error"]["field"] == "keep"
    assert "Lucía" not in response.text
