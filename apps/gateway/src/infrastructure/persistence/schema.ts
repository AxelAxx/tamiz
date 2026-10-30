/**
 * PostgreSQL schema (spec 006 FR-005, FR-006, research R-04, data-model section 6).
 *
 * `audit_entries` has a column per filterable field and no column for content; entity
 * counts and abandoned targets are `jsonb`. `api_keys` stores SHA-256 hashes only, with a
 * role and a revocation time. Migrations are generated from this file by `drizzle-kit`
 * (`pnpm --filter @tamiz/gateway db:generate`) and committed under `drizzle/`.
 */
import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const auditEntries = pgTable(
  "audit_entries",
  {
    id: uuid("id").primaryKey(),
    requestId: text("request_id").notNull(),
    clientId: text("client_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "string" }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: integer("policy_version").notNull(),
    ruleId: text("rule_id").notNull(),
    taskType: text("task_type").notNull(),
    size: text("size").notNull(),
    sensitivity: text("sensitivity").notNull(),
    entities: jsonb("entities").$type<Record<string, number>>().notNull(),
    privacyAction: text("privacy_action").notNull(),
    noticeVersion: text("notice_version"),
    blockReason: text("block_reason"),
    outcome: text("outcome").notNull(),
    errorType: text("error_type"),
    streamed: boolean("streamed").notNull(),
    targetId: text("target_id"),
    targetProvider: text("target_provider"),
    targetModel: text("target_model"),
    targetResidency: text("target_residency"),
    abandoned: jsonb("abandoned").$type<Array<{ targetId: string; reason: string }>>().notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    usageEstimated: boolean("usage_estimated"),
    costUsd: numeric("cost_usd", { precision: 14, scale: 8 }).notNull(),
    baselineCostUsd: numeric("baseline_cost_usd", { precision: 14, scale: 8 }),
    baselineTargetId: text("baseline_target_id"),
  },
  (table) => [
    index("audit_entries_created_at_id_idx").on(table.createdAt.desc(), table.id.desc()),
    index("audit_entries_target_id_idx").on(table.targetId),
    index("audit_entries_rule_id_idx").on(table.ruleId),
    index("audit_entries_outcome_idx").on(table.outcome),
    index("audit_entries_entities_idx").using("gin", table.entities),
  ],
);

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id").notNull(),
  keyHash: char("key_hash", { length: 64 }).notNull().unique(),
  role: text("role", { enum: ["client", "admin"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
