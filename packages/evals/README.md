# packages/evals

The eval runner, scorers and versioned synthetic datasets that make AI behaviour an
executable specification: PII leak, detection precision/recall, routing accuracy,
LLM-as-judge quality and cost versus an all-frontier baseline. Thresholds are declared in
each feature's spec; the runner exits non-zero below threshold and CI blocks the PR.
Datasets under `datasets/` are synthetic and never contain real data. Content is Spanish
by design (ADR-0002), plus English where the behaviour under test is bilingual.

Until feature `007-evals-gate` (task `T-007-02`) turns this folder into a workspace
package with the runner, it only holds datasets:

- `datasets/routing.v1.jsonl` (spec 002, `T-002-08`): 44 bilingual routing cases bound
  to `apps/gateway/policies/default.yaml`. The first line is a header (`dataset`,
  `version`, `policy`, `synthetic: true`); each following line is one case with
  `messages`, an optional `model` and the expected `taskType`, `size` and `route`.
  `apps/gateway/test/evals/routing-dataset.test.ts` runs the classifier and `decide`
  over it with no network and fails below 95 % expected routes. Changing the default
  policy or the cue table means editing the expectations here, in the same pull request.
