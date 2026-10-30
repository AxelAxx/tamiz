"""Log capture used by the tests: exactly what the production formatter writes."""

import io
import json

type JsonLine = dict[str, object]


class LogCapture:
    """Every line the service logs, formatted by the production formatter."""

    def __init__(self) -> None:
        self.stream = io.StringIO()

    @property
    def text(self) -> str:
        return self.stream.getvalue()

    def lines(self) -> list[JsonLine]:
        return [json.loads(line) for line in self.text.splitlines() if line]

    def requests(self) -> list[JsonLine]:
        return [line for line in self.lines() if line.get("msg") == "request"]

    def assert_absent(self, *values: str) -> None:
        for value in values:
            assert value not in self.text, "a sensitive value reached the logs"
