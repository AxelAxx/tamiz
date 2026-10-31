# Design Brief: Tamiz Dashboard (for Claude Design)

**Feature**: `008-dashboard` · **Date**: 2026-10-31 · **Spec**: [spec.md](spec.md)

This is the hand-off to Claude Design. It lists every screen and component the dashboard
needs: what data each one shows, its states, and how it behaves on desktop, tablet and
phone. It says **what** each piece must do, not how it looks. The look is the design's job.

What comes back (section 9) goes into `specs/008-dashboard/design/`. Until it is there and
gate `G1` in `tasks.md` is ticked, no screen is built in code.

---

## 1. Product context

- **Tamiz** (Spanish for "sieve") is a self-hosted gateway between an application and LLM
  providers. It finds personal data in each request (Spanish DNI, NIE, IBAN, names, emails,
  phones…) and routes it by policy: to a local model, to an EU provider, anonymized, or
  blocked. Everything else goes to the cheapest model that is good enough.
- **The dashboard** is the operator console for small European teams in health, legal,
  fintech and HR. The users are engineers and compliance-minded leads. They are technical,
  but not all of them read JSON.
- **Tone**: calm, precise, trustworthy, like an audit tool. No marketing gloss. Dense
  information, but readable. The privacy story must be legible at a glance: **where did the
  data go, and why**.
