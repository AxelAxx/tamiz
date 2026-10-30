"""Request body limit (spec 004 FR-020, US5-3).

Checked on the declared `content-length` and again while the body streams in, so a chunked
body cannot get past it. The analyzer is never called for an oversized request.
"""

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_BODY_BYTES = 1_048_576  # 1 MiB, the gateway's own limit


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers: list[tuple[bytes, bytes]] = scope.get("headers", [])
        declared = next((value for name, value in headers if name == b"content-length"), None)
        too_large = declared is not None and declared.isdigit() and int(declared) > self.max_bytes
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            if too_large:
                raise HTTPException(status_code=413)
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(status_code=413)
            return message

        await self.app(scope, limited_receive, send)
