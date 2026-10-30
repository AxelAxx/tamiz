# Contract: dataset files

Every file is UTF-8 JSONL. Line 1 is the header, and each following line is one case.
Unknown fields are rejected. All content is synthetic; personal-data-shaped values are
invented and carry valid control characters so that recognizers treat them as real.

## Common header

```json
{"dataset":"pii-leak-es","version":1,"synthetic":true,"language":["es"],
 "generator":"packages/evals/scripts/generate-pii-datasets.ts","seed":20261031,
 "policy":"apps/gateway/policies/default.yaml",
 "note":"Synthetic cases only. Every name, number and text is invented."}
```

- `generator` and `seed` are present on generated datasets.
- `policy` is present on datasets whose expectations depend on a policy.

## `pii-leak-es` case

```json
{"id":"pii-leak-0001","model":"tamiz-auto","tags":["clinic","summarize"],
 "messages":[{"role":"user","content":"Resume el alta de Maite Ochoa Ruiz (DNI 48291730X) para el informe."}],
 "values":[{"kind":"PERSON","messageIndex":0,"start":18,"end":34},
           {"kind":"DNI","messageIndex":0,"start":40,"end":49}]}
```

## `pii-detection-es` case

```json
{"id":"pii-detection-0001","tags":["fintech","lowercase"],
 "text":"transferir a es9121000418450200051332 antes del lunes",
 "spans":[{"kind":"IBAN","start":13,"end":37}]}
```

## `quality-es` case

```json
{"id":"quality-001","taskType":"summarize","language":"es",
 "messages":[{"role":"user","content":"Resume en dos frases: …"}],
 "reference":"…"}
```

## `routing` case (feature 002, unchanged)

See `packages/evals/README.md` and `routing.v1.jsonl`.

The example values above are illustrative. They are checked by the generator's tests,
not copied into datasets.
