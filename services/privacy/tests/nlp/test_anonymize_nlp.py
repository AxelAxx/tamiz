"""/anonymize end to end with the real engine (spec 004 US3-1, US3-3)."""

import pytest
from fastapi.testclient import TestClient

from tests.support.restore import restore

pytestmark = pytest.mark.nlp

TEXT = (
    "La paciente Lucía Fernández Ruiz, con DNI 12345678Z, pide cita en Valencia. "
    "Teléfono 612 345 678, correo lucia.fernandez@example.com. Lucía prefiere la tarde."
)


def test_us3_1_us3_3_contract_example_round_trip(nlp_client: TestClient) -> None:
    body = nlp_client.post("/anonymize", json={"text": TEXT}).json()
    mapping = {entry["placeholder"]: entry["value"] for entry in body["mapping"]}

    assert body["text"] == (
        "La paciente <PERSON_1>, con DNI <DNI_1>, pide cita en <LOCATION_1>. "
        "Teléfono <PHONE_1>, correo <EMAIL_1>. <PERSON_2> prefiere la tarde."
    )
    assert restore(body["text"], mapping) == TEXT
    assert body["analysis"]["sensitivity_level"] == "critical"


def test_identifiers_only(nlp_client: TestClient) -> None:
    text = "IBAN ES91 2100 0418 4502 0005 1332, NSS 28/12345678/40, NIE Y1234567X."

    body = nlp_client.post(
        "/anonymize", json={"text": text, "entities": ["IBAN", "NSS", "NIE"]}
    ).json()

    assert body["text"] == "IBAN <IBAN_1>, NSS <NSS_1>, NIE <NIE_1>."
    assert restore(body["text"], {e["placeholder"]: e["value"] for e in body["mapping"]}) == text
