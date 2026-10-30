# Data Model: Privacy Service

**Feature**: `004-privacy-service` · **Date**: 2026-10-30 · **Plan**: [plan.md](plan.md)

Shapes by layer. Domain types are frozen dataclasses and enums from the standard
library; the API layer has the Pydantic models that become `openapi.json`. Paths are
relative to `services/privacy/src/privacy/`.

## 1. Domain (`domain/`)

### 1.1 `entity_kind.py`

```python
class EntityKind(StrEnum):
    DNI = "DNI"; NIE = "NIE"; CIF = "CIF"; IBAN = "IBAN"; NSS = "NSS"
    PHONE = "PHONE"; EMAIL = "EMAIL"; CREDIT_CARD = "CREDIT_CARD"
    PERSON = "PERSON"; LOCATION = "LOCATION"

SPECIFICITY: tuple[EntityKind, ...]   # overlap tie-break order (research R-08), DNI first
STRUCTURED: frozenset[EntityKind]     # DNI, NIE, CIF, IBAN, NSS, PHONE, EMAIL (SC-001)
```

### 1.2 `finding.py`

```python
@dataclass(frozen=True, slots=True)
class Finding:
    kind: EntityKind
    start: int      # inclusive character offset, 0 ≤ start < end ≤ len(text)
    end: int        # exclusive
    score: float    # 0.0 … 1.0
```

Invariants are checked by a factory `finding(kind, start, end, score) -> Finding | None`
used by the adapter; out-of-range values return `None` (and are counted as dropped in
the request log line), never raise.

### 1.3 `sensitivity.py`

```python
class SensitivityLevel(StrEnum):
    NONE = "none"; LOW = "low"; HIGH = "high"; CRITICAL = "critical"

LEVEL_BY_KIND: Mapping[EntityKind, SensitivityLevel]
#   CRITICAL: DNI, NIE, NSS, IBAN, CREDIT_CARD
#   HIGH:     PERSON, PHONE, EMAIL
#   LOW:      CIF, LOCATION

def level_of(findings: Iterable[Finding]) -> SensitivityLevel   # max; NONE when empty
def counts_of(findings: Iterable[Finding]) -> dict[EntityKind, int]
```

A test asserts `LEVEL_BY_KIND` covers every `EntityKind` (total mapping).

### 1.4 `overlap.py`

```python
def resolve_overlaps(findings: Sequence[Finding]) -> tuple[Finding, ...]
```

Sorted by `start`; no two results overlap; rule of research R-08 (score, then
`SPECIFICITY`, then span length). Pure and idempotent (property-tested).

### 1.5 `placeholders.py`

```python
@dataclass(frozen=True, slots=True)
class PlaceholderEntry:
    placeholder: str      # "<DNI_1>"
    kind: EntityKind
    value: str            # original text slice

@dataclass(frozen=True, slots=True)
class Anonymized:
    text: str
    mapping: tuple[PlaceholderEntry, ...]   # order of first appearance

PLACEHOLDER_PATTERN: re.Pattern[str]       # <(KIND)_(\d+)> over the EntityKind names
def anonymize(text: str, findings: Sequence[Finding]) -> Anonymized
```

Preconditions: `findings` are non-overlapping and inside `text` (the use case passes the
output of `resolve_overlaps`). Numbering per kind starts after the highest `n` already
present in `text` for that kind (FR-015). Same `(kind, value)` → same placeholder.

### 1.6 `checksums.py`

```python
def is_valid_dni(candidate: str) -> bool
def is_valid_nie(candidate: str) -> bool
def is_valid_cif(candidate: str) -> bool
def is_valid_iban(candidate: str) -> bool     # any country, + ES account control digits
def is_valid_nss(candidate: str) -> bool
def is_spanish_phone(candidate: str) -> bool  # structure only
def compact(candidate: str) -> str            # upper-case, one separator kind removed
```

Algorithms: research R-13. All total (`False` on any malformed input, never raise).

## 2. Application (`application/`)

### 2.1 `ports.py`

```python
class PiiAnalyzerPort(Protocol):
    def analyze(self, text: str, kinds: frozenset[EntityKind]) -> Sequence[Finding]: ...
    def is_ready(self) -> bool: ...
```

The adapter returns raw findings (already mapped to `EntityKind`, unfiltered by score,
possibly overlapping). The fake for tests is a dict from text to findings, or a
callable.

### 2.2 Use cases

```python
@dataclass(frozen=True, slots=True)
class AnalyzeCommand:
    text: str
    min_score: float = 0.5
    kinds: frozenset[EntityKind] = frozenset(EntityKind)

@dataclass(frozen=True, slots=True)
class AnalysisResult:
    findings: tuple[Finding, ...]           # resolved, sorted by start
    counts: Mapping[EntityKind, int]
    level: SensitivityLevel

def analyze_text(analyzer: PiiAnalyzerPort, command: AnalyzeCommand) -> AnalysisResult
#   analyzer.analyze → kinds filter → min_score filter → resolve_overlaps → counts, level

@dataclass(frozen=True, slots=True)
class AnonymizationResult:
    text: str
    mapping: tuple[PlaceholderEntry, ...]
    analysis: AnalysisResult

def anonymize_text(analyzer: PiiAnalyzerPort, command: AnalyzeCommand) -> AnonymizationResult
```

