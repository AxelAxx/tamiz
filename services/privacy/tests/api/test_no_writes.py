"""The service writes nothing anywhere while it works (spec 004 US3-5, US5-2, FR-016).

A Python audit hook records every file opened for writing, every database connection and
every outgoing socket while requests are served. Audit hooks cannot be removed, so one hook
is installed per process and only records while `recording` is on.
"""

import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient

from privacy.api.app import create_app
from privacy.domain.entity_kind import EntityKind
from tests.support.fakes import FakeAnalyzer, spans

_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT
_events: list[str] = []
_recording = False


def _is_write(args: tuple[object, ...]) -> bool:
    mode, flags = (*args, None, None)[1:3]
    if isinstance(mode, str) and any(c in mode for c in "wax+"):
        return True
    return isinstance(flags, int) and bool(flags & _WRITE_FLAGS)


def _hook(event: str, args: tuple[object, ...]) -> None:
    if not _recording:
        return
    if (event == "open" and _is_write(args)) or event in {"sqlite3.connect", "socket.connect"}:
        _events.append(event)


sys.addaudithook(_hook)


@contextmanager
def recording() -> Iterator[list[str]]:
    global _recording
    _events.clear()
    _recording = True
    try:
        yield _events
    finally:
        _recording = False


def test_us3_5_analyze_and_anonymize_write_no_file_and_open_no_connection() -> None:
    text = "Soy Ana Ruiz, DNI 12345678Z."
    analyzer = FakeAnalyzer(
        lambda t: spans(
            t, (EntityKind.PERSON, "Ana Ruiz", 0.85), (EntityKind.DNI, "12345678Z", 1.0)
        )
    )
    # One event loop for the whole test (the context manager): without it the test client
    # builds a loop per request, and on Windows that loop's self-pipe is a socket connect.
    with TestClient(create_app(analyzer)) as client:
        client.get("/health")  # warm-up outside the recording window
        with recording() as events:
            for _ in range(5):
                assert client.post("/analyze", json={"text": text}).status_code == 200
                assert client.post("/anonymize", json={"text": text}).status_code == 200

    assert events == []


def test_the_hook_does_record_writes(tmp_path: object) -> None:
    from pathlib import Path

    assert isinstance(tmp_path, Path)
    with recording() as events:
        (tmp_path / "probe.txt").write_text("x", encoding="utf-8")

    assert events == ["open"]
