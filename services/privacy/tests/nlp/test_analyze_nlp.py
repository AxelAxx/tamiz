"""/analyze with the real Spanish model (spec 004 US1, FR-008; edge case: English text)."""

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.nlp


def kinds_and_values(text: str, body: dict[str, object]) -> list[tuple[str, str]]:
    findings = body["findings"]
    assert isinstance(findings, list)
    return [(f["kind"], text[f["start"] : f["end"]]) for f in findings]


def test_us1_1_name_email_and_phone_in_spanish_are_found_with_exact_spans(
    nlp_client: TestClient,
) -> None:
    text = (
        "Hola, soy Lucía Fernández Ruiz, mi correo es lucia.fernandez@example.com "
        "y mi teléfono es el 612 345 678."
    )

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert kinds_and_values(text, body) == [
        ("PERSON", "Lucía Fernández Ruiz"),
        ("EMAIL", "lucia.fernandez@example.com"),
        ("PHONE", "612 345 678"),
    ]
    assert body["sensitivity_level"] == "high"


def test_us2_8_a_phone_word_nearby_raises_the_phone_score(nlp_client: TestClient) -> None:
    with_context = nlp_client.post("/analyze", json={"text": "Mi móvil es el 612 345 678."}).json()
    bare = nlp_client.post("/analyze", json={"text": "Apunta: 612 345 678."}).json()

    [phone_with_context] = with_context["findings"]
    [bare_phone] = bare["findings"]
    assert bare_phone["score"] == 0.6
    assert phone_with_context["score"] > bare_phone["score"]


def test_us2_6_an_iban_makes_the_text_critical(nlp_client: TestClient) -> None:
    text = "Por favor, el recibo va a la cuenta ES91 2100 0418 4502 0005 1332."

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert kinds_and_values(text, body) == [("IBAN", "ES91 2100 0418 4502 0005 1332")]
    assert body["sensitivity_level"] == "critical"


def test_us2_7_an_nss_makes_the_text_critical(nlp_client: TestClient) -> None:
    text = "Número de afiliación a la Seguridad Social 28/12345678/40."

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert ("NSS", "28/12345678/40") in kinds_and_values(text, body)
    assert body["sensitivity_level"] == "critical"


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


def test_us1_2_a_valid_dni_makes_the_text_critical(nlp_client: TestClient) -> None:
    text = "La paciente Lucía Fernández, con DNI 12345678Z, pide cita."

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert kinds_and_values(text, body) == [
        ("PERSON", "Lucía Fernández"),
        ("DNI", "12345678Z"),
    ]
    assert body["sensitivity_level"] == "critical"


def test_us1_4_a_cif_alone_is_low(nlp_client: TestClient) -> None:
    text = "Factura emitida con CIF B12345674 el mes pasado."

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert kinds_and_values(text, body) == [("CIF", "B12345674")]
    assert body["sensitivity_level"] == "low"


def test_a_nie_and_a_wrong_dni_together(nlp_client: TestClient) -> None:
    text = "Titular con NIE Y1234567X; el DNI 12345678A del formulario es erróneo."

    body = nlp_client.post("/analyze", json={"text": text}).json()

    assert kinds_and_values(text, body) == [("NIE", "Y1234567X")]
    assert body["sensitivity_level"] == "critical"


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