Both are plain functions (no classes); FastAPI routes call them through dependencies
injected by `create_app`.

## 3. Infrastructure (`infrastructure/`)

| Module | Shape |
|---|---|
| `settings.py` | `Settings` (`pydantic-settings`): `PRIVACY_HOST` (default `0.0.0.0`), `PRIVACY_PORT` (8001), `PRIVACY_LOG_LEVEL` (`info`), `PRIVACY_DEFAULT_MIN_SCORE` (0.5, range 0–1), `PRIVACY_SPACY_MODEL` (`es_core_news_lg`). Invalid → process exits 1 naming the variable, never the value. |
| `presidio_analyzer.py` | `build_engine(settings) -> AnalyzerEngine`; `PresidioAnalyzer(engine)` implements `PiiAnalyzerPort`; `PRESIDIO_TO_KIND` table (`EMAIL_ADDRESS` → `EMAIL`, `CREDIT_CARD` → `CREDIT_CARD`, `PERSON` → `PERSON`, `LOCATION` → `LOCATION`, own names map to themselves). |
| `recognizers/validated.py` | `ValidatedPatternRecognizer(entity, patterns, validator, context, language="es")`; `validate_result` delegates to the domain validator. |
| `recognizers/identity.py` | `dni_recognizer()`, `nie_recognizer()`, `cif_recognizer()` with word-boundary patterns tolerant to one separator kind and lower case. |
| `recognizers/banking.py` | `iban_recognizer()` (grouped by 4 with spaces or compact). |
| `recognizers/social_security.py` | `nss_recognizer()` (`PP/NNNNNNNN/CC`, with `/`, space, dash or none). |
| `recognizers/phone.py` | `phone_recognizer()` with score 0.6 and context words (research R-12). |

## 4. API contract (`api/schemas.py` → `openapi.json`)

All request models use `model_config = ConfigDict(extra="forbid")`; response models
are generated from the use-case results by mappers in `api/app.py`.

```text
AnalyzeRequest
  text: str                         max 1 MiB as UTF-8 (enforced by the body limit)
  language: Literal["es"] = "es"
  min_score: float = 0.5            0 ≤ x ≤ 1
  entities: list[EntityKind] | None   None = all kinds; empty list → 400

FindingOut       { kind: EntityKind, start: int ≥ 0, end: int > start, score: float 0–1 }
AnalyzeResponse  { findings: list[FindingOut], counts: dict[EntityKind, int],
                   sensitivity_level: SensitivityLevel }

AnonymizeRequest   = AnalyzeRequest (same fields; separate component name)
PlaceholderOut     { placeholder: str, kind: EntityKind, value: str }
AnonymizeResponse  { text: str, mapping: list[PlaceholderOut], analysis: AnalyzeResponse }

HealthResponse   { status: Literal["ok"], ready: bool, version: str }
ErrorBody        { type: Literal["invalid_request","payload_too_large","not_ready","internal_error"],
                   message: str, field: str | None }
ErrorEnvelope    { error: ErrorBody }
```

`EntityKind` and `SensitivityLevel` appear in the OpenAPI document as named string
enums (`components.schemas.EntityKind`, `…SensitivityLevel`), so `T-005-03` mirrors
them as `z.enum` (US6-2). `counts` contains only kinds with at least one finding.

## 5. Corpus (`tests/corpus/pii-es.v1.jsonl`)

```text
line 1:  {"type": "meta", "version": "1", "synthetic": true, "language": "es",
          "generator": "scripts/generate_corpus.py", "seed": 20261030, "created": "YYYY-MM-DD"}
line n:  {"type": "case", "id": "c0001", "text": "…",
          "spans": [{"kind": "DNI", "start": 12, "end": 21}, …],
          "tags": ["clinic"] | ["negative", "dni-bad-letter"] | …}
```

Spans are character offsets into `text`, sorted, non-overlapping, kinds from
`EntityKind`. A schema test validates every line and the size minimums of research
R-14.

## 6. Metrics report (`reports/detection-metrics.json`, generated, gitignored)

```text
{ "corpus_version": "1", "cases": 312, "min_score": 0.5,
  "per_kind": { "DNI": { "tp": 41, "fp": 0, "fn": 1, "precision": 1.0, "recall": 0.976, "support": 42 }, … },
  "thresholds": { "DNI": { "precision": 0.95, "recall": 0.95 }, …, "PERSON": { "recall": 0.80 } },
  "round_trip": { "cases": 312, "exact": 312, "values_left": 0 },
  "passed": true }
```

## 7. Relationships

```text
api.app ──calls──▶ application.analyze_text / anonymize_text ──uses──▶ PiiAnalyzerPort
   │                         │                                              ▲
   │ maps to schemas         └─▶ domain (overlap, sensitivity, placeholders) │ implements
   ▼                                                                         │
openapi.json ──mirrored by──▶ gateway Zod (T-005-03)      infrastructure.PresidioAnalyzer
                                                            └─▶ recognizers ─▶ domain.checksums
main.py: Settings → build_engine → PresidioAnalyzer → create_app(analyzer, settings)
```