- **Demo role**: the simulator screen is recorded as the README GIF ("paste a text with a
  DNI → detected → routed local"). It should read well at 1280×800 and be satisfying to
  watch: the decision unfolds step by step.
- **Hard rule**: the dashboard never shows what users said to the model. It shows kinds,
  counts, routes and costs. No mock-up should show prompt or answer text, except on the
  simulator (the operator's own pasted text) and the policy editor (the YAML).

## 2. Stack the design must fit

| Area | Choice | Implication for the design |
|---|---|---|
| Framework | Next.js 16 App Router, React 19 | Server-rendered pages, client islands for live data |
| Styling | Tailwind CSS v4 (CSS-first `@theme` tokens) | Deliver tokens as CSS variables (section 9) |
| Components | shadcn/ui (Radix primitives) | Prefer shadcn building blocks: Button, Badge, Card, Table, Tabs, Select, Popover, Dialog, Sheet, Drawer, Tooltip, Toggle Group, Calendar/Date Range Picker, Form, Input, Textarea, Alert, Skeleton, Sonner (toasts), Command, Sidebar, Separator, Scroll Area |
| Charts | shadcn Charts (Recharts) | Bar, line and area charts with the shadcn chart tooltip and legend |
| Tables | TanStack Table | Column headers, row activation; no client sorting in the audit log |
| Data | TanStack Query | Every data region has loading, empty and error states |
| Forms | React Hook Form + Zod | Inline field errors under the field |
| Animation | Motion | Microinteractions only: new-row highlight, decision-flow steps, panel transitions; all must reduce to a fade with reduced motion |
| Icons | lucide-react | Name the icons used per status (section 4) |
| Theme | next-themes | Light, dark and system; both themes are first-class |
| Policy editor | CodeMirror 6 (YAML) | A code editor area with line numbers and a lint gutter; design its frame, gutter markers and issue list, not the editor internals |

## 3. Global layout

### 3.1 App shell

| Component | Shows | States | Desktop (≥ 1280) | Tablet (768–1279) | Phone (< 768) |
|---|---|---|---|---|---|
| **Sidebar navigation** | Tamiz wordmark; 7 items with icons: Live traffic, Simulator, Audit log, Cost, Providers, Evals, Policy; active item | active, hover, focus | Expanded, labels visible | Collapsed to icons with tooltips; expandable | Hidden; opened from a menu button as a Sheet |
| **Top bar** | Screen title; gateway status pill (see below); theme toggle; operator menu (sign out) | — | Full | Full | Title + menu button + status dot; theme and sign-out move into the menu |
| **Gateway status pill** | `Connected` / `Disconnected — retrying` / `Credentials rejected`; last update time; gateway version on hover | ok, retrying, credentials error | Text + icon | Text + icon | Icon only, text in a popover |
| **Skip link** | "Skip to content" | visible on focus only | — | — | — |
| **Content area** | The screen | — | Max width suited to dense tables (no artificial narrow column) | Fluid | Single column, 16 px gutters, no horizontal page scroll |
| **Toasts** | Save confirmations, copy confirmations | success, error | Bottom right | Bottom right | Bottom, full width |

### 3.2 Sign-in page (outside the shell)

| Component | Shows | States |
|---|---|---|
| **Sign-in card** | Wordmark, one-line purpose ("Operator console"), passphrase field (with show/hide), Sign in button | idle, submitting, wrong passphrase (inline error), rate limited ("Too many attempts, try again in N s", button disabled with countdown), session expired notice ("Your session ended, sign in again") |

Responsive: centred card on all sizes; full width with gutters on phone.

### 3.3 Session-expired dialog

Shown in place (over the current screen) when a save or action finds the session expired,
so unsaved work survives. Same fields as the sign-in card, inside a Dialog.

## 4. Shared components (used on several screens)

| Component | Data | Variants / states | Notes |
|---|---|---|---|
| **Residency badge** | the answering target's residency | `local`, `eu`, `us`, `global` | Must be distinguishable without colour: word + icon (suggestion: `local` = house/server, `eu` = EU stars or shield, `us`/`global` = globe). `local` and `eu` are the "safe" story; make them feel reassuring, not alarming |
| **Target label** | target id (e.g. `ollama-llama`), provider, model on hover | — | Monospace id |
| **Outcome badge** | `answered`, `failed`, `blocked`, `cancelled` | each with icon + word | `blocked` replaces the residency badge in rows |
| **Privacy action badge** | `allow`, `anonymize`, `restrict_to_local`, `block` | icon + word | Show `restrict_to_local` as "local only" |
| **Sensitivity indicator** | `none`, `low`, `high`, `critical`, `unknown` | 5 levels, ordered; `unknown` = inspection failed | A scale (dots/bars) plus word; `critical` must be prominent but not red-alarm everywhere |
| **Entity chip** | kind (`DNI`, `NIE`, `CIF`, `IBAN`, `NSS`, `PHONE`, `EMAIL`, `CREDIT_CARD`, `PERSON`, `LOCATION`) and count (×2) | critical kinds (DNI, NIE, NSS, IBAN, CREDIT_CARD) vs others | Chips may wrap; on rows show at most 3 then "+N" |
| **Fallback marker** | number of abandoned targets; on hover/focus: list of target id + reason (`timeout`, `rate_limited`, `http_error`, `network`, `malformed_response`, `authentication`, `circuit_open`) | none, one or more | Small icon next to the residency badge |
| **Circuit state badge** | `closed`, `open`, `half_open`; remaining cool-down | each with icon + word | Countdown text for `open` |
| **Pass/fail mark** | `pass`, `fail`, `error`, `skipped` | icon + word + colour | Used on the evals screen |
| **Money** | USD amounts, from $0.0001 up | — | Up to 4 decimals below one cent; tabular numerals |
| **Timestamp** | ISO UTC | relative ("12 s ago") with absolute on hover; time zone visible in detail views | Cost days are labelled UTC |
| **Entry detail drawer** | every field of an audit entry: request id, request hash (first 12 chars + copy), client, started/ended, latency, policy id + version, rule, task type, size, sensitivity, entities with counts, action, notice version, outcome, error type, block reason, streamed, target (id, provider, model, residency), abandoned targets with reasons, usage (input/output tokens, "estimated" flag), cost, baseline cost and target; link "See requests with this rule" | loading (if opened from a link), not found | Desktop: right-side Drawer/Sheet; phone: full-screen sheet. Must clearly show **no message content exists** (e.g. a small note "Tamiz never stores what was said") |
| **Region states** | — | **loading**: skeleton of the final layout, no spinners on whole pages; **empty**: icon, one sentence, one action; **error**: what failed (gateway unreachable / credentials rejected / unexpected answer), the gateway request id when there is one, a Retry button; **stale**: data shown with a subtle "last updated" note | Every data region below lists which of these it needs |
| **Filter bar** | a row of filter controls, active filters as removable chips, "Clear all" | — | Desktop: one row; tablet: wraps; phone: collapses into a "Filters (N)" button that opens a Sheet |
| **Date range picker** | presets + custom range | invalid range error inline | shadcn Calendar in a Popover |

## 5. Screens

For each screen: purpose, regions in reading order, data per component, states, responsive
behaviour, and interactions to design. Data names are the gateway's contract fields.

### 5.1 Live traffic (`/live`, the home screen after sign-in)

**Purpose**: watch requests as they are decided. Demo screen 1: "a request with a DNI shows
up with a `local` badge".

| Component | Data | States |
|---|---|---|
| **Stream header** | status (`Live`, `Paused`, `Retrying since 12:04:05`), entries shown (max 100), Pause/Resume button, pending counter when paused ("14 new"), link to audit log | live, paused (with counter), retrying, connecting |
| **Summary strip** (optional, designer's call) | over the shown rows: count by residency, count blocked, count with critical entities | — |
| **Traffic table** | per entry: started (relative), client id, residency badge + target id (or outcome badge if blocked/failed), fallback marker, rule id, task type · size, sensitivity indicator, entity chips, privacy action badge, latency, cost | loading (skeleton rows), empty ("No requests in the last 5 minutes. Send one to the gateway or try the simulator." with a link), error/retrying (rows kept, banner) |
| **New-row highlight** | a newly arrived row is highlighted for ~2 s; rows slide in from the top | reduced motion: fade only |
| **Entry detail drawer** | section 4 | — |

Interactions: click/Enter on a row opens the detail; Pause keeps rows still; the pending
counter is clickable to resume. Screen readers get a polite announcement at most every 10 s
("5 new requests") — no visual design needed beyond an optional visually hidden region.

Responsive: desktop full table; tablet hides client, task type and latency columns (in the
detail); phone shows each entry as a stacked card: line 1 residency badge + target + time,
line 2 entity chips, line 3 action + cost.

### 5.2 Simulator (`/simulator`)

**Purpose**: paste a text and see what the gateway would do, without calling any model.
**This is the README GIF**: make the decision flow the hero.

| Component | Data | States |
|---|---|---|
| **Input panel** | form: user message (large Textarea, required), optional system message (collapsed toggle "Add system message"), optional extra user messages ("Add message"), requested model (Input, default `tamiz-auto`), Simulate button; a one-line privacy note "This text stays in your browser tab; it is not stored." | idle, validating (inline errors: empty text, too long, blank model), submitting |
| **Sample texts** (suggestion) | 3–4 one-click examples: "with a DNI", "with a name and email", "no personal data", "code request" | — |
| **Highlighted text** | the submitted text (read-only) with each detected entity highlighted and labelled by kind (and score on hover); one block per message with its role | no entities ("No personal data detected"), several overlapping |
| **Decision flow** | 5 ordered steps, each with its value: 1 Inspection (sensitivity indicator, detector status `ok`/`unavailable`/`timeout`/`contract`), 2 Classification (task type, size), 3 Rule (rule id), 4 Privacy action (badge), 5 Route (chain) | each step: pending → resolved (staggered reveal, Motion); for a block, the deciding step is marked and the following steps are greyed with the block reason in words (`action`: "policy blocks this sensitivity", `no_target`: "no allowed target", `detector_unavailable`: "inspection failed, gateway fails closed") |
| **Chain** | ordered targets: target id, provider, model, residency badge; allowed residencies listed | one or more targets; empty when blocked |
| **Provider receives** (only for `anonymize`) | the notice + the messages as a provider would receive them, with placeholders like `<PERSON_1>`, `<EMAIL_1>` visually marked | — |
| **Result meta** | policy id and version used; "No model was called" note | — |
| **Result region states** | — | before first run (empty: explain what the simulator does, point at samples), running (skeleton of the flow), error (gateway unreachable / unexpected answer) |

Interactions: Simulate with Ctrl/Cmd+Enter; Edit returns focus to the text; re-running
replaces the result with the flow animation again.

Responsive: desktop two columns (input left, result right) or input on top with the flow
as a horizontal stepper (designer's call; it must fit 1280×800 for the GIF with the text,
highlights and the full flow visible without scrolling); tablet stacked; phone stacked with
the flow as a vertical stepper.

### 5.3 Audit log (`/audit`)

**Purpose**: answer "what happened to requests like this?" for an auditor.

| Component | Data | States |
|---|---|---|
| **Filter bar** | date range (from/to), route (target id select from the providers list), rule (select from the active policy's rules), sensitivity, privacy action, entity kind, outcome; active filters as chips; Clear all | invalid range (inline error), options loading |
| **Audit table** | same columns as live traffic plus the absolute start time and request id (short) | loading (skeleton), empty ("No entries match: route = mistral-small, entity = DNI" + Clear filters), error |
| **Load older** | button below the table; shows how many are loaded | loading more, "No older entries" (disabled), error loading more (inline retry) |
| **Entry detail drawer** | section 4 | — |

Responsive: as live traffic (stacked cards on phone); filter bar collapses to a Sheet on
phone. The URL holds the filters (shareable), so there is no "saved views" UI.

### 5.4 Cost analytics (`/cost`)

**Purpose**: show actual spend against "everything to the most expensive model" (baseline).
Cuttable if time runs out, but design it.

| Component | Data | States |
|---|---|---|
| **Controls** | range presets (Last 7 days, Last 30 days, This month) + custom range; group by `day` / `route` / `model` (Toggle Group) | invalid range |
| **KPI cards** (4–6) | actual cost, baseline cost, saving ($ and %), requests served, tokens in/out, not served (blocked + failed counts) | loading (skeleton), baseline unavailable ("No priced target in the policy": shown instead of the baseline and saving values, not as $0) |
| **Chart** | per key (UTC day, route or model): actual vs baseline cost; tooltip with requests and tokens | loading, empty range ("No requests between …"), baseline unavailable (actual only) |
| **Breakdown table** | per key: requests, input tokens, output tokens, actual, baseline, saving; totals row | the accessible alternative to the chart; same states |
| **Baseline note** | which target and prices the baseline uses (`baseline.targetId`, $/M in and out) | — |

Responsive: KPI cards 3×2 on desktop, 2×3 on tablet, a 2-column grid or a horizontal
scroll strip on phone (no page scroll); chart full width; breakdown table becomes stacked
cards on phone.

### 5.5 Providers (`/providers`)

**Purpose**: which targets are healthy now, which are failing. Explains fallbacks.

| Component | Data | States |
|---|---|---|
| **Window picker** | 5 / 15 / 60 minutes; "updated N s ago" | — |
| **Target table or cards** | per target: id, provider, model, residency badge, circuit state badge (+ cool-down countdown when open), attempts, errors, error rate, latency p50 and p95 | loading, error; idle target (0 attempts, latency "—"), open circuit (prominent) |

Responsive: desktop table or card grid (designer's call; one card per target works well
with 3–8 targets); phone stacked cards.

### 5.6 Evals (`/evals`)

**Purpose**: are the privacy and routing promises still holding? Shows the CI eval report.

| Component | Data | States |
|---|---|---|
| **Run header** | overall status (pass/fail/error mark, large), started at, duration, git commit (short, links to GitHub), policy id + version, models (answer, judge, frontier), datasets (name, version, cases) | — |
| **Eval cards** (one per eval: `leak`, `detection`, `routing`, `quality`, `cost`) | status mark, duration; metrics list: name, value (ratio as %, usd, score, count), threshold (comparison symbol ≥ ≤ < = and bound), pass/fail per metric; for `error`: error type and service; for `skipped`: reason | pass, fail, error, skipped |
| **Headline metrics** (suggestion) | the three numbers people care about: critical leak rate (target 0 %), structured-identifier recall (≥ 95 %), routing accuracy (≥ 95 %) | — |
| **Failing cases table** (per failing eval, expandable) | id, reason, expected fields, actual fields; "showing 50 of 132" when capped | — |
| **Run history** | list of runs newest first: date, policy version, status, commit; selecting one shows it | single run (history hidden or minimal) |
| **Unreadable files notice** | file names that failed validation | — |
| **Screen states** | — | loading, no reports (explain: "Eval reports come from the CI artifact `evals-report`. Download one into the reports folder." with the command), error reading the folder |

Responsive: cards in a 2–3 column grid on desktop, 1 column on phone; failing-case tables
scroll horizontally inside their card on phone (the page itself does not).

### 5.7 Policy editor (`/policy`)

**Purpose**: read and change the active routing policy safely.

| Component | Data | States |
|---|---|---|
| **Policy header** | policy id, version, source (`file` at boot / saved version), saved at, saved by, persistence status | persistent; **not persistent** warning ("Saves are lost when the gateway restarts: configure a database") |
| **Editor** | the policy as YAML; line numbers; lint gutter markers on lines with issues | loading, clean, dirty, read-only while saving |
| **Issue list** | each issue: path (`rules.2.route.0`), message, line; clicking jumps to the line; header shows the count; source: "checked in browser" vs "refused by gateway" | no issues ("Valid"), browser issues (save disabled), gateway issues after a refused save |
| **Action bar** | Save (shows "Save as version N+1"), Discard changes, Reload from gateway; dirty indicator | saving, saved (toast "Saved as version 6"), refused, conflict |
| **Conflict dialog** | "The policy changed to version 7 while you were editing." Options: Reload (lose my changes) or Copy my draft first | — |
| **Unsaved-changes guard** | when leaving with a dirty draft | Dialog |
| **Policy outline** (optional, designer's call) | a read-only structured view next to the editor: targets with residency badges, rules with their conditions and routes, privacy levels → actions | — |
| **"Try in simulator" link** | opens the simulator (uses the saved, active policy) | — |

Responsive: desktop editor with issue list in a side panel (or below); tablet issue list
below; phone the editor full width with the issue list in a collapsible panel; editing works
but a note may suggest a wider screen.

## 6. Accessibility requirements for the design

- WCAG 2.2 AA contrast for text and essential graphics in **both** themes (4.5:1 text, 3:1
  large text and UI components, chart series and focus indicators).
- No meaning by colour alone: every status has a word and/or icon (section 4).
- A visible focus style for every interactive element, consistent across the app.
- Hit targets at least 24×24 px (44×44 on touch layouts).
- Reduced motion: every animation has a fade-only alternative.
- Charts: series distinguishable by more than hue (pattern, label or marker shape), plus
  the table alternative.
- Live regions and headings: each screen has one `h1` (the screen title) and region
  headings; please mark heading levels in the design.

## 7. Content and formatting

- English UI copy for now (the repository is English). Keep strings short; Spanish
  localisation is not in scope, but avoid layouts that break with 30 % longer strings.
- Entity kinds as uppercase codes (`DNI`, `IBAN`, …) with a tooltip naming them ("Spanish
  national ID", "Bank account", …).
- Numbers: tabular figures; thousands separators; percentages with one decimal; latency in
  ms below 1 s, then seconds.
- Times: relative in lists, absolute (with zone) in details.

## 8. Fixture data for mock-ups

Use synthetic values only (never real people). Examples that match the contracts:

- Targets: `ollama-llama` (ollama, `llama3.1:8b`, local), `mistral-small` (mistral, eu),
  `openai-mini` (openai, `gpt-4o-mini`, us), `anthropic-sonnet` (anthropic,
  `claude-sonnet-4-5`, us).
- Rules: `pinned-local`, `pinned-frontier`, `code-to-frontier`, `long-documents-eu`,
  `cheap-short-tasks`, `default`.
- A live row: 12 s ago · client `demo` · `local` · `ollama-llama` · rule `default` ·
  summarize · short · critical · `DNI ×1` `PERSON ×1` · local only · 840 ms · $0.0000.
- A fallback row: `eu` · `mistral-small` · fallback from `openai-mini` (timeout).
- A blocked row: `blocked` (no allowed target) · critical · `IBAN ×1`.
- Simulator text: "Resume el expediente de 12345678Z para el comité." → `DNI` at 24–33,
  critical → local only → `[ollama-llama]`.
- Anonymize: "Resume el informe de Lucía Pérez (lucia.perez@example.com) para el comité."
  → `PERSON`, `EMAIL` → anonymize → provider receives "… <PERSON_1> (<EMAIL_1>) …".
- Cost (30 days): actual $0.0376, baseline $0.2913, saving 87.1 %.
- Evals: leak critical 0 % (≤ 0 %), PERSON 1 % (< 2 %); detection structured recall 100 %
  (≥ 95 %), PERSON 89.1 % (≥ 80 %); routing 100 % (≥ 95 %, 44/44); quality relative 1.00
  (≥ 0.95); cost saving 87.1 % (reported).

## 9. What to deliver back (gate G1)

Put these in `specs/008-dashboard/design/`:

1. **Screens**: each screen of section 5 plus sign-in, at desktop (1440 or 1280 wide) and
   phone (390 wide), light and dark; tablet for the shell and one table screen. Include the
   key states: loading, empty and error for at least live traffic, audit log and evals;
   blocked and anonymize results in the simulator; refused save and conflict in the policy
   editor.
2. **Tokens** as CSS variables usable in Tailwind v4 `@theme`: colours (background, surface,
   foreground, muted, border, ring, primary, and semantic: local, eu, external, success,
   warning, danger, info; chart series 1–5), for light and dark; type scale and families
   (UI and monospace); spacing; radii; shadows; motion durations and easing.
3. **Component notes** for anything not stock shadcn: residency badge, sensitivity
   indicator, entity chip, decision flow, highlighted text, fallback marker.
4. **Iconography**: the lucide icon chosen for each status in section 4.
5. A `design/README.md` with the Claude Design project link and any decisions or deviations
   from this brief.

The implementation follows the design for layout, tokens and components (FR-024). Where the
design and the spec disagree on behaviour or data, the spec wins and the difference is
raised with Alex.
