"""Service settings from `PRIVACY_*` environment variables, validated at start (data-model §3)."""

import sys
from typing import Literal

from pydantic import Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_PREFIX = "PRIVACY_"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix=ENV_PREFIX, extra="ignore", frozen=True)

    host: str = "0.0.0.0"  # noqa: S104 - the container listens on its internal network
    port: int = Field(default=8001, ge=1, le=65535)
    log_level: Literal["debug", "info", "warning", "error"] = "info"
    default_min_score: float = Field(default=0.5, ge=0.0, le=1.0)
    spacy_model: str = "es_core_news_lg"


def load_settings() -> Settings:
    """Read the environment; on any invalid value print the variable names and exit 1.

    Values are never printed: a misplaced secret in the wrong variable must not reach logs.
    """
    try:
        return Settings()
    except ValidationError as error:
        names = sorted({f"{ENV_PREFIX}{str(issue['loc'][0]).upper()}" for issue in error.errors()})
        print(f"invalid environment: {', '.join(names)}", file=sys.stderr)
        raise SystemExit(1) from None
