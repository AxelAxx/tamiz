"""Write the service's OpenAPI document to `openapi.json` (spec 004 FR-022).

uv run python scripts/export_openapi.py          # write
uv run python scripts/export_openapi.py --check  # exit 1 if the committed file drifted
"""

import argparse
import sys
from pathlib import Path

from privacy.api.app import create_app
from privacy.api.openapi import render_openapi
from privacy.domain.entity_kind import EntityKind
from privacy.domain.finding import Finding

TARGET = Path(__file__).resolve().parent.parent / "openapi.json"


class _NoModel:
    """The document does not depend on the analyzer; avoid loading the language model."""

    def analyze(self, text: str, kinds: frozenset[EntityKind]) -> list[Finding]:
        return []

    def is_ready(self) -> bool:
        return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if openapi.json is stale")
    args = parser.parse_args()
    rendered = render_openapi(create_app(_NoModel()))
    if args.check:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != rendered:
            print(f"{TARGET.name} is stale: run scripts/export_openapi.py", file=sys.stderr)
            return 1
        print(f"{TARGET.name} is up to date")
        return 0
    TARGET.write_text(rendered, encoding="utf-8", newline="\n")
    print(f"wrote {TARGET.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
