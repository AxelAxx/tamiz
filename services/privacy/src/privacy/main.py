"""Composition root: the only module that builds infrastructure adapters.

Run with `uv run python -m privacy.main`. The language model loads before the server
listens (research R-11), so the service never accepts traffic it cannot analyze.
"""

import logging

import uvicorn

from privacy.api.app import create_app
from privacy.api.logging import configure_logging
from privacy.infrastructure.presidio_analyzer import PresidioAnalyzer, build_engine
from privacy.infrastructure.settings import load_settings

logger = logging.getLogger("privacy.main")


def main() -> None:
    settings = load_settings()
    configure_logging(settings.log_level)
    analyzer = PresidioAnalyzer(build_engine(settings.spacy_model))
    logger.info("analyzer ready")
    app = create_app(analyzer, default_min_score=settings.default_min_score)
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
