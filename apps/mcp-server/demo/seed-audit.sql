-- Synthetic audit history for the agent demo (spec 009 research R-14, tasks.md T029).
--
--   psql "$DATABASE_URL" -f apps/mcp-server/demo/seed-audit.sql
--
-- Content-free rows for the two UTC days before today, relative to now(), in the gateway's
-- `audit_entries` table (apps/gateway/src/infrastructure/persistence/schema.ts). Yesterday's
-- spend is about twice the day before's because route `anthropic-sonnet` (rule
-- `code-to-frontier`) grew:
--
--   day before yesterday: anthropic-sonnet 10 × $0.031  = $0.31, mistral-small $0.11 → $0.42
--   yesterday:            anthropic-sonnet 24 × $0.0305 = $0.732, mistral-small $0.11 → $0.842
--
-- Fixed UUIDs (…-8000-00000000NNNN) and one fixed request hash; running it again inserts
-- nothing new. Re-running on a later day keeps the old rows, so delete them first with
-- `delete from audit_entries where client_id = 'demo-seed';`.

with plan(day_offset, target_id, provider, model, residency, rule_id, task_type, count, cost_usd, first_n) as (
  values
    (2, 'ollama-llama',     'ollama',    'llama3.1:8b',          'local', 'cheap-short-tasks', 'chat', 30, 0.0,    1),
    (2, 'anthropic-sonnet', 'anthropic', 'claude-sonnet-4-5',    'us',    'code-to-frontier',  'code', 10, 0.031,  31),
    (2, 'mistral-small',    'mistral',   'mistral-small-latest', 'eu',    'long-documents-eu', 'summarize', 10, 0.011, 41),
    (1, 'ollama-llama',     'ollama',    'llama3.1:8b',          'local', 'cheap-short-tasks', 'chat', 30, 0.0,    51),
    (1, 'anthropic-sonnet', 'anthropic', 'claude-sonnet-4-5',    'us',    'code-to-frontier',  'code', 24, 0.0305, 81),
    (1, 'mistral-small',    'mistral',   'mistral-small-latest', 'eu',    'long-documents-eu', 'summarize', 10, 0.011, 105)
),
rows as (
  select
    plan.*,
    plan.first_n + i - 1 as n,
    date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      - make_interval(days => plan.day_offset)
      + make_interval(mins => 10 + (i * 23) % 1380) as started
  from plan, generate_series(1, plan.count) as i
)
insert into audit_entries (
  id, request_id, client_id, created_at, ended_at, latency_ms, request_hash,
  policy_id, policy_version, rule_id, task_type, size, sensitivity, entities,
  privacy_action, outcome, streamed,
  target_id, target_provider, target_model, target_residency, abandoned,
  input_tokens, output_tokens, usage_estimated,
  cost_usd, baseline_cost_usd, baseline_target_id
)
select
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'demo-seed-' || lpad(n::text, 4, '0'),
  'demo-seed',
  started,
  started + interval '1200 milliseconds',
  1200,
  'de30de30de30de30de30de30de30de30de30de30de30de30de30de30de30de30',
  'default', 1, rule_id, task_type, 'short', 'none', '{}'::jsonb,
  'allow', 'answered', false,
  target_id, provider, model, residency, '[]'::jsonb,
  4000, 1000, false,
  cost_usd, 0.027, 'anthropic-sonnet'
from rows
on conflict (id) do nothing;
