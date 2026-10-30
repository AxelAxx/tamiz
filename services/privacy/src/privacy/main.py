"""Composition root: the only module that builds infrastructure adapters.

Run with `uv run python -m privacy.main`.
"""

import uvicorn

from privacy.api.app import create_app
from privacy.api.logging import configure_logging
from privacy.infrastructure.settings import load_settings


def main() -> None:
    settings = load_settings()
    configure_logging(settings.log_level)
    app = create_app(readiness=lambda: True)
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        access_log=False,
        log_config=None,
        server_header=False,
    )


if __name__ == "__main__":
    main()
