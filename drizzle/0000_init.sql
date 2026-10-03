CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "target";
--> statement-breakpoint
CREATE TABLE "app"."agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"mode" text NOT NULL,
	"base_plan_version_id" uuid,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"result_plan_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."agent_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"kind" text NOT NULL,
	"tool_name" text,
	"args" jsonb,
	"result" jsonb,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"approved_by" text NOT NULL,
	"note" text,
	"plan_hash" text NOT NULL,
	"dataset_hash" text NOT NULL,
	"target_schema_version" text NOT NULL,
	"dry_run_report_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."dry_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"dataset_hash" text NOT NULL,
	"report_hash" text NOT NULL,
	"counts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."migration_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"parent_run_id" uuid,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"fail_after_batches" integer,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"parent_version_id" uuid,
	"author" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"plan_hash" text NOT NULL,
	"agent_run_id" uuid,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."quarantine_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"dry_run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"legacy_key" text,
	"stage" text NOT NULL,
	"raw" jsonb NOT NULL,
	"errors" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_version_id" uuid,
	"result" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."rollbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"run_ids" jsonb NOT NULL,
	"rows_deleted" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."source_records" (
	"workspace_id" text NOT NULL,
	"seq" integer NOT NULL,
	"legacy_key" text,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "target"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_id" text,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text NOT NULL,
	"phone_e164" text,
	"created_on" date NOT NULL,
	"status" text NOT NULL,
	"country_code" text,
	"lifetime_value_cents" bigint NOT NULL,
	"is_vip" boolean NOT NULL,
	"marketing_opt_in" boolean NOT NULL,
	"_workspace_id" text NOT NULL,
	"_origin" text NOT NULL,
	"_run_id" uuid,
	"_row_hash" text NOT NULL,
	"_inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_hash" text NOT NULL,
	"source_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_steps" ADD CONSTRAINT "agent_steps_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "app"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."approvals" ADD CONSTRAINT "approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."approvals" ADD CONSTRAINT "approvals_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "app"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dry_runs" ADD CONSTRAINT "dry_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."dry_runs" ADD CONSTRAINT "dry_runs_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "app"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD CONSTRAINT "migration_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD CONSTRAINT "migration_runs_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "app"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."migration_runs" ADD CONSTRAINT "migration_runs_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "app"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."plan_versions" ADD CONSTRAINT "plan_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quarantine_records" ADD CONSTRAINT "quarantine_records_dry_run_id_dry_runs_id_fk" FOREIGN KEY ("dry_run_id") REFERENCES "app"."dry_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliations" ADD CONSTRAINT "reconciliations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rollbacks" ADD CONSTRAINT "rollbacks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."source_records" ADD CONSTRAINT "source_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_ws" ON "app"."agent_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_steps_run" ON "app"."agent_steps" USING btree ("agent_run_id","step");--> statement-breakpoint
CREATE INDEX "audit_ws" ON "app"."audit_events" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "dry_runs_version" ON "app"."dry_runs" USING btree ("plan_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_runs_one_running" ON "app"."migration_runs" USING btree ("workspace_id") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "migration_runs_ws" ON "app"."migration_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_ws_version" ON "app"."plan_versions" USING btree ("workspace_id","version");--> statement-breakpoint
CREATE INDEX "quarantine_dry_run" ON "app"."quarantine_records" USING btree ("dry_run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_pk" ON "app"."source_records" USING btree ("workspace_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_ws_legacy" ON "target"."customers" USING btree ("_workspace_id","legacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_ws_email" ON "target"."customers" USING btree ("_workspace_id",lower("email"));--> statement-breakpoint
CREATE INDEX "customers_ws_run" ON "target"."customers" USING btree ("_workspace_id","_run_id");