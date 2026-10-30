CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"key_hash" char(64) NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"latency_ms" integer NOT NULL,
	"request_hash" char(64) NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" integer NOT NULL,
	"rule_id" text NOT NULL,
	"task_type" text NOT NULL,
	"size" text NOT NULL,
	"sensitivity" text NOT NULL,
	"entities" jsonb NOT NULL,
	"privacy_action" text NOT NULL,
	"notice_version" text,
	"block_reason" text,
	"outcome" text NOT NULL,
	"error_type" text,
	"streamed" boolean NOT NULL,
	"target_id" text,
	"target_provider" text,
	"target_model" text,
	"target_residency" text,
	"abandoned" jsonb NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"usage_estimated" boolean,
	"cost_usd" numeric(14, 8) NOT NULL,
	"baseline_cost_usd" numeric(14, 8),
	"baseline_target_id" text
);
--> statement-breakpoint
CREATE INDEX "audit_entries_created_at_id_idx" ON "audit_entries" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_entries_target_id_idx" ON "audit_entries" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "audit_entries_rule_id_idx" ON "audit_entries" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "audit_entries_outcome_idx" ON "audit_entries" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "audit_entries_entities_idx" ON "audit_entries" USING gin ("entities");