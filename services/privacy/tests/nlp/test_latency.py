"""Latency of /analyze on a 2 000-character text (spec 004 SC-004; research R-15)."""

import statistics
import time

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.nlp

SENTENCE = (
    "La paciente Lucía Fernández Ruiz acudió a consulta en Valencia y dejó su correo "
    "lucia.fernandez@example.com para recibir los resultados del análisis. "
)
TEXT = (SENTENCE * (2000 // len(SENTENCE) + 1))[:2000]
P95_BUDGET_MS = 200.0


def test_sc_004_p95_under_200_ms_after_warm_up(nlp_client: TestClient) -> None:
    for _ in range(20):
        nlp_client.post("/analyze", json={"text": TEXT})

    timings = []
    for _ in range(100):
        started = time.perf_counter()
        response = nlp_client.post("/analyze", json={"text": TEXT})
        timings.append((time.perf_counter() - started) * 1000)
        assert response.status_code == 200

    p95 = statistics.quantiles(timings, n=100)[94]
    print(f"/analyze 2000 chars: p50 {statistics.median(timings):.1f} ms, p95 {p95:.1f} ms")
    assert p95 < P95_BUDGET_MS
