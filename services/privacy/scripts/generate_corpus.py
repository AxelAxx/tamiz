"""Generate the synthetic Spanish PII corpus (spec 004 US4, FR-017; research R-14).

    uv run python scripts/generate_corpus.py          # write tests/corpus/pii-es.v1.jsonl
    uv run python scripts/generate_corpus.py --check  # exit 1 if the committed file differs

Everything is synthetic: names come from Faker's `es_ES` lists, identifiers are computed
here from random numbers (valid by construction, or deliberately invalid for the hard
negatives), emails use the reserved `example.*` domains, and the sentences are templates.
The output is deterministic for a given seed and the locked Faker version.
"""

import argparse
import json
import random
import sys
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from faker import Faker

VERSION = "1"
SEED = 20261030
CREATED = "2026-10-30"
TARGET = Path(__file__).resolve().parent.parent / "tests" / "corpus" / f"pii-es.v{VERSION}.jsonl"

CITIES = [
    "Madrid", "Barcelona", "Valencia", "Sevilla", "Zaragoza", "Málaga", "Murcia", "Bilbao",
    "Alicante", "Córdoba", "Valladolid", "Vigo", "Gijón", "Granada", "Oviedo", "Pamplona",
    "Santander", "Toledo", "Salamanca", "Cádiz", "Logroño", "Almería", "Badajoz", "Burgos",
]  # fmt: skip
DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"
CIF_LETTERS = "JABCDEFGHI"


# --- identifiers (valid by construction) ------------------------------------------------


def dni_letter(number: int) -> str:
    return DNI_LETTERS[number % 23]


def cif_control(digits: str) -> int:
    even = sum(int(d) for d in digits[1::2])
    odd = sum(sum(divmod(2 * int(d), 10)) for d in digits[0::2])
    return (10 - (even + odd) % 10) % 10


def account_control(ten: str) -> str:
    weights = (1, 2, 4, 8, 5, 10, 9, 7, 3, 6)
    value = 11 - sum(int(d) * w for d, w in zip(ten, weights, strict=True)) % 11
    return {11: "0", 10: "1"}.get(value, str(value))


def iban_check(country: str, bban: str) -> str:
    number = int("".join(str(int(c, 36)) for c in bban + country + "00"))
    return f"{98 - number % 97:02d}"


def nss_control(province: int, number: int) -> int:
    base = (
        number + province * 10_000_000
        if number < 10_000_000
        else int(f"{province:02d}{number:08d}")
    )
    return base % 97


