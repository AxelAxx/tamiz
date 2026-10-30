"""The closed list of personal-data kinds the service reports (spec 004 FR-005)."""

from enum import StrEnum


class EntityKind(StrEnum):
    DNI = "DNI"
    NIE = "NIE"
    CIF = "CIF"
    IBAN = "IBAN"
    NSS = "NSS"
    PHONE = "PHONE"
    EMAIL = "EMAIL"
    CREDIT_CARD = "CREDIT_CARD"
    PERSON = "PERSON"
    LOCATION = "LOCATION"


# Overlap tie-break order, most specific first (research R-08).
SPECIFICITY: tuple[EntityKind, ...] = (
    EntityKind.DNI,
    EntityKind.NIE,
    EntityKind.CIF,
    EntityKind.IBAN,
    EntityKind.NSS,
    EntityKind.CREDIT_CARD,
    EntityKind.EMAIL,
    EntityKind.PHONE,
    EntityKind.PERSON,
    EntityKind.LOCATION,
)

# Kinds gated by precision and recall ≥ 0.95 on the corpus (SC-001).
STRUCTURED: frozenset[EntityKind] = frozenset(
    {
        EntityKind.DNI,
        EntityKind.NIE,
        EntityKind.CIF,
        EntityKind.IBAN,
        EntityKind.NSS,
        EntityKind.PHONE,
        EntityKind.EMAIL,
    }
)
