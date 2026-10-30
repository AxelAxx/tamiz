"""Settings are validated at start; invalid values stop the process (constitution VI)."""

import pytest

from privacy.infrastructure.settings import load_settings


def test_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("PRIVACY_HOST", "PRIVACY_PORT", "PRIVACY_LOG_LEVEL", "PRIVACY_DEFAULT_MIN_SCORE"):
        monkeypatch.delenv(name, raising=False)

    settings = load_settings()

    assert settings.host == "0.0.0.0"  # noqa: S104 - container default
    assert settings.port == 8001
    assert settings.log_level == "info"
    assert settings.default_min_score == 0.5
    assert settings.spacy_model == "es_core_news_lg"


def test_environment_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PRIVACY_PORT", "9000")
    monkeypatch.setenv("PRIVACY_DEFAULT_MIN_SCORE", "0.7")

    settings = load_settings()

    assert settings.port == 9000
    assert settings.default_min_score == 0.7


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("PRIVACY_PORT", "not-a-port-xyz"),
        ("PRIVACY_PORT", "70000"),
        ("PRIVACY_DEFAULT_MIN_SCORE", "1.5"),
        ("PRIVACY_LOG_LEVEL", "chatty"),
    ],
)
def test_invalid_values_exit_naming_the_variable_never_the_value(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], name: str, value: str
) -> None:
    monkeypatch.setenv(name, value)

    with pytest.raises(SystemExit) as exit_info:
        load_settings()

    assert exit_info.value.code == 1
    err = capsys.readouterr().err
    assert name in err
    assert value not in err