@dataclass
class Gen:
    rng: random.Random
    fake: Faker

    def dni(self) -> str:
        n = self.rng.randrange(10**8)
        digits, letter = f"{n:08d}", dni_letter(n)
        style = self.rng.randrange(4)
        if style == 0:
            return f"{digits}{letter}"
        if style == 1:
            return f"{digits}-{letter}"
        if style == 2:
            return f"{digits[:2]}.{digits[2:5]}.{digits[5:]}-{letter}"
        return f"{digits}{letter.lower()}"

    def nie(self) -> str:
        prefix = self.rng.choice("XYZ")
        n = self.rng.randrange(10**7)
        letter = dni_letter(int("XYZ".index(prefix) * 10**7 + n))
        return (
            f"{prefix}{n:07d}{letter}" if self.rng.random() < 0.7 else f"{prefix}-{n:07d}-{letter}"
        )

    def cif(self) -> str:
        org = self.rng.choice("ABBBBEHPQSG")
        digits = f"{self.rng.randrange(10**7):07d}"
        control = cif_control(digits)
        mark = CIF_LETTERS[control] if org in "PQS" else str(control)
        return f"{org}{digits}{mark}" if self.rng.random() < 0.8 else f"{org}-{digits}{mark}"

    def iban(self) -> str:
        bank_branch = f"{self.rng.randrange(10**8):08d}"
        account = f"{self.rng.randrange(10**10):010d}"
        bban = (
            bank_branch + account_control("00" + bank_branch) + account_control(account) + account
        )
        value = "ES" + iban_check("ES", bban) + bban
        if self.rng.random() < 0.6:
            return " ".join(value[i : i + 4] for i in range(0, len(value), 4))
        return value

    def nss(self) -> str:
        province, number = self.rng.randint(1, 52), self.rng.randrange(10**8)
        control = nss_control(province, number)
        sep = self.rng.choice(["", "/", " ", "-"])
        return f"{province:02d}{sep}{number:08d}{sep}{control:02d}"

    def phone(self) -> str:
        first = self.rng.choice("6666789")
        rest = f"{self.rng.randrange(10**8):08d}"
        if first == "7":
            rest = str(self.rng.randint(1, 4)) + rest[1:]
        digits = first + rest
        style = self.rng.randrange(5)
        if style == 0:
            return digits
        if style == 1:
            return f"{digits[:3]} {digits[3:6]} {digits[6:]}"
        if style == 2:
            return f"{digits[:3]} {digits[3:5]} {digits[5:7]} {digits[7:]}"
        if style == 3:
            return f"+34 {digits[:3]} {digits[3:6]} {digits[6:]}"
        return f"+34{digits}"

    def card(self) -> str:
        body = "4" + "".join(str(self.rng.randrange(10)) for _ in range(14))
        total = 0
        for i, d in enumerate(reversed(body)):
            n = int(d) * (2 if i % 2 == 0 else 1)
            total += n - 9 if n > 9 else n
        number = body + str((10 - total % 10) % 10)
        return " ".join(number[i : i + 4] for i in range(0, 16, 4))

    def person(self) -> str:
        f = self.fake
        return f"{f.first_name()} {f.last_name()} {f.last_name()}"

    def first_name(self) -> str:
        return str(self.fake.first_name())

    def email(self, person: str) -> str:
        ascii_name = unicodedata.normalize("NFKD", person).encode("ascii", "ignore").decode()
        first, last = ascii_name.lower().split()[:2]
        domain = self.rng.choice(["example.com", "example.org", "example.net"])
        return f"{first}.{last}{self.rng.randrange(100)}@{domain}"

    def city(self) -> str:
        return self.rng.choice(CITIES)

    def date(self) -> str:
        return f"{self.rng.randint(1, 28):02d}/{self.rng.randint(1, 12):02d}/2026"

    # --- deliberately invalid look-alikes (hard negatives) ---

    def bad_dni(self) -> str:
        n = self.rng.randrange(10**8)
        wrong = self.rng.choice([c for c in DNI_LETTERS if c != dni_letter(n)])
        return f"{n:08d}{wrong}"

    def bad_nie(self) -> str:
        value = self.nie().replace("-", "")
        wrong = self.rng.choice([c for c in DNI_LETTERS if c != value[-1]])
        return value[:-1] + wrong

    def bad_cif(self) -> str:
        digits = f"{self.rng.randrange(10**7):07d}"
        return f"B{digits}{(cif_control(digits) + self.rng.randint(1, 9)) % 10}"

    def bad_iban(self) -> str:
        value = self.iban().replace(" ", "")
        position = self.rng.randint(4, len(value) - 1)
        digit = str((int(value[position]) + self.rng.randint(1, 9)) % 10)
        return value[:position] + digit + value[position + 1 :]

    def bad_nss(self) -> str:
        province, number = self.rng.randint(1, 52), self.rng.randrange(10**8)
        return f"{province:02d}{number:08d}{(nss_control(province, number) + 1) % 97:02d}"

    def not_a_phone(self) -> str:
        return str(self.rng.randint(1, 5)) + f"{self.rng.randrange(10**8):08d}"


# --- cases ------------------------------------------------------------------------------


