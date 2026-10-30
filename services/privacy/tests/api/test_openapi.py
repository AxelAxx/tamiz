"""The committed contract matches the code (spec 004 US6-1, US6-2, FR-022)."""

import json
from pathlib import Path

from privacy.api.app import create_app
from privacy.api.openapi import render_openapi
from privacy.domain.entity_kind import EntityKind
from privacy.domain.sensitivity import SensitivityLevel
from tests.support.fakes import FakeAnalyzer

COMMITTED = Path(__file__).resolve().parents[2] / "openapi.json"


def rendered() -> str:
    return render_openapi(create_app(FakeAnalyzer()))


def test_us6_1_committed_openapi_matches_the_code() -> None:
    assert COMMITTED.read_text(encoding="utf-8") == rendered(), (
        "openapi.json is stale: run `uv run python scripts/export_openapi.py`"
    )


def test_us6_2_kinds_and_levels_are_named_closed_enums() -> None:
    schemas = json.loads(rendered())["components"]["schemas"]

    assert schemas["EntityKind"]["enum"] == [k.value for k in EntityKind]
    assert schemas["SensitivityLevel"]["enum"] == [lvl.value for lvl in SensitivityLevel]


def test_us6_2_request_objects_reject_unknown_fields() -> None:
    schemas = json.loads(rendered())["components"]["schemas"]

    assert schemas["AnalyzeRequest"]["additionalProperties"] is False


def test_endpoints_are_documented() -> None:
    paths = json.loads(rendered())["paths"]

    assert set(paths) >= {"/analyze", "/health"}
    assert set(paths["/analyze"]["post"]["responses"]) == {"200", "400", "413", "503"}
