"""The Python reference reproduces the shared placeholder vectors (spec 005 research R-01).

The gateway's TypeScript port runs the same file
(`apps/gateway/test/domain/placeholders.test.ts`), so both implementations stay equal.
"""

import json
from pathlib import Path

import pytest

from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding
from privacy.domain.placeholders import anonymize
from tests.support.restore import restore

VECTORS = (
    Path(__file__).resolve().parents[4]
    / "specs"
    / "005-privacy-aware-routing"
    / "contracts"
    / "placeholder-vectors.json"
)
CASES = json.loads(VECTORS.read_text(encoding="utf-8"))["vectors"]


@pytest.mark.parametrize("vector", CASES, ids=[case["name"] for case in CASES])
def test_shared_vector(vector: dict[str, object]) -> None:
    text = str(vector["text"])
    findings = [
        Finding(EntityKind(f["kind"]), f["start"], f["end"], 1.0)
        for f in vector["findings"]  # type: ignore[attr-defined]
    ]
    expected = vector["expected"]

    result = anonymize(text, findings)

    assert result.text == expected["text"]  # type: ignore[index]
    assert [
        {"placeholder": e.placeholder, "kind": e.kind.value, "value": e.value}
        for e in result.mapping
    ] == expected["mapping"]  # type: ignore[index]
    assert restore(result.text, result.mapping) == text
