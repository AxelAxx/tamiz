"""DNI, NIE and CIF recognizers alone, no language model (spec 004 US2-1 … US2-5, FR-013)."""

import pytest

from privacy.infrastructure.recognizers.identity import (
    cif_recognizer,
    dni_recognizer,
    nie_recognizer,
)
from tests.support.recognizers import found


@pytest.mark.parametrize(
    "written", ["12345678Z", "12345678-Z", "12345678 Z", "12.345.678-Z", "12345678z"]
)
def test_us2_1_valid_dni_with_or_without_separators(written: str) -> None:
    text = f"El paciente con DNI {written} pide cita."

    assert found(dni_recognizer(), text) == [("DNI", written, 1.0)]


def test_us2_1_dni_at_the_start_and_end_of_the_text() -> None:
    assert found(dni_recognizer(), "12345678Z") == [("DNI", "12345678Z", 1.0)]
    assert found(dni_recognizer(), "DNI: 00000000T.") == [("DNI", "00000000T", 1.0)]


def test_us2_2_wrong_dni_letter_is_rejected() -> None:
    assert found(dni_recognizer(), "El DNI 12345678A no es válido.") == []


@pytest.mark.parametrize(
    "text",
    [
        "Pedido 12345678 enviado.",
        "Código postal 46001 y referencia 12345678.",
        "Fecha 12/03/2026, importe 1.234.567,89 €.",
        "Teléfono 612345678.",
        "Referencia ABC12345678Z9.",
        "Lote 123456789Z de fábrica.",
    ],
)
def test_us2_3_plain_numbers_are_not_identifiers(text: str) -> None:
    for recognizer in (dni_recognizer(), nie_recognizer(), cif_recognizer()):
        assert found(recognizer, text) == []


@pytest.mark.parametrize("written", ["X1234567L", "Y1234567X", "X-1234567-L", "x1234567l"])
def test_us2_4_valid_nie(written: str) -> None:
    text = f"Extranjero con NIE {written}, residente."

    assert found(nie_recognizer(), text) == [("NIE", written, 1.0)]


def test_us2_4_wrong_nie_letter_is_rejected() -> None:
    assert found(nie_recognizer(), "NIE X1234567A") == []


@pytest.mark.parametrize("written", ["B12345674", "B-12345674", "P1234567D", "G1234567D"])
def test_us2_5_valid_cif(written: str) -> None:
    text = f"Factura emitida por la empresa con CIF {written}."

    assert found(cif_recognizer(), text) == [("CIF", written, 1.0)]


@pytest.mark.parametrize("written", ["B12345675", "B1234567D", "P12345674"])
def test_us2_5_wrong_cif_control_is_rejected(written: str) -> None:
    assert found(cif_recognizer(), f"CIF {written}") == []


def test_a_nie_is_not_also_a_dni_or_cif() -> None:
    text = "NIE X1234567L"

    assert found(dni_recognizer(), text) == []
    assert found(cif_recognizer(), text) == []