@dataclass
class Case:
    tags: list[str]
    pieces: list[str] = field(default_factory=list)
    spans: list[dict[str, object]] = field(default_factory=list)

    def t(self, text: str) -> "Case":
        self.pieces.append(text)
        return self

    def e(self, kind: str, value: str) -> "Case":
        start = sum(len(p) for p in self.pieces)
        self.pieces.append(value)
        self.spans.append({"kind": kind, "start": start, "end": start + len(value)})
        return self

    @property
    def text(self) -> str:
        return "".join(self.pieces)


type Template = Callable[[Gen], Case]


def clinic_admission(g: Gen) -> Case:
    p = g.person()
    return (
        Case(["clinic"]).t("La paciente ").e("PERSON", p).t(", con DNI ").e("DNI", g.dni())
        .t(", ingresa hoy en el hospital de ").e("LOCATION", g.city()).t(".")
    )  # fmt: skip


def clinic_contact(g: Gen) -> Case:
    p = g.person()
    return (
        Case(["clinic"]).t("Contactar con ").e("PERSON", p).t(" en el teléfono ")
        .e("PHONE", g.phone()).t(" o por correo a ").e("EMAIL", g.email(p))
        .t(" para confirmar la cita.")
    )  # fmt: skip


def clinic_social_security(g: Gen) -> Case:
    return (
        Case(["clinic"]).t("Número de afiliación a la Seguridad Social: ").e("NSS", g.nss())
        .t(". Revisión el ").t(g.date()).t(".")
    )  # fmt: skip


def hr_payroll(g: Gen) -> Case:
    p = g.person()
    return (
        Case(["hr"]).t("Nómina de ").e("PERSON", p).t(": ingresar en la cuenta ")
        .e("IBAN", g.iban()).t(" antes del día cinco.")
    )  # fmt: skip


def hr_foreign_worker(g: Gen) -> Case:
    return (
        Case(["hr"]).t("El trabajador con NIE ").e("NIE", g.nie())
        .t(" y número de Seguridad Social ")
        .e("NSS", g.nss()).t(" se incorpora en ").e("LOCATION", g.city()).t(".")
    )  # fmt: skip


def legal_contract(g: Gen) -> Case:
    p = g.person()
    return (
        Case(["legal"]).t("Contrato entre la empresa con CIF ").e("CIF", g.cif()).t(" y don ")
        .e("PERSON", p).t(", con DNI ").e("DNI", g.dni()).t(".")
    )  # fmt: skip


def legal_notification(g: Gen) -> Case:
    return (
        Case(["legal"]).t("Se notificará al interesado por correo electrónico (")
        .e("EMAIL", g.email(g.person())).t(") y por teléfono al ").e("PHONE", g.phone()).t(".")
    )  # fmt: skip


def fintech_transfer(g: Gen) -> Case:
    return (
        Case(["fintech"]).t("Transferencia desde la cuenta ").e("IBAN", g.iban())
        .t(" a nombre de ").e("PERSON", g.person()).t(", NIE ").e("NIE", g.nie()).t(".")
    )  # fmt: skip


def fintech_card(g: Gen) -> Case:
    return (
        Case(["fintech"]).t("El cliente pagó con la tarjeta ").e("CREDIT_CARD", g.card())
        .t(" y facilitó el móvil ").e("PHONE", g.phone()).t(".")
    )  # fmt: skip


def fintech_invoice(g: Gen) -> Case:
    return (
        Case(["fintech"]).t("Factura de la sociedad con CIF ").e("CIF", g.cif())
        .t(", domiciliada en ").e("LOCATION", g.city()).t(", pagadera en la cuenta ")
        .e("IBAN", g.iban()).t(".")
    )  # fmt: skip


def generic_message(g: Gen) -> Case:
    name = g.first_name()
    return (
        Case(["generic"]).t("Hola, soy ").e("PERSON", name).t(", mi DNI es ").e("DNI", g.dni())
        .t(" y mi correo ").e("EMAIL", g.email(name + " " + str(g.fake.last_name()))).t(".")
    )  # fmt: skip


