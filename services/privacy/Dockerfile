# Tamiz privacy service (spec 004 FR-003). Multi-stage: uv resolves the locked environment
# in the builder; the runtime image holds only Python, the virtual environment and a
# non-root user. Build from the repository root: docker build -t tamiz-privacy services/privacy

FROM python:3.12-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.11.21 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0
WORKDIR /app
# Dependencies first, so source changes do not invalidate the (large, from T-004-03) layer.
COPY pyproject.toml uv.lock .python-version README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.12-slim-bookworm AS runtime
RUN groupadd --system --gid 10001 privacy \
    && useradd --system --uid 10001 --gid privacy --no-create-home --shell /usr/sbin/nologin privacy
COPY --from=builder --chown=privacy:privacy /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
USER privacy
EXPOSE 8001
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=2)"]
CMD ["python", "-m", "privacy.main"]
