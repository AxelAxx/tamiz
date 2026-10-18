# packages/evals

The eval runner, scorers and versioned synthetic datasets that make AI behaviour an
executable specification: PII leak, detection precision/recall, routing accuracy,
LLM-as-judge quality and cost versus an all-frontier baseline. Thresholds are declared in
each feature's spec; the runner exits non-zero below threshold and CI blocks the PR.
Datasets under `datasets/` are synthetic **Spanish** content by design (ADR-0002) and
never contain real data. Created in feature `007-evals-gate` (task `T-007-02`).
