"""Sensitivity of a text: the highest level among its findings (spec 004 FR-006)."""

from collections import Counter
from collections.abc import Iterable, Mapping
from enum import StrEnum
from types import MappingProxyType

from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding


class SensitivityLevel(StrEnum):
    NONE = "none"
    LOW = "low"
    HIGH = "high"
    CRITICAL = "critical"


_RANK: Mapping[SensitivityLevel, int] = MappingProxyType(
    {level: rank for rank, level in enumerate(SensitivityLevel)}
)

LEVEL_BY_KIND: Mapping[EntityKind, SensitivityLevel] = MappingProxyType(
    {
        EntityKind.DNI: SensitivityLevel.CRITICAL,
        EntityKind.NIE: SensitivityLevel.CRITICAL,
        EntityKind.NSS: SensitivityLevel.CRITICAL,
        EntityKind.IBAN: SensitivityLevel.CRITICAL,
        EntityKind.CREDIT_CARD: SensitivityLevel.CRITICAL,
        EntityKind.PERSON: SensitivityLevel.HIGH,
        EntityKind.PHONE: SensitivityLevel.HIGH,
        EntityKind.EMAIL: SensitivityLevel.HIGH,
        EntityKind.CIF: SensitivityLevel.LOW,
        EntityKind.LOCATION: SensitivityLevel.LOW,
    }
)


def level_of(findings: Iterable[Finding]) -> SensitivityLevel:
    return max(
        (LEVEL_BY_KIND[f.kind] for f in findings),
        key=_RANK.__getitem__,
        default=SensitivityLevel.NONE,
    )


def counts_of(findings: Iterable[Finding]) -> dict[EntityKind, int]:
    return dict(Counter(f.kind for f in findings))
