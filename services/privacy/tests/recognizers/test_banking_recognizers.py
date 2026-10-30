"""IBAN, NSS and phone recognizers alone, no language model (spec 004 US2-6 … US2-8)."""

import pytest

from privacy.infrastructure.recognizers.banking import iban_recognizer
from privacy.infrastructure.recognizers.phone import PHONE_BASE_SCORE, phone_recognizer
from privacy.infrastructure.recognizers.social_security import nss_recognizer
from tests.support.recognizers import found


@pytest.mark.parametrize(
    "written",
    [
        "ES91 2100 0418 4502 0005 1332",
        "ES9121000418450200051332",
        "es91 2100 0418 4502 0005 1332",
    ],
)
def test_us2_6_spanish_iban_grouped_or_compact(written: str) -> None:
    text = f"Transferencia a la cuenta {written} para el pago."

    assert found(iban_recognizer(), text) == [("IBAN", written, 1.0)]


def test_us2_6_iban_followed_by_a_word_still_matches() -> None:
    text = "IBAN ES91 2100 0418 4502 0005 1332 para nóminas"

    assert found(iban_recognizer(), text) == [("IBAN", "ES91 2100 0418 4502 0005 1332", 1.0)]


@pytest.mark.parametrize(
    "written",
    [
        "ES91 2100 0418 4502 0005 1333",  # one wrong digit
        "ES41 2100 0418 9902 0005 1332",  # mod-97 passes, account control digits fail
    ],
)
def test_us2_6_invalid_ibans_are_rejected(written: str) -> None:
    assert found(iban_recognizer(), f"Cuenta {written}.") == []


@pytest.mark.parametrize(
    "written", ["DE89 3704 0044 0532 0130 00", "GB82 WEST 1234 5698 7654 32", "NL91ABNA0417164300"]
)
def test_valid_foreign_ibans_are_recognised(written: str) -> None:
    assert found(iban_recognizer(), f"Account {written} please") == [("IBAN", written, 1.0)]


@pytest.mark.parametrize("written", ["281234567840", "28/12345678/40", "28 12345678 40"])
def test_us2_7_nss(written: str) -> None:
    text = f"Número de la Seguridad Social: {written}."

    assert found(nss_recognizer(), text) == [("NSS", written, 1.0)]


@pytest.mark.parametrize("written", ["281234567841", "001234567840"])
def test_us2_7_wrong_nss_control_or_province_is_rejected(written: str) -> None:
    assert found(nss_recognizer(), f"NSS {written}") == []


@pytest.mark.parametrize(
    "written",
    [
        "612345678",
        "612 345 678",
        "612-345-678",
        "612.345.678",
        "612 34 56 78",
        "+34 612 345 678",
        "+34612345678",
        "0034 612 345 678",
        "912 345 678",
        "712345678",
    ],
)
def test_us2_8_spanish_phone_formats(written: str) -> None:
    text = f"Llámame al {written} mañana."

    assert found(phone_recognizer(), text) == [("PHONE", written, PHONE_BASE_SCORE)]


@pytest.mark.parametrize(
    "text",
    [
        "Pedido 512345678 recibido.",
        "Referencia 6123456789 del lote.",
        "Código 61234567.",
        "Número francés +33 612 345 678.",
        "Importe 612.345.678,50 €.",
        "IBAN ES91 2100 0418 4502 0005 1332",
    ],
)
def test_us2_8_numbers_that_cannot_be_spanish_phones(text: str) -> None:
    assert found(phone_recognizer(), text) == []


def test_phone_base_score_keeps_bare_numbers_above_the_default_threshold() -> None:
    assert 0.5 < PHONE_BASE_SCORE < 1.0