def generic_identity(g: Gen) -> Case:
    return (
        Case(["generic"]).t("Documento: NIE ").e("NIE", g.nie())
        .t(". Afiliación: ").e("NSS", g.nss())
        .t(". Empresa: ").e("CIF", g.cif()).t(".")
    )  # fmt: skip


POSITIVE: list[Template] = [
    clinic_admission, clinic_contact, clinic_social_security, hr_payroll, hr_foreign_worker,
    legal_contract, legal_notification, fintech_transfer, fintech_card, fintech_invoice,
    generic_message, generic_identity,
]  # fmt: skip

NEGATIVE: list[tuple[str, Callable[[Gen], str]]] = [
    ("dni-bad-letter", lambda g: f"El DNI {g.bad_dni()} del formulario no es válido."),
    ("nie-bad-letter", lambda g: f"Revise el NIE {g.bad_nie()}, la letra no cuadra."),
    ("cif-bad-control", lambda g: f"El CIF {g.bad_cif()} tiene el dígito de control erróneo."),
    ("iban-bad-check", lambda g: f"La cuenta {g.bad_iban()} fue rechazada por el banco."),
    ("nss-bad-control", lambda g: f"El número {g.bad_nss()} no supera la validación."),
    ("plain-number", lambda g: f"Pedido {g.rng.randrange(10**7, 10**8)} enviado el {g.date()}."),
    ("postcode", lambda g: (
        f"Código postal {g.rng.randint(1000, 52999):05d}, "
        f"referencia {g.rng.randrange(10**8):08d}."
    )),
    ("not-a-phone", lambda g: f"Expediente número {g.not_a_phone()} archivado."),
    ("amount", lambda g: (
        f"Importe total: {g.rng.randint(1, 999)}.{g.rng.randint(100, 999)},"
        f"{g.rng.randint(10, 99)} euros."
    )),
    ("no-pii", lambda g: g.rng.choice([
        "Resume este informe en tres puntos, por favor.",
        "Traduce el siguiente párrafo al inglés.",
        "¿Qué diferencias hay entre un contrato temporal y uno indefinido?",
        "Redacta un correo de bienvenida para nuevos clientes.",
        "Explica qué es la tasa de interés nominal.",
    ])),
]  # fmt: skip

POSITIVE_CASES = 264
NEGATIVE_CASES = 60


def generate(seed: int = SEED) -> str:
    rng = random.Random(seed)
    fake = Faker("es_ES")
    fake.seed_instance(seed)
    g = Gen(rng, fake)
    cases: list[Case] = []
    for i in range(POSITIVE_CASES):
        cases.append(POSITIVE[i % len(POSITIVE)](g))
    for i in range(NEGATIVE_CASES):
        tag, make = NEGATIVE[i % len(NEGATIVE)]
        cases.append(Case(["negative", tag]).t(make(g)))
    rng.shuffle(cases)

    meta = {
        "type": "meta",
        "version": VERSION,
        "synthetic": True,
        "language": "es",
        "generator": "scripts/generate_corpus.py",
        "seed": seed,
        "created": CREATED,
    }
    lines = [json.dumps(meta, ensure_ascii=False)]
    for number, case in enumerate(cases, start=1):
        record = {
            "type": "case",
            "id": f"c{number:04d}",
            "text": case.text,
            "spans": case.spans,
            "tags": case.tags,
        }
        lines.append(json.dumps(record, ensure_ascii=False))
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the committed corpus differs")
    args = parser.parse_args()
    rendered = generate()
    if args.check:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != rendered:
            print(f"{TARGET.name} differs from the generator output", file=sys.stderr)
            return 1
        print(f"{TARGET.name} is reproducible")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(rendered, encoding="utf-8", newline="\n")
    print(f"wrote {TARGET.relative_to(TARGET.parents[2])} ({rendered.count(chr(10)) - 1} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
