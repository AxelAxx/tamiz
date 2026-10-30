"""/analyze with the real Spanish model (spec 004 US1-1, FR-008; edge case: English text).

The phone part of US1-1 lands with the Spanish phone recognizer (T-004-05, task T048), and
the DNI and CIF levels of US1-2 and US1-4 with the identity recognizers (T-004-04, T038).
"""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.nlp


def kinds_and_values(text: str, body: dict[str, object]) -> list[tuple[str, str]]:
    findings = body["findings"]
    assert isinstance(findings, list)
    return [(f["kind"], text[f["start"] : f["end"]]) for f in findings]


def test_us1_1_name_and_email_in_spanish_are_found_with_exact_spans(
    nlp_client: TestClient,
) -> None:
    text = "Hola, soy Lucía Fernández Ruiz y mi correo es lucia.fernandez@example.com."

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert kinds_and_values(text, body) == [
        ("PERSON", "Lucía Fernández Ruiz"),
        ("EMAIL", "lucia.fernandez@example.com"),
    ]
    assert body["sensitivity_level"] == "high"


def test_a_location_alone_is_low(nlp_client: TestClient) -> None:
    text = "La reunión será en Zaragoza el próximo martes."

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert kinds_and_values(text, body) == [("LOCATION", "Zaragoza")]
    assert body["sensitivity_level"] == "low"


def test_a_valid_card_number_is_critical(nlp_client: TestClient) -> None:
    text = "Pago con la tarjeta 4111 1111 1111 1111, gracias."

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert ("CREDIT_CARD", "4111 1111 1111 1111") in kinds_and_values(text, body)
    assert body["sensitivity_level"] == "critical"


def test_a_card_number_failing_luhn_is_not_reported(nlp_client: TestClient) -> None:
    text = "Referencia 4111 1111 1111 1112 del pedido."

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert "CREDIT_CARD" not in body["counts"]


def test_no_personal_data_is_none(nlp_client: TestClient) -> None:
    body = nlp_client.post("/analyze", json={"text": "¿Cuál es la capital de un país?"}).json()

    assert body == {"findings": [], "counts": {}, "sensitivity_level": "none"}


def test_english_text_still_finds_the_email(nlp_client: TestClient) -> None:
    text = "Please write to john.smith@example.com before Friday."

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert ("EMAIL", "john.smith@example.com") in kinds_and_values(text, body)


def test_unrequested_kinds_are_not_reported(nlp_client: TestClient) -> None:
    text = "Soy Lucía Fernández y mi correo es lucia@example.com."

    body = nlp_client.post("/analyze", json={"text": text, "entities": ["EMAIL"]}).json()

    assert kinds_and_values(text, body) == [("EMAIL", "lucia@example.com")]
